# Sidecar ocr de l'etape Condensation : recoit un png sur POST /lire, rend les blocs de texte
# lus par PP-OCRv5. Processus enfant lance et surveille par l'api ; il n'ecoute que sur
# 127.0.0.1 et n'ecrit rien sur disque a l'execution (les modeles viennent du cache, prepare
# au build de l'image par --preparer).
import argparse
import json
import logging
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

ROUTE_LECTURE = '/lire'
ROUTE_SANTE = '/sante'

# L'image chauffee est bornee (2000x6000 en png binaire) : un corps plus lourd que 20 Mo ne
# peut pas venir d'Alambic, on le refuse avant de le lire.
TAILLE_MAX_CORPS = 20 * 1024 * 1024

DETECTION = {
    'mobile': 'PP-OCRv5_mobile_det',
    'server': 'PP-OCRv5_server_det',
}

# Le modele latin couvre le francais et l'anglais a la fois : les recus melangent souvent les
# deux. Nomme explicitement : des qu'un nom de modele est fourni, paddleocr ignore `lang`, et
# le defaut (server, chinois/anglais) serait lourd sur cpu.
RECONNAISSANCE = 'latin_PP-OCRv5_mobile_rec'

# La Chauffe sort une image jusqu'a 2000 px de large ; la limite par defaut du pipeline (~960)
# la reduirait de nouveau et mangerait les petits caracteres des recus.
LIMITE_DETECTION = 2016

# Un bloc lu sous cette confiance vaut une seconde lecture. Mesure sur le corpus : le seul total
# FAUX (419,10 lu pour 49,10) sort a 0,879 et la relecture le corrige a 0,971. Descendre a 0,85
# le manquerait ; monter a 0,95 double le cout sans rien rattraper de plus.
SEUIL_RELECTURE = 0.90

# Un peu d'air au-dessus et en dessous : la boite axee serre le texte de pres, et la
# reconnaissance lit mieux avec une bordure.
MARGE_RELECTURE = 0.1

# Sous cette taille, la rognure n'est plus du texte et la reconnaissance n'en tirera rien.
COTE_MIN_ROGNURE = 4

pipeline = None
relecture = True
verrou = threading.Lock()


def construire_pipeline(detection):
    from paddleocr import PaddleOCR

    return PaddleOCR(
        text_detection_model_name=DETECTION[detection],
        text_recognition_model_name=RECONNAISSANCE,
        # La Chauffe redresse et oriente deja l'image : refaire ce travail ici couterait et
        # pourrait contredire le sien.
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        text_det_limit_side_len=LIMITE_DETECTION,
        text_det_limit_type='max',
    )


def champ(page, cle):
    try:
        return page[cle]
    except (KeyError, TypeError):
        return None


def cadre_depuis(boites, polygones, indice):
    if boites is not None and len(boites) > indice:
        x1, y1, x2, y2 = (float(valeur) for valeur in boites[indice])
    elif polygones is not None and len(polygones) > indice:
        xs = [float(point[0]) for point in polygones[indice]]
        ys = [float(point[1]) for point in polygones[indice]]
        x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
    else:
        return None
    return {'x': x1, 'y': y1, 'largeur': x2 - x1, 'hauteur': y2 - y1}


def blocs_depuis(page):
    textes = champ(page, 'rec_texts')
    if textes is None:
        return []
    scores = champ(page, 'rec_scores')
    boites = champ(page, 'rec_boxes')
    polygones = champ(page, 'rec_polys')
    blocs = []
    for indice, texte in enumerate(textes):
        cadre = cadre_depuis(boites, polygones, indice)
        if cadre is None:
            continue
        confiance = float(scores[indice]) if scores is not None and len(scores) > indice else 0.0
        # Une boite detectee dont la reconnaissance n'a rien tire part avec un texte vide, et
        # non a la poubelle : c'est du texte que le moteur a VU sans le lire, et la
        # Condensation ne peut le compter que si on le lui rend. La jeter ici lui cacherait
        # exactement ce qu'elle cherche a savoir.
        blocs.append({'texte': texte or '', 'cadre': cadre, 'confiance': confiance})
    return blocs


