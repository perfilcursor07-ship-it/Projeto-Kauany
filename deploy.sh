#!/usr/bin/env bash
# Deploy do Studio Flora (API Fastify + Frontend Next.js) no servidor.
# Uso:  bash deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Salvando mudanças locais (stash)"
git stash

echo "==> Atualizando codigo (git pull)"
git pull --ff-only origin main

echo "==> Aplicando mudanças locais de volta (stash pop - pode falhar, ok)"
git stash pop || echo "Nenhuma mudança local para restaurar (ok)"

echo "==> Instalando dependencias da API"
npm ci

echo "==> Gerando Prisma Client"
npx prisma generate

echo "==> Rodando migrations"
npm run migrate

echo "==> Instalando dependencias do frontend"
cd web
npm ci
echo "==> Buildando o frontend (next build)"
npm run build
cd ..

echo "==> (Re)iniciando PM2"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "==> Deploy concluido."
pm2 status
