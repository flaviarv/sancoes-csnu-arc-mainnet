# agent-gateway

Portão de pagamento **x402 (Circle Gateway Nanopayments)** na frente da API de sanções do
criptokyc.tech, para agentes de IA pagarem por consulta, sem carteira Phantom, sem sessão e sem gás.

Esta pasta é **isolada do site**: não altera `main_docker.py`, o `Dockerfile`, o
`docker-compose.yml` nem o frontend. O site em produção continua com o pagamento ERC-8183.

> **Status: somente testnet.** Esta versão recusa iniciar fora da testnet. Os preços em
> `pricing.ts` são valores de teste e precisam ser definidos pela proprietária.

## Como funciona

```
Agente ──POST /v1/csnu/check──▶ proxy x402 (Express, :3100)
                                  │ 1. valida o pedido (400 se inválido, sem cobrar)
                                  │ 2. confere se a API interna está de pé (503, sem cobrar)
                                  │ 3. sem pagamento: 402 com preço e destino
                                  │ 4. com pagamento válido: liquida via Gateway
                                  ▼
                           API interna (FastAPI, 127.0.0.1:3101) ──▶ pipeline/ + data/raw/
```

| Endpoint | Preço (teste) | Corpo |
|---|---|---|
| `POST /v1/csnu/check` | $0.01 | `{"names": ["..."]}` (até 50) |
| `POST /v1/wallets/check` | $0.02 | `{"wallets": ["..."]}` (até 50) |
| `GET /v1/pricing`, `GET /health` | grátis | |

## Segurança

- O servidor só conhece o **endereço** que recebe (`SELLER_ADDRESS`). Nenhuma chave privada
  é necessária no proxy.
- O pedido é validado **antes** da cobrança, e a API interna é checada antes de cobrar.
- Nomes e carteiras consultados **não são registrados** em log (dado sensível). O log só
  guarda pagador, valor, rede e rota.
- A API interna só escuta em `127.0.0.1` e não tem autenticação própria: nunca a exponha.
- O proxy aceita só carteiras **EOA** (Nanopayments não suporta contratos/ERC-1271).

## Rodar em testnet

```bash
# 1. dependências
cd agent-gateway && bun install

# 2. API interna (a partir de agent-gateway/)
python3 -m uvicorn internal_api:app --host 127.0.0.1 --port 3101

# 3. proxy (outro terminal)
SELLER_ADDRESS=0xSEU_ENDERECO X402_NETWORK=testnet bun run start

# 4. teste de compra: gera uma carteira descartável, financie-a na faucet e pague
bun run wallet:new
bun run buyer:test -- --deposit 1
```

Variáveis (veja `.env.example`): `SELLER_ADDRESS` (obrigatória), `X402_NETWORK=testnet`,
`PORT` (padrão 3100), `INTERNAL_API_URL` (padrão `http://127.0.0.1:3101`).

## O que ainda falta antes de produção

1. Decidir os preços definitivos (`pricing.ts`, arquivo protegido).
2. Confirmar a taxa de venda do Nanopayments e como sacar o saldo Gateway da treasury.
3. Habilitar mainnet (exige o aviso de mainnet e revisão independente).
4. Adicionar o proxy e a API interna ao `docker-compose.yml` (rede privada entre os dois).
5. Servidor MCP com as duas ferramentas e, opcionalmente, listagem no Agent Marketplace.
