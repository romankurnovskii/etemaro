FROM node:24-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    procps \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-workspace.yaml tsconfig.json ./

COPY packages/ ./packages/
COPY scripts/ ./scripts/
COPY config/ ./config/

RUN pnpm install --no-frozen-lockfile

RUN mkdir -p /app/data && \
    if [ ! -f config/user-config.json ]; then cp config/user-config.example.json config/user-config.json; fi

ENV NODE_ENV=production

CMD ["node", "--import", "tsx", "packages/daemon/src/Daemon.ts"]
