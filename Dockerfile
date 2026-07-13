FROM node:24-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    procps \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/*/package.json ./packages/*/

RUN pnpm install --no-frozen-lockfile

COPY packages/ ./packages/
COPY scripts/ ./scripts/
COPY config/ ./config/

RUN pnpm run build

RUN mkdir -p /app/data && \
    if [ ! -f config/user-config.json ]; then cp config/user-config.example.json config/user-config.json; fi

ENV NODE_ENV=production

CMD ["node", "packages/daemon/dist/Daemon.js"]
