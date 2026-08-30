# syntax=docker/dockerfile:1

# Alambic : lecture de factures et de recus. Deploye comme service prive, joignable par la
# seule api de YieldMomo (voir ALAMBIC_URL de son cote) et jamais par un navigateur.
FROM node:22-slim
WORKDIR /app

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

# /ready et non /health : un Alambic sans ouvrier vivant ne peut plus rien distiller, meme si
# son process repond encore. C'est la panne qu'un redemarrage repare.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# tsx consomme la source TypeScript directement, sans pipeline de build a maintenir : c'est
# donc une vraie dependance de production, d'ou le `npm ci --omit=dev` plus haut.
#
# `node --import tsx` et non `npx tsx` : npx ne relaie pas SIGTERM a son enfant, donc l'arret
# gracieux ne s'executerait jamais et l'orchestrateur finirait par tuer le process. Ici node
# est PID 1 et recoit le signal directement.
CMD ["node", "--import", "tsx", "packages/api/src/index.ts"]