def relire(image, blocs):
    """Seconde lecture des blocs faibles, sur la boite axee, et on garde le meilleur score.

    Le pipeline reconnait une rognure redressee par perspective (CropByPolys en quad) ; on lui
    redonne ici la meme zone en boite axee. Ce sont deux VUES du meme texte, et c'est le
    cadrage qui change, pas la resolution : la reconnaissance ramene de toute facon chaque
    rognure a 48 px de haut, donc l'agrandir ne changerait rien.

    Le score du modele tranche, et il a raison sur le cas qui compte : 419,10 a 0,879 contre
    49,10 a 0,971. Sur le corpus, la regle rattrape un montant et n'en perd aucun.
    """
    hauteur, largeur = image.shape[:2]
    indices = []
    rognures = []
    for indice, bloc in enumerate(blocs):
        if bloc['confiance'] >= SEUIL_RELECTURE:
            continue
        cadre = bloc['cadre']
        marge = cadre['hauteur'] * MARGE_RELECTURE
        gauche = int(max(0, cadre['x']))
        droite = int(min(largeur, cadre['x'] + cadre['largeur']))
        haut = int(max(0, cadre['y'] - marge))
        bas = int(min(hauteur, cadre['y'] + cadre['hauteur'] + marge))
        if droite - gauche < COTE_MIN_ROGNURE or bas - haut < COTE_MIN_ROGNURE:
            continue
        indices.append(indice)
        rognures.append(image[haut:bas, gauche:droite])

    if not rognures:
        return

    # Un seul appel pour toutes les rognures d'une image : le cout d'un predict tient a sa mise
    # en route bien plus qu'au nombre d'images qu'on lui passe.
    for indice, lecture in zip(indices, pipeline.paddlex_pipeline.text_rec_model(rognures)):
        score = float(lecture['rec_score'])
        if score > blocs[indice]['confiance']:
            blocs[indice]['texte'] = lecture['rec_text']
            blocs[indice]['confiance'] = score


class Requetes(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == ROUTE_SANTE:
            self._repondre(200, {'pret': True})
        else:
            self._repondre(404, {'erreur': 'route inconnue'})

    def do_POST(self):
        if self.path != ROUTE_LECTURE:
            self._repondre(404, {'erreur': 'route inconnue'})
            return
        longueur = int(self.headers.get('content-length') or 0)
        if longueur <= 0:
            self._repondre(400, {'erreur': 'corps vide'})
            return
        if longueur > TAILLE_MAX_CORPS:
            self._repondre(413, {'erreur': 'corps trop lourd'})
            return
        corps = self.rfile.read(longueur)
        image = cv2.imdecode(np.frombuffer(corps, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            self._repondre(400, {'erreur': 'image illisible'})
            return
        try:
            # Une seule instance du pipeline, serialisee : paddle parallelise deja chaque
            # lecture sur les coeurs, une deuxieme instance doublerait la memoire sans debit.
            # La relecture tient dans le meme verrou : elle passe par le modele du pipeline.
            with verrou:
                pages = pipeline.predict(image)
                blocs = [bloc for page in pages for bloc in blocs_depuis(page)]
                if relecture:
                    relire(image, blocs)
        except Exception as erreur:
            print(f'echec de lecture : {erreur}', file=sys.stderr, flush=True)
            self._repondre(500, {'erreur': 'echec de lecture'})
            return
        self._repondre(200, {'blocs': blocs})

    def _repondre(self, statut, contenu):
        corps = json.dumps(contenu).encode('utf-8')
        self.send_response(statut)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def log_message(self, gabarit, *arguments):
        # Le journal ligne a ligne du serveur http n'apporte rien : le superviseur cote node
        # journalise deja les evenements qui comptent.
        pass


def principal():
    parseur = argparse.ArgumentParser()
    parseur.add_argument('--port', type=int, default=3101)
    parseur.add_argument('--detection', choices=sorted(DETECTION), default='mobile')
    parseur.add_argument('--preparer', action='store_true')
    # Pour mesurer ce que la seconde lecture apporte et ce qu'elle coute, au banc. En service
    # elle est toujours active : c'est un montant faux en moins.
    parseur.add_argument('--sans-relecture', action='store_true')
    arguments = parseur.parse_args()

    # Paddle est bavard au chargement ; seuls les avertissements et erreurs meritent stderr.
    logging.disable(logging.INFO)

    global pipeline, relecture
    pipeline = construire_pipeline(arguments.detection)
    relecture = not arguments.sans_relecture

    if arguments.preparer:
        # Etape de build docker : instancier le pipeline suffit a remplir le cache de modeles.
        print('modeles prepares', file=sys.stderr, flush=True)
        return

    # Warmup avant de prendre le port : les allocations du premier predict se paient ici, et
    # toute reponse http vaut ensuite « pret ».
    pipeline.predict(np.full((64, 256, 3), 255, dtype=np.uint8))

    serveur = ThreadingHTTPServer(('127.0.0.1', arguments.port), Requetes)
    print(f'pret sur le port {arguments.port}', file=sys.stderr, flush=True)
    serveur.serve_forever()


if __name__ == '__main__':
    principal()
