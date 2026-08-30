FROM node:24-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    procps \
    python3 \
    make \
    g++ \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-workspace.yaml tsconfig.json ./

COPY packages/ ./packages/
COPY scripts/ ./scripts/
COPY config/ ./config/

RUN pnpm install --no-frozen-lockfile

RUN mkdir -p /app/data /app/config

ENV NODE_ENV=production

CMD ["node", "--import", "tsx", "packages/daemon/src/Daemon.ts"]
