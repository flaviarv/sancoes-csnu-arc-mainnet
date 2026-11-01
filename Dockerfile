# ── PROTECTED ─────────────────────────────────────────────────
# Dockerfile de produção do criptokyc.tech.
# NÃO modifique sem aprovação explícita da proprietária.
# Alterações aqui afetam o build e o deploy na Hostinger.
# ──────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────
# Stage 1 — build do frontend React/Vite
# ─────────────────────────────────────────────
FROM node:22-alpine AS frontend-build

WORKDIR /app

RUN npm install -g bun@1

# Instala dependências primeiro (cache layer)
COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile

# Copia código-fonte do frontend
COPY frontend/index.html ./
COPY frontend/vite.config.ts ./
COPY frontend/tsconfig.json ./
COPY frontend/tailwind.config.js ./
COPY frontend/postcss.config.js ./
COPY frontend/src/ ./src/

# Build de produção
RUN bunx vite build

# ─────────────────────────────────────────────
# Stage 2 — backend FastAPI + arquivos estáticos
# ─────────────────────────────────────────────
FROM python:3.13-slim

WORKDIR /app

# Dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Dependências Python
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Código e dados do backend
COPY main_docker.py ./main.py
COPY csnu_list.parquet ./csnu_list.parquet

# Pipeline de carteiras sancionadas
COPY carteiras-sancao-governamental-internacional/ ./carteiras-sancao-governamental-internacional/

# Frontend compilado (do stage 1)
COPY --from=frontend-build /app/dist ./static

EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
