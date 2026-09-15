FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/tmp/sage-data \
    MANUAL_PATH=./knowledge-base/sal/data/sal-guide-chunks.jsonl

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/sage-data \
    && chown node:node /tmp/sage-data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY knowledge-base/sal/data/sal-guide-chunks.jsonl \
    ./knowledge-base/sal/data/sal-guide-chunks.jsonl

USER node

EXPOSE 3000

CMD ["node", "dist/src/index.js"]
