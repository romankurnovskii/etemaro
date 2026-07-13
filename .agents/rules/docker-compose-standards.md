---
description: Expert Docker Compose standards for monorepo (Python 3.14 + Node 24, dev/prod, env files, volume mounts)
globs: ['docker-compose*.yml', 'docker-compose*.yml', 'Dockerfile*', '.env*']
version: 1.0.0
alwaysApply: false
trigger: always_on
---

# Docker Compose Architecture & Style Standards

This rule enforces production-grade Docker Compose patterns for a monorepo containing
a Python backend and a Node/React frontend, with clean dev/prod separation, correct
env file handling, and safe volume mount strategy.

---

## 1. Response Constraints (Strict)

- **Preservation**: Do NOT remove existing services, volumes, or networks unless explicitly asked.
- **Images**: Always use `python:3.14-slim` for Python services and `node:24-slim` for
  Node services. Never suggest alpine or other variants unless the user asks.
- **Formatting**: 2-space indent. No trailing spaces. One blank line between top-level keys.

---

## 2. Monorepo Directory Layout

```
repo-root/
├── apps/backend/
│   ├── Dockerfile
│   ├── src/
│   └── pyproject.toml
├── apps/frontend/
│   ├── Dockerfile
│   ├── src/
│   └── package.json
├── docker-compose.dev.yml      ← development (hot reload, volume mounts)
├── docker-compose.prod.yml     ← production (built images, no mounts)
├── .env                         ← local dev secrets (gitignored)
├── .env.example                 ← committed template with all keys, no values
└── .env.prod                    ← copy from remote prod server (gitignored, never edited locally)
```

---

## 3. Environment Files

### Rules

- **`.env`**: local development values. Always gitignored. Referenced in `docker-compose.dev.yml`.
- **`.env.prod`**: production values. Always gitignored. Never generated or edited locally —
  treat it as a read-only copy pulled from the remote server. Referenced in `docker-compose.prod.yml`.
- **`.env.example`**: committed to git. Contains every key with blank or placeholder values.
  This is the canonical record of what variables are required. Keep it in sync manually.
- Never hardcode secrets or URLs in any Compose file. All values come from env files.
- Never commit `.env` or `.env.prod`. Add both to `.gitignore`.

### `.gitignore` entries (required)

```gitignore
.env
.env.prod
```

### `.env.example` format

```dotenv
# Backend
MONGODB_URL=
MONGODB_DB_NAME=
POSTGRES_URL=
SECRET_KEY=
DEBUG=

# Frontend
VITE_API_URL=
VITE_APP_NAME=

# Shared
ALLOWED_ORIGINS=
```

---

## 4. Dockerfile Standards

### Backend (`apps/backend/Dockerfile`)

```dockerfile
FROM python:3.14-slim

WORKDIR /app

# Install system deps in one layer; clean apt cache in the same RUN
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
  && rm -rf /var/lib/apt/lists/*

# Copy dependency manifest first for layer caching
COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

# Copy source last (changes most often)
COPY src/ ./src/

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Frontend (`apps/frontend/Dockerfile`)

```dockerfile
FROM node:24-slim

WORKDIR /app

# Copy manifests first for layer caching
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source last
COPY . .

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

### Dockerfile Rules

- `COPY` manifests before source in every Dockerfile — this keeps the dependency
  install layer cached when only source files change.
- `--no-install-recommends` on all `apt-get install` calls.
- Clean apt cache in the same `RUN` layer: `&& rm -rf /var/lib/apt/lists/*`.
- `--no-cache-dir` on all `pip install` calls.
- `npm ci` (not `npm install`) for reproducible installs.
- Never install dev tools (curl, git, vim) in prod Dockerfiles.
- Prod Dockerfiles use multi-stage builds when a build step produces static assets.

---

## 5. Development Compose (`docker-compose.dev.yml`)

Key behaviours:

- Mounts source directories for hot reload — changes on host reflect instantly in container.
- **Never mounts `node_modules`** — the named volume `node_modules` shadows the host's
  directory so the container keeps its own compiled native modules.
