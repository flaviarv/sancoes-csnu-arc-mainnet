# Deploy na Hostinger VPS — Guia Completo

## Pré-requisitos

- VPS Hostinger com Ubuntu 24.04
- Docker Desktop rodando (para testes locais)
- Acesso SSH ao servidor
- As 3 chaves do `.env` em mãos:
  - `TREASURY_PRIVATE_KEY` (chave privada da carteira MetaMask, sem `0x`)
  - `CIRCLE_API_KEY` (Live API Key do console.circle.com)
  - `CIRCLE_ENTITY_SECRET` (gerado no Arc Studio)

---

## PASSO 1 — Conectar ao servidor via SSH

No terminal do VS Code (ou qualquer terminal):

```bash
ssh root@SEU_IP_DO_VPS
```

Substitua `SEU_IP_DO_VPS` pelo IP que aparece no painel Hostinger em **VPS → Gerenciar → Visão geral**.

Digite a senha quando solicitado (os caracteres não aparecem — é normal).

---

## PASSO 2 — Instalar Docker no servidor

Execute um comando de cada vez:

```bash
curl -fsSL https://get.docker.com | sh
```

```bash
systemctl enable docker
```

```bash
systemctl start docker
```

Verifique se instalou corretamente:

```bash
docker --version
```

Deve aparecer algo como `Docker version 27.x.x`.

---

## PASSO 3 — Clonar o repositório em pasta separada (sem afetar o site atual)

```bash
cd ~
```

```bash
git clone https://github.com/flaviarv/sancoes-csnu-arc-mainnet csnu-novo
```

```bash
cd csnu-novo
```

---

## PASSO 4 — Criar o arquivo `.env` com as chaves

```bash
nano .env
```

Cole exatamente o texto abaixo, substituindo os valores reais:

```
TREASURY_PRIVATE_KEY=suachaveprivadaaqui
CIRCLE_API_KEY=suaapikeyaqui
CIRCLE_ENTITY_SECRET=seuEntitySecretaqui
```

**Importante:**
- `TREASURY_PRIVATE_KEY` é a chave privada exportada do MetaMask — **sem o prefixo `0x`**
- Não use aspas ao redor dos valores
- Não deixe espaços antes ou depois do `=`

Salve o arquivo: pressione `Ctrl+X`, depois `Y`, depois `Enter`.

Verifique se ficou correto:

```bash
cat .env
```

---

## PASSO 5 — Configurar para rodar na porta 7861 (sem afetar o site atual)

```bash
sed -i 's/7860:7860/7861:7860/' docker-compose.yml
```

---

## PASSO 6 — Liberar a porta 7861 no firewall

```bash
ufw allow 7861
```

```bash
ufw allow 22
```

```bash
ufw enable
```

Quando perguntar `Command may disrupt existing ssh connections. Proceed with operation (y|n)?`, digite `y` e pressione Enter.

---

## PASSO 7 — Build e subir o container

```bash
docker compose -p csnu-novo up -d --build
```

Este comando vai:
1. Baixar as imagens base (Node 22 + Python 3.13) — ~5 min na primeira vez
2. Compilar o frontend React
3. Instalar dependências Python
4. Subir o container em background

Acompanhe o progresso:

```bash
docker logs csnu-novo-app-1 --tail 50 -f
```

Pressione `Ctrl+C` para parar de acompanhar os logs (o container continua rodando).

Quando aparecer `Uvicorn running on http://0.0.0.0:7860`, o servidor está pronto.

---

## PASSO 8 — Testar o novo site

Abra no navegador:

```
http://SEU_IP_DO_VPS:7861
```

Teste:
1. Conecte a carteira Phantom (rede Arc Mainnet)
2. Clique em **CSNU Names** → pague 1 USDC → digite `Noor Wali Mehsud` → deve aparecer **SANCTIONED**
3. Clique em **Wallet Sanctions** → pague 1 USDC → cole um endereço → verifique

---

## PASSO 9 — Se tudo estiver correto, substituir o site atual

Pare o site antigo:

```bash
cd ~/sancoes-csnu-arc-mainnet
docker compose down
```

Volte para a nova pasta e mude para a porta 7860:

```bash
cd ~/csnu-novo
sed -i 's/7861:7860/7860:7860/' docker-compose.yml
docker compose -p csnu-novo down
docker compose up -d
```

Verifique:

```bash
docker ps
```

Deve aparecer o container rodando na porta `0.0.0.0:7860->7860/tcp`.

---

## PASSO 10 — Apontar o domínio (se tiver domínio na Hostinger)

No painel Hostinger: **Domínios → DNS → Adicionar registro A**:
- Nome: `@` (ou subdomínio desejado)
- Valor: IP do VPS
- TTL: 3600

Para usar na porta 80 (sem precisar digitar `:7860`), instale o Nginx:

```bash
apt install nginx -y
```

```bash
nano /etc/nginx/sites-available/csnu
```

Cole:

```nginx
server {
    listen 80;
    server_name SEU_DOMINIO.com;

    location / {
        proxy_pass http://localhost:7860;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Salve (`Ctrl+X` → `Y` → `Enter`) e ative:

```bash
ln -s /etc/nginx/sites-available/csnu /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
ufw allow 80
```

---

## Comandos úteis no servidor

| Comando | Para que serve |
|---|---|
| `docker ps` | Ver containers rodando |
| `docker logs csnu-novo-app-1 --tail 50` | Ver últimas 50 linhas do log |
| `docker compose restart` | Reiniciar o container |
| `docker compose down` | Parar o container |
| `docker compose up -d` | Subir o container |
| `docker compose up -d --build` | Rebuild e subir |

---

## Solução de problemas comuns

**Erro: `port is already allocated`**
```bash
docker compose down
docker compose up -d
```

**Erro: `no such file or directory` no `.env`**
Verifique se está na pasta correta (`cd ~/csnu-novo`) e se o `.env` existe (`ls -la`).

**Site abre mas pagamento falha**
Verifique se `TREASURY_PRIVATE_KEY` está sem o prefixo `0x` no `.env`.

**Site não abre**
```bash
ufw status
docker ps
curl http://localhost:7860
```
