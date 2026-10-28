#!/bin/bash
# deploy.sh — executa no servidor Hostinger VPS após git pull
set -e

echo "==> Parando container anterior..."
docker compose down 2>/dev/null || true

echo "==> Fazendo build da nova imagem..."
docker compose build --no-cache

echo "==> Iniciando container..."
docker compose up -d

echo "==> Status:"
docker compose ps

echo ""
echo "Deploy concluído. Site disponível na porta 80."
