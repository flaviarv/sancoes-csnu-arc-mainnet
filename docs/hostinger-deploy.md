# Deploy na Hostinger VPS

## Pré-requisitos

- Plano **KVM 1** ou superior na Hostinger (~$5/mês)
- Sistema operacional: **Ubuntu 22.04** (escolha na criação do VPS)
- Acesso SSH ao servidor

---

## Passo 1 — Instalar Docker no VPS

Conecte via SSH e execute:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
```

---

## Passo 2 — Clonar o repositório

```bash
git clone https://github.com/flaviarv/sancoes-csnu-arc-mainnet
cd sancoes-csnu-arc-mainnet
```

---

## Passo 3 — Configurar variáveis de ambiente

Crie o arquivo `.env` no servidor (NUNCA faça commit deste arquivo):

```bash
nano .env
```

Adicione as seguintes variáveis:

```
TREASURY_PRIVATE_KEY=sua_chave_privada_sem_0x
CIRCLE_API_KEY=sua_circle_api_key
CIRCLE_ENTITY_SECRET=seu_entity_secret
```

Salve com `Ctrl+O`, depois `Ctrl+X`.

---

## Passo 4 — Fazer o deploy

```bash
chmod +x deploy.sh
./deploy.sh
```

Aguarde ~5 minutos para o build completar.

---

## Passo 5 — Verificar

```bash
docker compose ps        # deve mostrar "healthy"
curl http://localhost/   # deve retornar HTML
```

O site estará disponível em `http://IP_DO_SEU_VPS`.

---

## Passo 6 — Domínio próprio (opcional)

Se tiver um domínio na Hostinger:

1. No painel Hostinger, aponte o domínio para o IP do VPS (registro A)
2. Instale o Nginx como proxy reverso:

```bash
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/csnu
```

Cole:

```nginx
server {
    listen 80;
    server_name seu-dominio.com.br;

    location / {
        proxy_pass http://localhost:7860;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/csnu /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

3. Instale SSL gratuito com Certbot:

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d seu-dominio.com.br
```

---

## Atualizar o site

Quando houver novidades no código:

```bash
cd sancoes-csnu-arc-mainnet
git pull
./deploy.sh
```

---

## Solução de problemas

| Problema | Solução |
|---|---|
| Container não sobe | `docker compose logs` para ver o erro |
| Site não abre | `docker compose ps` — verificar se está "healthy" |
| Erro de chave privada | Verificar se `TREASURY_PRIVATE_KEY` está no `.env` sem aspas |
| Porta 80 bloqueada | `sudo ufw allow 80` e `sudo ufw allow 443` |
