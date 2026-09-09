# syntax=docker/dockerfile:1

# Alambic : lecture de factures et de recus. Deploye comme service prive, joignable par la
# seule api de YieldMomo (voir ALAMBIC_URL de son cote) et jamais par un navigateur.
#
# linux/amd64 uniquement : paddlepaddle ne publie pas de wheel linux arm64. Sur Apple
# Silicon : docker build --platform linux/amd64 .
FROM node:22-slim
WORKDIR /app

# --- Sidecar ocr (etape Condensation) ---
# La couche la plus stable d'abord : elle ne bouge que si les dependances python changent.
# libgl1 et libglib2.0-0 : exigees par l'opencv que paddleocr installe.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY packages/condensation/sidecar/requirements.lock ./packages/condensation/sidecar/
RUN python3 -m venv /opt/ocr \
    && /opt/ocr/bin/pip install --no-cache-dir -r packages/condensation/sidecar/requirements.lock
COPY packages/condensation/sidecar ./packages/condensation/sidecar

# Les modeles sont telecharges au build, dans l'image : en production rien ne se telecharge et
# rien ne s'ecrit sur disque, le service reste sans etat.
ENV PADDLE_PDX_CACHE_HOME=/opt/paddlex
RUN /opt/ocr/bin/python packages/condensation/sidecar/serveur.py --preparer
ENV CHEMIN_PYTHON_OCR=/opt/ocr/bin/python

# --- Sidecar d'etiquetage (etape Collecte) ---
# Un venv separe de /opt/ocr : les pins de torch et de paddle ne se negocient jamais entre eux.
COPY packages/collecte/sidecar/requirements.lock ./packages/collecte/sidecar/
RUN python3 -m venv /opt/collecte \
    && /opt/collecte/bin/pip install --no-cache-dir -r packages/collecte/sidecar/requirements.lock
COPY packages/collecte/sidecar ./packages/collecte/sidecar

# Poids du modele dans l'image au build, comme les modeles paddle ; HF_HUB_OFFLINE garantit
# ensuite qu'aucune execution ne tentera de telecharger.
ENV HF_HOME=/opt/hf

# Le checkpoint maison pese plus d'un Go et ne se versionne pas : il vit sur un bucket
# compatible S3 (OVH Object Storage), et `npm run publier-modele` l'y depose. Vide, l'image se
# rabat sur le checkpoint public du Hub, qui travaille en zero-shot sur un recu quebecois : bon
# pour un essai, jamais pour la production — env.ts refuse d'y demarrer sans MODELE_COLLECTE.
ARG MODELE_S3_URI=""
ARG S3_ENDPOINT=https://s3.bhs.io.cloud.ovh.net
ARG S3_REGION=bhs

# Les poids entrent au build, jamais a l'execution : le conteneur reste sans etat et aucune
# clef S3 ne descend sur le serveur. --mount=type=secret et non ARG : un ARG resterait lisible
# dans `docker history`. Pas de pipe `aws | tar` non plus : le shell de debian ignore pipefail,
# et une descente coupee en deux passerait pour un succes.
RUN --mount=type=secret,id=S3_CLE \
    --mount=type=secret,id=S3_SECRET \
    if [ -z "$MODELE_S3_URI" ]; then \
      /opt/collecte/bin/python packages/collecte/sidecar/serveur.py --preparer; \
    else \
      python3 -m venv /tmp/s3 \
      && /tmp/s3/bin/pip install --no-cache-dir 'awscli<2' \
      && AWS_ACCESS_KEY_ID="$(cat /run/secrets/S3_CLE)" \
         AWS_SECRET_ACCESS_KEY="$(cat /run/secrets/S3_SECRET)" \
         AWS_DEFAULT_REGION="$S3_REGION" \
         /tmp/s3/bin/aws --endpoint-url "$S3_ENDPOINT" s3 cp "$MODELE_S3_URI" /tmp/modele.tar.gz \
      && mkdir -p /opt/modele-collecte \
      && tar -xzf /tmp/modele.tar.gz -C /opt/modele-collecte --strip-components=1 \
      && rm -rf /tmp/s3 /tmp/modele.tar.gz \
      && chmod -R a+rX /opt/modele-collecte \
      && /opt/collecte/bin/python packages/collecte/sidecar/serveur.py \
           --preparer --modele /opt/modele-collecte; \
    fi

