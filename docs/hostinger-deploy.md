# Deploy na Hostinger VPS — Guia Completo

## Pré-requisitos
- VPS Hostinger com Ubuntu 22.04 ou 24.04
- Docker Desktop rodando na sua máquina (para testes locais)
- Credenciais: TREASURY_PRIVATE_KEY (obrigatória) e SESSION_SECRET (recomendada)

---

## PARTE 1 — Conectar ao servidor

No terminal do VS Code (ou qualquer terminal):

```bash
ssh root@SEU_IP_DO_VPS
```

Digite a senha que a Hostinger enviou por email.
(A senha não aparece enquanto você digita — é normal.)

---

## PARTE 2 — Instalar Docker no servidor (só na primeira vez)

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
docker --version
```

Resultado esperado: `Docker version 27.x.x`

---

## PARTE 3 — Clonar o repositório

```bash
cd ~
git clone https://github.com/flaviarv/sancoes-csnu-arc-mainnet
cd sancoes-csnu-arc-mainnet
ls
```

Você deve ver: `Dockerfile`, `docker-compose.yml`, `main_docker.py`, `pipeline/`, `data/`, `frontend/`

---

## PARTE 4 — Criar o arquivo .env com as chaves

```bash
nano .env
```

Cole exatamente isso (substitua pelos valores reais):

```
TREASURY_PRIVATE_KEY=suachaveprivadaSEM0x
SESSION_SECRET=gere_com_openssl_rand_-hex_32
```

Salvar: pressione `Ctrl+X`, depois `Y`, depois `Enter`.

Verificar se foi salvo:
```bash
cat .env
```

---

## PARTE 5 — Liberar portas no firewall

```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw --force enable
ufw status
```

---

## PARTE 6 — Build e deploy do container

```bash
docker compose up -d --build
```

Aguarde 5-10 minutos. O Docker vai:
1. Baixar as imagens base (Node + Python)
2. Compilar o React para produção
3. Instalar dependências Python
4. Subir o container

Verificar se está rodando:
```bash
docker ps
```

Deve aparecer `csnu-checker` com status `Up`.

Ver logs:
```bash
docker logs csnu-checker --tail 50
```

Deve aparecer:
```
Dataset carregado: 1387 nomes únicos indexados.
Wallet sanctions loaded: 1667 addresses.
Uvicorn running on http://0.0.0.0:7860
```

---

## PARTE 7 — Testar

Abra no navegador:
```
http://SEU_IP_DO_VPS
```

Substitua pelo IP real do seu VPS (ex: `http://185.241.xx.xx`).

---

## PARTE 8 — Apontar domínio (opcional)

No painel Hostinger:
1. DNS → Adicionar registro A
2. Nome: `@` (raiz) ou `www`
3. Valor: IP do VPS
4. TTL: 300

Aguarde até 24h para propagar.

---

## PARTE 9 — Atualizar o site no futuro

Quando houver uma nova versão no GitHub:

```bash
cd ~/sancoes-csnu-arc-mainnet
git pull origin main
docker compose down
docker compose up -d --build
```

---

## PARTE 10 — Solução de problemas

**Container não sobe:**
```bash
docker logs csnu-checker
```

**Porta 80 ocupada:**
```bash
sudo lsof -i :80
sudo systemctl stop apache2  # ou nginx
docker compose up -d
```

**Reiniciar o container:**
```bash
docker compose restart
```

**Parar tudo:**
```bash
docker compose down
```