- Uses `env_file: .env`.
- Exposes ports directly to localhost for easy debugging.
- Uses `watch` or `command` overrides to run dev servers, not prod servers.

```yml
services:
  backend:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile
    image: myapp-backend:dev
    command: uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
    env_file: .env
    ports:
      - '8000:8000'
    volumes:
      # Mount source for hot reload
      - ./apps/backend/src:/app/src
    depends_on:
      mongo:
        condition: service_healthy
    restart: unless-stopped

  frontend:
    build:
      context: ./apps/frontend
      dockerfile: Dockerfile
    image: myapp-frontend:dev
    command: npm run dev -- --host 0.0.0.0
    env_file: .env
    ports:
      - '5173:5173'
    volumes:
      # Mount source for hot reload
      - ./apps/frontend/src:/app/src
      - ./apps/frontend/public:/app/public
      # Named volume shadows host node_modules — container keeps its own
      - node_modules:/app/node_modules
    restart: unless-stopped

  mongo:
    image: mongo:7
    env_file: .env
    ports:
      - '27017:27017'
    volumes:
      - mongo_data:/data/db
    healthcheck:
      test: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # Uncomment if the project uses PostgreSQL
  # postgres:
  #   image: postgres:16-alpine
  #   env_file: .env
  #   ports:
  #     - "5432:5432"
  #   volumes:
  #     - postgres_data:/var/lib/postgresql/data
  #   healthcheck:
  #     test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]
  #     interval: 10s
  #     timeout: 5s
  #     retries: 5
  #   restart: unless-stopped

volumes:
  mongo_data:
  node_modules:
  # postgres_data:

networks:
  default:
    name: myapp-dev
```

---

## 6. Production Compose (`docker-compose.prod.yml`)

Key behaviours:

- No volume mounts for source code — image contains the built artifact.
- Uses `env_file: .env.prod` — this file is never generated locally; it is a copy
  from the remote prod server.
- No ports exposed directly on the host except via the reverse proxy.
- Healthchecks on every service.
- `restart: always` (not `unless-stopped`) for prod resilience.

```yml
services:
  backend:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile
    image: myapp-backend:latest
    env_file: .env.prod
    expose:
      - '8000'
    depends_on:
      mongo:
        condition: service_healthy
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8000/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 20s
    restart: always

  frontend:
    build:
      context: ./apps/frontend
      dockerfile: Dockerfile.prod # multi-stage: build → nginx
    image: myapp-frontend:latest
    env_file: .env.prod
    expose:
      - '80'
    restart: always

  nginx:
    image: nginx:1.27-alpine
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/certs:/etc/nginx/certs:ro
    depends_on:
      - backend
      - frontend
    restart: always

  mongo:
    image: mongo:7
    env_file: .env.prod
    expose:
      - '27017'
    volumes:
      - mongo_data:/data/db
    healthcheck:
      test: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s
    restart: always

  # Uncomment if the project uses PostgreSQL
  # postgres:
  #   image: postgres:16-alpine
  #   env_file: .env.prod
  #   expose:
  #     - "5432"
  #   volumes:
  #     - postgres_data:/var/lib/postgresql/data
  #   healthcheck:
  #     test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]
  #     interval: 30s
  #     timeout: 10s
  #     retries: 5
  #   restart: always

volumes:
  mongo_data:
  # postgres_data:

networks:
  default:
    name: myapp-prod
```

---

## 7. Frontend Production Dockerfile (multi-stage)

The prod frontend build compiles the React app and serves it with nginx — no Node
runtime in production.

```dockerfile
# apps/frontend/Dockerfile.prod

# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:24-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ── Stage 2: serve ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/app.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
```

---

## 8. Volume Mount Rules