ENV HF_HUB_OFFLINE=1
# Expansion docker : le chemin quand un bucket est configure, vide sinon. Vide vaut « non
# definie » pour env.ts, qui retombe alors sur le checkpoint public — et refuse en production.
ENV MODELE_COLLECTE=${MODELE_S3_URI:+/opt/modele-collecte}
ENV CHEMIN_PYTHON_COLLECTE=/opt/collecte/bin/python

# --- Service node ---
# Manifestes d'abord : le cache Docker du `npm ci` n'est invalide que si un package.json ou le
# lock change, pas a chaque edition de code.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/noyau/package.json ./packages/noyau/
COPY packages/chauffe/package.json ./packages/chauffe/
COPY packages/condensation/package.json ./packages/condensation/
COPY packages/collecte/package.json ./packages/collecte/
COPY packages/api/package.json ./packages/api/

# Le postinstall de la racine prepare les venvs des sidecars. Ici ils sont deja construits plus
# haut, et CHEMIN_PYTHON_OCR / CHEMIN_PYTHON_COLLECTE le lui disent ; le script doit tout de
# meme exister pour que npm ci aboutisse.
COPY outils/preparer-sidecars.ts ./outils/

# sharp s'installe par binaires precompiles sur node:22-slim (linux glibc x64 et arm64) :
# aucune chaine de compilation ni paquet libvips a ajouter a l'image.
RUN npm ci --omit=dev

COPY packages ./packages

ENV NODE_ENV=production

# Les operations sharp sont mises en file sur le pool de threads de libuv, qui est PARTAGE par
# tout le process — les worker_threads compris — et dimensionne a 4 par defaut. Avec un ouvrier
# par coeur moins un, tous se disputent ces 4 creneaux : c'est un plafond de debit dur, que le
# nombre d'ouvriers ne deplace pas. Genereux plutot qu'ajuste : un thread inoccupe ne coute
# qu'une pile, et la valeur doit rester au-dessus d'OUVRIERS sur la plus grosse machine visee.
# Ici et non dans .env : le pool se cree avant que dotenv n'ait lu quoi que ce soit.
ENV UV_THREADPOOL_SIZE=16

EXPOSE 3100

# /health et non /ready : les deux sondes exigent un ouvrier vivant et des moteurs prets, mais
# seule /health reste en 200 pendant une maintenance volontaire (MODE_MAINTENANCE). Viser /ready
# ferait redemarrer le conteneur en boucle pendant toute la maintenance, alors que le process va
# tres bien. /ready reste la sonde du load balancer, celle qui dit s'il faut envoyer du trafic.
# start-period de 300s : chaque sidecar charge son modele avant de repondre, /health attend les
# deux, et un vCore de vps met bien plus de temps qu'un M2 a lire plus d'un Go de poids. Trop
# court, la tache redemarrerait en boucle avant meme d'avoir vu le premier trafic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# tsx consomme la source TypeScript directement, sans pipeline de build a maintenir : c'est
# donc une vraie dependance de production, d'ou le `npm ci --omit=dev` plus haut.
#
# `node --import tsx` et non `npx tsx` : npx ne relaie pas SIGTERM a son enfant, donc l'arret
# gracieux ne s'executerait jamais et l'orchestrateur finirait par tuer le process. Ici node
# est PID 1 et recoit le signal directement.
# Le service ne sert que du json a partir d'images : rien n'y justifie les privileges de root.
# Rien n'est ecrit sur disque a l'execution — les venvs et les modeles sont bakes au build et ne
# sont plus que lus — donc un simple droit de lecture suffit, et les fichiers poses par root le
# sont en 644/755. Si une evolution venait a ecrire dans /opt/hf ou /opt/paddlex, il faudrait leur
# donner la propriete a node.
USER node

CMD ["node", "--import", "tsx", "packages/api/src/index.ts"]
