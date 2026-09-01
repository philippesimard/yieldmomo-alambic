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

# --- Service node ---
# Manifestes d'abord : le cache Docker du `npm ci` n'est invalide que si un package.json ou le
# lock change, pas a chaque edition de code.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/noyau/package.json ./packages/noyau/
COPY packages/chauffe/package.json ./packages/chauffe/
COPY packages/condensation/package.json ./packages/condensation/
COPY packages/collecte/package.json ./packages/collecte/
COPY packages/api/package.json ./packages/api/

# sharp s'installe par binaires precompiles sur node:22-slim (linux glibc x64 et arm64) :
# aucune chaine de compilation ni paquet libvips a ajouter a l'image.
RUN npm ci --omit=dev

COPY packages ./packages

ENV NODE_ENV=production
EXPOSE 3100

# /ready et non /health : un Alambic sans ouvrier vivant ou sans moteur ocr pret ne peut rien
# distiller, meme si son process repond encore. C'est la panne qu'un redemarrage repare.
# start-period de 90s : le sidecar charge son modele avant de repondre, et /ready l'attend.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# tsx consomme la source TypeScript directement, sans pipeline de build a maintenir : c'est
# donc une vraie dependance de production, d'ou le `npm ci --omit=dev` plus haut.
#
# `node --import tsx` et non `npx tsx` : npx ne relaie pas SIGTERM a son enfant, donc l'arret
# gracieux ne s'executerait jamais et l'orchestrateur finirait par tuer le process. Ici node
# est PID 1 et recoit le signal directement.
CMD ["node", "--import", "tsx", "packages/api/src/index.ts"]