| Mount target      | Dev             | Prod                | Reason                                      |
| ----------------- | --------------- | ------------------- | ------------------------------------------- |
| `apps/backend/src`     | ✅ bind mount   | ❌ no mount         | Hot reload; prod uses image copy            |
| `apps/frontend/src`    | ✅ bind mount   | ❌ no mount         | Hot reload; prod uses built artifact        |
| `apps/frontend/public` | ✅ bind mount   | ❌ no mount         | Static assets hot reload                    |
| `node_modules`    | ✅ named volume | ❌ no mount         | Prevents host overwriting container modules |
| DB data dir       | ✅ named volume | ✅ named volume     | Persist data across container restarts      |
| nginx config      | ❌ not in dev   | ✅ bind mount `:ro` | Prod routing; read-only for safety          |
| SSL certs         | ❌ not in dev   | ✅ bind mount `:ro` | Prod TLS; read-only for safety              |

### The `node_modules` Rule

Always declare `node_modules` as a named volume in the frontend dev service. Without
this, Docker bind-mounts the host directory over the container's `node_modules`,
destroying native binaries compiled for Linux. The named volume wins over the bind mount
because it is declared later in the `volumes` list under the service.

```yml
# CORRECT
volumes:
  - ./apps/frontend/src:/app/src          # bind mount — host wins
  - node_modules:/app/node_modules   # named volume — container wins

# WRONG — host node_modules overwrites container's compiled modules
volumes:
  - ./frontend:/app
```

---

## 9. Healthcheck Standards

Every stateful service (database, cache, queue) MUST have a healthcheck. Application
services in prod MUST have a healthcheck. Dev healthchecks are optional but recommended.

```yml
# MongoDB
healthcheck:
  test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
  interval: 10s      # dev
  timeout: 5s
  retries: 5

# PostgreSQL
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]
  interval: 10s
  timeout: 5s
  retries: 5

# FastAPI backend
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 20s   # allow app startup before first check
```

Use `depends_on: condition: service_healthy` so app services wait for databases to be
ready — not just started.

---

## 10. Named Networks

Always give the default network an explicit name. This makes `docker network ls` readable
and prevents Compose from generating opaque names like `myapp_default`.

```yml
networks:
  default:
    name: myapp-dev    # in docker-compose.dev.yml
    name: myapp-prod   # in docker-compose.prod.yml
```

---

## 11. Common Commands Reference

```bash
# Start dev environment
docker compose -f docker-compose.dev.yml up --build

# Start dev in background
docker compose -f docker-compose.dev.yml up -d --build

# Tail logs for one service
docker compose -f docker-compose.dev.yml logs -f backend

# Rebuild a single service without restarting others
docker compose -f docker-compose.dev.yml up -d --build backend

# Run a one-off command (e.g. Alembic migration) in dev
docker compose -f docker-compose.dev.yml exec backend alembic upgrade head

# Stop and remove containers (keep volumes)
docker compose -f docker-compose.dev.yml down

# Stop and remove containers AND volumes (wipe DB)
docker compose -f docker-compose.dev.yml down -v

# Production deploy (on remote server, .env.prod already present)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --build
```

---

## 12. Security Rules

- Never use `env_file: .env.prod` in a dev Compose file — a stale local `.env.prod`
  would silently point your dev containers at production databases.
- Never expose database ports (`27017`, `5432`) in prod — use `expose` (internal only),
  not `ports` (binds to host network).
- Nginx config and certs are always mounted `:ro` (read-only).
- `SECRET_KEY`, `MONGODB_URL`, and `POSTGRES_URL` must never appear in a committed file.
  They live only in `.env` (local) and `.env.prod` (remote).

---

## 13. Feature Checklist (Adding a New Service)

1. Add the service to **both** `docker-compose.dev.yml` and `docker-compose.prod.yml`.
2. Add any new env vars to **`.env.example`** with blank values.
3. Add the actual values to **`.env`** locally and update the remote `.env.prod` on the server.
4. Add a `healthcheck` to the new service.
5. Add `depends_on: condition: service_healthy` on any service that depends on it.
6. If it has persistent data, declare a named volume and add it to the top-level `volumes:` block.
7. Verify `.env` and `.env.prod` remain in `.gitignore`.
