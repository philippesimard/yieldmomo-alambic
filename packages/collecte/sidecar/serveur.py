# Sidecar d'etiquetage de l'etape Collecte : recoit les mots et leurs boites sur
# POST /etiqueter, rend l'etiquette et le score que LiLT pose sur chaque mot, dans le meme
# ordre. Processus enfant lance et surveille par l'api ; il n'ecoute que sur 127.0.0.1 et
# n'ecrit rien sur disque a l'execution (les poids viennent du cache, prepare au build de
# l'image par --preparer).
#
# Volontairement bete : tokenizer, inference, softmax, rien d'autre. Le decoupage en mots, la
# normalisation des boites et la reconstruction en facture vivent cote node — changer de
# checkpoint ne doit toucher que ce fichier et la table d'etiquettes de la Collecte.
#
# LiLT ne lit que le texte et la geometrie, jamais les pixels : l'image ne transite pas.
import argparse
import json
import logging
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROUTE_ETIQUETAGE = '/etiqueter'
ROUTE_SANTE = '/sante'

# Quelques centaines de mots et leurs boites pesent quelques dizaines de ko : un corps plus
# lourd que 4 Mo ne peut pas venir d'Alambic, on le refuse avant de le lire.
TAILLE_MAX_CORPS = 4 * 1024 * 1024

MODELE_PAR_DEFAUT = 'doc2txt/tst_lilt_cord_xlm_ft'

# Les fenetres du modele font 512 tokens ; le chevauchement laisse du contexte des deux cotes
# aux mots d'un recu qui deborde d'une fenetre.
LONGUEUR_MAX_TOKENS = 512
CHEVAUCHEMENT_TOKENS = 128

ETIQUETTE_EXTERIEURE = 'O'

# Boite des tokens speciaux et de bourrage, hors de tout mot.
BOITE_VIDE = [0, 0, 0, 0]

tokenizer = None
modele = None
verrou = threading.Lock()


def charger(nom_modele):
    from transformers import AutoTokenizer, LiltForTokenClassification

    # LiLT s'appuie sur XLM-RoBERTa : la detection Mistral de transformers le prend pour un
    # tokenizer a corriger, le drapeau explicite dit non sans rien modifier.
    tok = AutoTokenizer.from_pretrained(
        nom_modele, model_max_length=LONGUEUR_MAX_TOKENS, fix_mistral_regex=False
    )
    mdl = LiltForTokenClassification.from_pretrained(nom_modele)
    mdl.eval()
    return tok, mdl


def etiqueter(textes, boites):
    import torch

    encodage = tokenizer(
        textes,
        is_split_into_words=True,
        truncation=True,
        max_length=LONGUEUR_MAX_TOKENS,
        stride=CHEVAUCHEMENT_TOKENS,
        return_overflowing_tokens=True,
        padding=True,
        return_tensors='pt',
    )
    encodage.pop('overflow_to_sample_mapping', None)

    # Le tokenizer ne connait pas les boites : chaque sous-token recoit celle de son mot.
    ids_par_fenetre = [
        encodage.word_ids(batch_index=fenetre) for fenetre in range(encodage['input_ids'].shape[0])
    ]
    encodage['bbox'] = torch.tensor(
        [
            [BOITE_VIDE if id_mot is None else boites[id_mot] for id_mot in ids_mots]
            for ids_mots in ids_par_fenetre
        ],
        dtype=torch.long,
    )

    with torch.inference_mode():
        sortie = modele(**encodage)
    scores = torch.softmax(sortie.logits, dim=-1)

    etiquettes = [None] * len(textes)
    for fenetre, ids_mots in enumerate(ids_par_fenetre):
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
    textes = []
    boites = []
    for mot in donnees['mots']:
        textes.append(str(mot['texte']))
        boites.append([int(valeur) for valeur in mot['boite']])
    return textes, boites


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

        try:
            textes, boites = lire_requete(corps)
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
                etiquettes = etiqueter(textes, boites)
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

    global tokenizer, modele
    tokenizer, modele = charger(arguments.modele)

    if arguments.preparer:
        # Etape de build docker : charger tokenizer et modele suffit a remplir le cache HF.
        print('modeles prepares', file=sys.stderr, flush=True)
        return

    # Warmup avant de prendre le port : les allocations de la premiere inference se paient ici,
    # et toute reponse http vaut ensuite « pret ».
    etiqueter(['pret'], [[0, 0, 10, 10]])

    serveur = ThreadingHTTPServer(('127.0.0.1', arguments.port), Requetes)
    print(f'pret sur le port {arguments.port}', file=sys.stderr, flush=True)
    serveur.serve_forever()


if __name__ == '__main__':
    principal()
