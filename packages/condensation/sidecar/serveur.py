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

pipeline = None
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
        if not texte or not texte.strip():
            continue
        cadre = cadre_depuis(boites, polygones, indice)
        if cadre is None:
            continue
        confiance = float(scores[indice]) if scores is not None and len(scores) > indice else 0.0
        blocs.append({'texte': texte, 'cadre': cadre, 'confiance': confiance})
    return blocs


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
            with verrou:
                pages = pipeline.predict(image)
        except Exception as erreur:
            print(f'echec de lecture : {erreur}', file=sys.stderr, flush=True)
            self._repondre(500, {'erreur': 'echec de lecture'})
            return
        blocs = []
        for page in pages:
            blocs.extend(blocs_depuis(page))
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
    arguments = parseur.parse_args()

    # Paddle est bavard au chargement ; seuls les avertissements et erreurs meritent stderr.
    logging.disable(logging.INFO)

    global pipeline
    pipeline = construire_pipeline(arguments.detection)

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
