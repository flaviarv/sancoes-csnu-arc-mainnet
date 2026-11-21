# Deploy do agent-gateway na Hostinger (testnet)

Coloca o gateway x402 numa URL pública com HTTPS, para os agentes de IA (MCP ou OpenAPI) o usarem.
**Esta versão roda só em testnet**: os pagamentos não têm valor real. Mainnet é uma decisão e uma revisão à parte.
O site (`docker-compose.yml`) não é alterado por nada aqui.

## Visão geral

```
agente de IA ──HTTPS──> Caddy (agents.criptokyc.tech) ──> agent-gateway :3100 ──rede interna──> agent-internal :3101
                                                          (x402, cobra)                          (dados; sem porta pública)
```

## 1. DNS

No DNS do domínio, crie um registro **A**: `agents` apontando para o IP do VPS (ex.: `agents.criptokyc.tech`).
Espere propagar antes do passo 4.

## 2. Código e variáveis (no VPS)

```bash
cd ~/sancoes-csnu-arc-mainnet
git pull origin main
nano .env.agents
```

Conteúdo do `.env.agents` (duas linhas). O endereço é público; **nunca coloque chave privada aqui**:

```
SELLER_ADDRESS=0xd2f80f6cf27483392f70f21b3381109f9c33c390
INTERNAL_TOKEN=cole_aqui_o_resultado_de_openssl_rand_-hex_32
```

Gere o `INTERNAL_TOKEN` no servidor com `openssl rand -hex 32` e cole o resultado. Ele é um segredo
compartilhado entre o proxy e a API interna: mesmo que alguém publique a porta da API interna por engano,
sem o token ninguém lê os dados sem pagar. O compose se recusa a subir sem ele.

Os containers rodam endurecidos: sem root, sistema de arquivos somente leitura, sem nenhuma capability do
Linux e com limite de processos.

Esse arquivo é separado do `.env` do site de propósito. O `.gitignore` já ignora `.env.*`.

## 3. Subir os containers

```bash
docker compose --env-file .env.agents -f docker-compose.agents.yml up -d --build
docker ps --filter name=criptokyc-agent
```

Os dois devem aparecer como `healthy`. O gateway escuta só em `127.0.0.1:3100`; a API interna não tem porta publicada.

## 4. HTTPS com Caddy

O Caddy precisa das portas 80 e 443. Se o site ainda publica a porta 80 (`"80:7860"` no `docker-compose.yml`),
troque no servidor para `"127.0.0.1:7860:7860"` e reinicie o site, senão o Caddy não consegue subir.
Esse arquivo é versionado: ao fazer `git pull` depois, pode dar conflito. Resolva mantendo a sua versão do servidor.

```bash
apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
criptokyc.tech {
  reverse_proxy 127.0.0.1:7860
}

agents.criptokyc.tech {
  reverse_proxy 127.0.0.1:3100
}
```

```bash
systemctl reload caddy
```

## 5. Verificar

```bash
curl -s https://agents.criptokyc.tech/health
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://agents.criptokyc.tech/v1/csnu/check \
  -H 'Content-Type: application/json' -d '{"names":["teste"]}'      # esperado: 402
curl -s https://agents.criptokyc.tech/openapi.json | head -c 200
```

Para um pagamento de ponta a ponta, use o `mcp-server` (veja `../mcp-server/README.md`) com
`CRIPTOKYC_API_URL=https://agents.criptokyc.tech`.

## Operação

| Tarefa | Comando |
|---|---|
| Logs do gateway | `docker logs criptokyc-agent-gateway --tail 50` |
| Atualizar o código | `git pull && docker compose --env-file .env.agents -f docker-compose.agents.yml up -d --build` |
| Atualizar as listas de sanções | os parquets são copiados para a imagem: rode o comando de "Atualizar o código" depois de atualizar `data/raw/` |
| Parar | `docker compose --env-file .env.agents -f docker-compose.agents.yml down` |

Os logs registram só pagador, valor e rota. Os nomes e carteiras consultados **não** são registrados.

## Antes de usar com dinheiro real (não feito)

1. Definir os preços finais em `pricing.ts` e confirmar a taxa de venda do Nanopayments com a Circle.
2. Habilitar mainnet no gateway (hoje ele se recusa a iniciar fora da testnet) com revisão e o aviso de mainnet.
3. Sacar periodicamente o saldo Gateway da treasury para a carteira normal.
4. Monitorar o saldo da carteira que recebe e o espaço em disco do VPS.
