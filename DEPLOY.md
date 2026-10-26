# Deploy em produção (CloudPanel + PM2)

Este projeto tem **dois serviços** que rodam juntos:

| Serviço | O que é | Porta |
| --- | --- | --- |
| `studioflora-api` | Backend Fastify (API `/api/*`, `/health`) | **3333** |
| `studioflora-web` | Frontend Next.js (todas as telas) | **3000** |

O domínio `studioflora.site` deve servir o **frontend (3000)** em `/`, e
encaminhar `/api` para a **API (3333)**. Hoje ele aponta direto para a API — por
isso `https://studioflora.site/` responde `Route GET:/ not found` (404 da API).

> **Portas**: a API usa a porta do `.env` (`PORT`) — você vinha usando **3007**.
> Pode manter 3007 na API e usar 3000 no web; o importante é que **as portas
> estejam livres** (você tem outros projetos) e **batam com o nginx** (passo 4).
> Neste guia uso 3333 (API) e 3000 (web) como exemplo — ajuste se precisar.

> **Importante**: antigamente havia um único processo PM2 chamado `studioflora`
> rodando só a API. Ele será substituído por `studioflora-api` + `studioflora-web`.
> Remova o antigo: `pm2 delete studioflora`.

---

## 0. Publicar as mudanças do dev (no seu PC)

O servidor só recebe o que estiver no GitHub. Antes de tudo, no seu PC:

```bash
git add -A
git commit -m "deploy: api+web no pm2, nginx /api, guia de deploy"
git push origin main
```

---

## 1. Resolver o conflito do git no servidor

O servidor tem alterações locais que travam o `git pull`. Descarte-as (a fonte
da verdade é o GitHub):

```bash
cd /home/studioflora/htdocs/studioflora.site
git stash            # guarda as alterações locais (pode inspecionar depois com: git stash show -p)
git pull --ff-only origin main
```

Se não quiser guardar nada:

```bash
git checkout -- package.json web/lib/api.ts web/next.config.mjs
git pull --ff-only origin main
```

---

## 2. Rodar o deploy (um comando)

```bash
bash deploy.sh
```

Esse script faz: `git pull` → instala deps da API → `prisma generate` →
migrations → instala deps do web → `next build` → (re)inicia os dois serviços no
PM2 e salva.

> Observação: **NÃO** use `npm ci --omit=dev` — o `next build` precisa das
> devDependencies (tailwind, typescript). O `deploy.sh` já usa `npm ci` completo.

Os comandos `build:css` e `gateway:sync` **não existem** neste projeto (eram de
outro projeto seu). Ignore-os.

---

## 3. Variáveis de ambiente no servidor

Crie/edite o `.env` na raiz (backend):

```env
DATABASE_URL="mysql://USUARIO:SENHA@localhost:3306/studioflora"
DB_HOST="localhost"
DB_PORT="3306"
DB_USER="USUARIO"
DB_PASSWORD="SENHA"
DB_NAME="studioflora"

PORT="3333"
HOST="127.0.0.1"
NODE_ENV="production"
PUBLIC_API_URL="https://studioflora.site"

JWT_SECRET="uma-chave-bem-grande-e-aleatoria"

WHATSAPP_MODE="baileys"
PAYMENTS_MODE="fake"       # troque para "pagbank" quando tiver o token
PAGBANK_TOKEN="seu-token"
```

O frontend usa chamadas **relativas** (`/api/...`), então **não precisa** de
`NEXT_PUBLIC_API_URL` no servidor — o nginx encaminha `/api` para a porta 3333
(passo 4). Se existir um `web/.env.local` antigo apontando para `localhost:3333`,
apague-o no servidor.

---

## 4. Configurar o nginx (CloudPanel)

No CloudPanel: **Sites → studioflora.site → Vhost**. Garanta que o `location /`
aponte para a porta **3000** e adicione, **antes** dele, os blocos de `/api` e
`/health` apontando para **3333**:

```nginx
location /api/ {
    client_max_body_size 8m;
    proxy_pass http://127.0.0.1:3333;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
}

location = /health {
    proxy_pass http://127.0.0.1:3333/health;
}

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Salve e o CloudPanel recarrega o nginx. Como você tem **vários projetos** no
servidor, confira que **as portas 3000 e 3333 não estão em uso** por outro app
(veja `pm2 list`). Se estiverem, troque as portas deste projeto (no `.env` a
`PORT` da API e no `ecosystem.config.cjs` a `PORT` do web) e ajuste o nginx.

---

## 5. Conferir

```bash
pm2 status
curl -s http://127.0.0.1:3333/health     # API viva
curl -s http://127.0.0.1:3000 | head     # HTML do Next
```

Depois abra `https://studioflora.site/` (deve carregar a página de agendamento)
e `https://studioflora.site/admin` (painel).

---

## Atualizações futuras

Sempre que fizer mudanças no dev e quiser publicar:

```bash
# no seu PC:
git add -A && git commit -m "..." && git push origin main

# no servidor:
cd /home/studioflora/htdocs/studioflora.site
bash deploy.sh
```
