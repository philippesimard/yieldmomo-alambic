# Outils

L'outillage de poste. **Rien ici ne tourne en production** : le service ne fait que charger le
modèle produit (`MODELE_COLLECTE`), il n'exécute aucun de ces fichiers.

Deux familles cohabitent :

- des scripts **TypeScript** lancés par `tsx`, qui mesurent le pipeline sur de vraies photos
  (`banc.ts`, `banc-condensation.ts`, `banc-collecte.ts`, `mesure.ts`) ;
- deux étapes **Python** qui fabriquent le modèle de la Collecte : `recus/` puis `entrainement/`.

## Générer → entraîner

Les deux étapes n'en forment qu'une seule chaîne. La première écrit le jeu, la seconde le lit :

```
recus/          engendre des reçus québécois synthétiques et annotés
   ↓            jeu/<split>/boxes/*.json — mots, boîtes en pixels, étiquette par mot
entrainement/   fine-tune LiLT sur ces annotations
   ↓            entrainement/modeles/lilt-alambic — le checkpoint que le sidecar charge
```

```bash
npm run generer-recus -- --n 4000 --jobs 4   # écrit outils/jeu/ (~1,4 Go pour 4000 reçus)
npm run entrainer-modele                     # lit outils/jeu/, écrit entrainement/modeles/
npm run evaluer-modele -- --split test       # F1 à l'entité sur le split test
npm run publier-modele -- --bucket <bucket>  # compresse et téléverse sur le bucket S3
```

Aucune configuration n'est nécessaire : les chemins par défaut sont ancrés sur l'emplacement des
scripts, pas sur le répertoire courant. Pour mettre le modèle en service :

```bash
MODELE_COLLECTE=$PWD/outils/entrainement/modeles/lilt-alambic npm run dev
```

`publier-modele` est la seule de ces commandes qui touche à la production, et encore : elle ne
fait que déposer l'archive que l'image ira chercher **au build**. Voir
[`entrainement/README.md`](entrainement/README.md).

Deux commandes secondaires : `npm run tester-recus` (la suite du générateur) et
`npm run verifier-boites -- <image>` (redessine les boîtes sur un reçu, pour vérifier à l'œil que
l'annotation suit la déformation).

## Le lien à ne pas casser

`entrainement/donnees.py` fige dans son tuple `CHAMPS` le vocabulaire d'étiquettes que le
générateur émet, **et son ordre** : ce rang devient l'indice de classe du modèle. Renommer une
étiquette côté générateur lève une erreur franche au premier chargement ; en **réordonner**
renumérote silencieusement un checkpoint déjà entraîné. C'est la seule dépendance entre les deux
étapes, et elle ne se voit pas dans les imports.

Corollaire pour `recus/` : les littéraux de chaîne y sont des **données imprimées sur les reçus**
(« Marché Richelieu », « café »). Ils gardent leurs accents — seuls les commentaires suivent la
règle de `CLAUDE.md`.

## Le venv

Un seul venv pour les deux étapes, `outils/.venv`, préparé par le `postinstall` de
`npm install` — comme ceux des sidecars, dont il reste distinct : celui de la Collecte sert
l'inférence en production, celui-ci l'outillage. `torch` s'y trouve donc deux fois, et un poste
neuf compte environ 2,5 Go de venvs.

`outils/requirements.txt` épingle ses versions au lieu de les borner, et c'est délibéré :
`preparer-sidecars.ts` installe ce fichier et non le `.lock`. `torch` et `transformers` y sont
aux versions du sidecar Collecte, `Pillow` et `numpy` figés parce que l'encodeur JPEG décide de
l'octet près de ce que produit le générateur.

Deux contrats implicites, faciles à casser sans s'en apercevoir :

- les modules de `entrainement/` s'importent à plat (`from donnees import ...`), ce qui ne marche
  que parce que `python <chemin>/x.py` place `sys.path[0]` sur le dossier du script. Ne pas y
  ajouter d'`__init__.py`, ne pas lancer par `python -m` ;
- `tester-recus` passe toujours `outils/recus` en argument : `pytest` seul depuis la racine ne
  trouverait aucun fichier de configuration et collecterait `node_modules/` et les venvs.

## Homonymes

`mesure.ts` et `entrainement/mesures.py` ne mesurent pas la même chose. Le premier note le
pipeline complet sur les photos réelles de `corpus/`, contre la vérité relevée à la main dans
`corpus/verite.json`. Le second note le seul modèle d'étiquetage sur le jeu synthétique, en F1 à
l'entité. Un bon score au second ne garantit pas le premier — c'est même tout l'intérêt de les
garder séparés.
