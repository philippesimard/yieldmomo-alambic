# syntax=docker/dockerfile:1

# Alambic : lecture de factures et de recus. Deploye comme service prive, joignable par la
# seule api de YieldMomo (voir ALAMBIC_URL de son cote) et jamais par un navigateur.
#
# Aucun Python : l'ocr et le modele de la Collecte tournent en ONNX dans les ouvriers node
# (MOTEUR_OCR=onnx, MOTEUR_COLLECTE=onnx). Construit et mesure en linux/amd64, la plateforme du
# VPS. Sur Apple Silicon : docker build --platform linux/amd64 .
FROM node:22-slim
WORKDIR /app

# curl : la descente du modele de la Collecte au build, et rien d'autre.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Le modele de la Collecte (190 Mo, exporte par `npm run exporter-modele`) ne se versionne pas :
# il vit sur un bucket compatible S3 (OVH Object Storage), et `npm run publier-modele` l'y
# depose. Les modeles de l'ocr, eux, sont dans le depot (packages/condensation/modeles).
#
# Les poids entrent au build, jamais a l'execution : le conteneur reste sans etat. MODELE_URL
# est une URL presignee que `npm run publier-modele` emet, valable sept jours : aucune clef S3
# ne descend sur le serveur, et l'URL ne vaut plus rien une fois expiree. Vide, l'image n'a pas
# de modele de Collecte, et env.ts refuse d'y demarrer en production.
#
# Pas de pipe `curl | tar` : le shell de debian ignore pipefail, et une descente coupee en deux
# passerait pour un succes. --fail pour qu'une reponse 403 ne s'ecrive pas dans l'archive.
ARG MODELE_URL=""
RUN if [ -n "$MODELE_URL" ]; then \
      curl --fail --silent --show-error --location --retry 3 \
           --output /tmp/modele.tar.gz "$MODELE_URL" \
      && mkdir -p /opt/modele-collecte \
      && tar -xzf /tmp/modele.tar.gz -C /opt/modele-collecte --strip-components=1 \
      && rm -f /tmp/modele.tar.gz \
      && chmod -R a+rX /opt/modele-collecte; \
    fi
# Expansion docker : le chemin quand une URL est fournie, vide sinon. Vide vaut « non definie »
# pour env.ts, qui refuse alors de demarrer en production.
ENV MODELE_COLLECTE=${MODELE_URL:+/opt/modele-collecte}

# --- Service node ---
# Manifestes d'abord : le cache Docker du `npm ci` n'est invalide que si un package.json ou le
# lock change, pas a chaque edition de code.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/noyau/package.json ./packages/noyau/
COPY packages/chauffe/package.json ./packages/chauffe/
COPY packages/condensation/package.json ./packages/condensation/
COPY packages/collecte/package.json ./packages/collecte/
COPY packages/api/package.json ./packages/api/

# Le postinstall de la racine prepare les venvs Python du poste ; ALAMBIC_SANS_SIDECARS le coupe
# ici, ou il n'y a rien a preparer. Le script doit tout de meme exister pour que npm ci aboutisse.
COPY outils/preparer-sidecars.ts ./outils/

# sharp s'installe par binaires precompiles sur node:22-slim (linux glibc x64 et arm64) :
# aucune chaine de compilation ni paquet libvips a ajouter a l'image. onnxruntime-node embarque
# deja son binaire linux x64 ; sans ONNXRUNTIME_NODE_INSTALL, son postinstall irait chercher les
# bibliotheques CUDA, inutiles sur un serveur sans carte graphique.
ENV ALAMBIC_SANS_SIDECARS=1 ONNXRUNTIME_NODE_INSTALL=skip
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

# /health et non /ready : les deux sondes exigent un ouvrier vivant, mais seule /health reste en
# 200 pendant une maintenance volontaire (MODE_MAINTENANCE). Viser /ready ferait redemarrer le
# conteneur en boucle pendant toute la maintenance, alors que le process va tres bien. /ready
# reste la sonde du load balancer, celle qui dit s'il faut envoyer du trafic.
# start-period de 30s : il n'y a plus de sidecar a attendre ; chaque ouvrier charge ses modeles a
# sa premiere facture.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# tsx consomme la source TypeScript directement, sans pipeline de build a maintenir : c'est
# donc une vraie dependance de production, d'ou le `npm ci --omit=dev` plus haut.
#
# `node --import tsx` et non `npx tsx` : npx ne relaie pas SIGTERM a son enfant, donc l'arret
# gracieux ne s'executerait jamais et l'orchestrateur finirait par tuer le process. Ici node
# est PID 1 et recoit le signal directement.
# Le service ne sert que du json a partir d'images : rien n'y justifie les privileges de root.
# Rien n'est ecrit sur disque a l'execution — les modeles sont bakes au build et ne sont plus que
# lus — donc un simple droit de lecture suffit, et les fichiers poses par root le sont en
# 644/755.
USER node

CMD ["node", "--import", "tsx", "packages/api/src/index.ts"]
