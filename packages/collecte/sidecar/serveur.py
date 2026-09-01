# Sidecar d'etiquetage de l'etape Collecte : recoit l'image et les mots sur POST /etiqueter,
# rend l'etiquette et le score que LayoutLMv3 pose sur chaque mot, dans le meme ordre.
# Processus enfant lance et surveille par l'api ; il n'ecoute que sur 127.0.0.1 et n'ecrit rien
# sur disque a l'execution (les poids viennent du cache, prepare au build de l'image par
# --preparer).
#
# Volontairement bete : processor, inference, softmax, rien d'autre. Le decoupage en mots, la
# normalisation des boites et la reconstruction en facture vivent cote node — changer de
# checkpoint ne doit toucher que ce fichier et la table d'etiquettes de la Collecte.
import argparse
import base64
import io
import json
import logging
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROUTE_ETIQUETAGE = '/etiqueter'
ROUTE_SANTE = '/sante'

# L'image chauffee est bornee (2000x6000 en png) et les mots pesent peu : un corps plus lourd
# que 40 Mo ne peut pas venir d'Alambic, on le refuse avant de le lire.
TAILLE_MAX_CORPS = 40 * 1024 * 1024

MODELE_PAR_DEFAUT = 'nielsr/layoutlmv3-finetuned-cord'

# Les fenetres du modele font 512 tokens ; le chevauchement laisse du contexte des deux cotes
# aux mots d'un recu qui deborde d'une fenetre.
CHEVAUCHEMENT_TOKENS = 128

ETIQUETTE_EXTERIEURE = 'O'

processor = None
modele = None
verrou = threading.Lock()


def charger(nom_modele):
    from transformers import AutoProcessor, LayoutLMv3ForTokenClassification

    # apply_ocr force a faux : les mots et leurs boites viennent de la Condensation, le
    # processor ne doit pas refaire l'ocr lui-meme. Force ici plutot que confie a la
    # configuration du checkpoint, qui pourrait dire l'inverse.
    proc = AutoProcessor.from_pretrained(nom_modele, apply_ocr=False)
    mdl = LayoutLMv3ForTokenClassification.from_pretrained(nom_modele)
    mdl.eval()
    return proc, mdl


def etiqueter(image, textes, boites):
    import torch

    encodage = processor(
        image,
        textes,
        boxes=boites,
        truncation=True,
        stride=CHEVAUCHEMENT_TOKENS,
        return_overflowing_tokens=True,
        padding=True,
        return_tensors='pt',
    )
    # Le tokenizer decoupe en fenetres mais le processor ne rend qu'une image (en liste, pas
    # en tenseur empile) : on empile puis on repete l'image pour chaque fenetre, sinon le lot
    # du modele est incoherent.
    correspondance = encodage.pop('overflow_to_sample_mapping', None)
    pixels = encodage['pixel_values']
    if not torch.is_tensor(pixels):
        pixels = torch.stack(list(pixels))
    if correspondance is not None:
        pixels = pixels[correspondance]
    encodage['pixel_values'] = pixels

    with torch.inference_mode():
        sortie = modele(**encodage)
    scores = torch.softmax(sortie.logits, dim=-1)

    etiquettes = [None] * len(textes)
    for fenetre in range(scores.shape[0]):
        ids_mots = encodage.word_ids(batch_index=fenetre)
        for position, id_mot in enumerate(ids_mots):
            # Premier token du mot, premiere fenetre ou il apparait : simple et suffisant, le
            # chevauchement garantit que chaque mot est vu au moins une fois.
            if id_mot is None or etiquettes[id_mot] is not None:
                continue
            meilleur = int(scores[fenetre, position].argmax())
            etiquettes[id_mot] = {
                'etiquette': modele.config.id2label[meilleur],
                'score': float(scores[fenetre, position, meilleur]),
            }
    return [
        e if e is not None else {'etiquette': ETIQUETTE_EXTERIEURE, 'score': 0.0}
        for e in etiquettes
    ]


def lire_requete(corps):
    donnees = json.loads(corps)
    image_png = base64.b64decode(donnees['image'], validate=True)
    textes = []
    boites = []
    for mot in donnees['mots']:
        textes.append(str(mot['texte']))
        boites.append([int(valeur) for valeur in mot['boite']])
    return image_png, textes, boites


class Requetes(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == ROUTE_SANTE:
            self._repondre(200, {'pret': True})
        else:
            self._repondre(404, {'erreur': 'route inconnue'})

    def do_POST(self):
        if self.path != ROUTE_ETIQUETAGE:
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

        from PIL import Image

        try:
            image_png, textes, boites = lire_requete(corps)
            image = Image.open(io.BytesIO(image_png)).convert('RGB')
        except Exception:
            self._repondre(400, {'erreur': 'requete illisible'})
            return

        if len(textes) == 0:
            self._repondre(200, {'etiquettes': []})
            return

        try:
            # Une seule instance du modele, serialisee : torch parallelise deja chaque
            # inference sur les coeurs, une deuxieme instance doublerait la memoire sans debit.
            with verrou:
                etiquettes = etiqueter(image, textes, boites)
        except Exception as erreur:
            print(f'echec d etiquetage : {erreur}', file=sys.stderr, flush=True)
            self._repondre(500, {'erreur': 'echec d etiquetage'})
            return
        self._repondre(200, {'etiquettes': etiquettes})

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
    parseur.add_argument('--port', type=int, default=3103)
    parseur.add_argument('--modele', default=MODELE_PAR_DEFAUT)
    parseur.add_argument('--preparer', action='store_true')
    arguments = parseur.parse_args()

    # transformers est bavard au chargement ; seuls les avertissements et erreurs meritent
    # stderr.
    logging.disable(logging.INFO)

    global processor, modele
    processor, modele = charger(arguments.modele)

    if arguments.preparer:
        # Etape de build docker : charger processor et modele suffit a remplir le cache HF.
        print('modeles prepares', file=sys.stderr, flush=True)
        return

    # Warmup avant de prendre le port : les allocations de la premiere inference se paient ici,
    # et toute reponse http vaut ensuite « pret ».
    from PIL import Image

    etiqueter(Image.new('RGB', (224, 224), 'white'), ['pret'], [[0, 0, 10, 10]])

    serveur = ThreadingHTTPServer(('127.0.0.1', arguments.port), Requetes)
    print(f'pret sur le port {arguments.port}', file=sys.stderr, flush=True)
    serveur.serve_forever()


if __name__ == '__main__':
    principal()
