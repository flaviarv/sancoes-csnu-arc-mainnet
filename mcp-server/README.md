# criptokyc-mcp

Servidor MCP de triagem de sanções (nomes CSNU e carteiras cripto), pago por consulta em USDC via x402
(Circle Gateway Nanopayments). Funciona com qualquer cliente MCP: Claude Desktop, Claude Code, Cursor,
Windsurf, Cline, VS Code e outros que falem MCP por stdio.

**Estado atual: somente testnet.** Mainnet está desabilitada de propósito nesta versão.

## Ferramentas

| Ferramenta | Custo | O que faz |
|---|---|---|
| `check_csnu_names` | pago (ver `get_pricing`) | Confere até 50 nomes na lista do Conselho de Segurança da ONU |
| `check_wallet_sanctions` | pago (ver `get_pricing`) | Confere até 50 carteiras em OFAC, Israel NBCTF, UK, UE, ONU e SECO |
| `get_pricing` | grátis | Preço atual por chamada |
| `get_budget` | grátis | Carteira pagadora, saldo, gasto da sessão e tetos |

## Segurança (leia antes de usar)

- **A IA só consegue gastar, nunca mover fundos.** Não existe ferramenta de depósito, saque ou transferência.
  O depósito é um comando humano (`bun run deposit`).
- **Tetos de gasto.** Padrão: 0,05 USDC por chamada e 0,50 USDC por sessão. A chamada é recusada **antes** de
  assinar se passar do teto (`CRIPTOKYC_MAX_PRICE_PER_CALL`, `CRIPTOKYC_MAX_SPEND_PER_SESSION`).
- **Use uma carteira só para isso**, com pouco saldo. A chave fica no `env` do cliente MCP, que normalmente é um
  arquivo de configuração em texto puro na sua máquina. Nunca use a carteira principal.
- A chave nunca aparece em respostas nem em logs (logs vão para stderr e passam por filtro).
- A consulta é enviada ao servidor da API. Nomes e carteiras consultados **não são gravados em log** pelo gateway.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `CRIPTOKYC_BUYER_PRIVATE_KEY` | sim | Chave (`0x` + 64 hex) da carteira que paga |
| `CRIPTOKYC_API_URL` | não | URL do gateway. Padrão `http://127.0.0.1:3100` (local, testnet) |
| `CRIPTOKYC_MAX_PRICE_PER_CALL` | não | Teto por chamada em USDC (padrão `0.05`) |
| `CRIPTOKYC_MAX_SPEND_PER_SESSION` | não | Teto por sessão em USDC (padrão `0.50`) |

## Preparar a carteira (uma vez)

1. Gere uma carteira de teste: `bun run ../agent-gateway/scripts/new-test-wallet.ts` (a chave vai para
   `../agent-gateway/.env.buyer`, só o endereço aparece no terminal).
2. Coloque USDC de teste da Arc Testnet nela (botão "Get test USDC" do Arc Studio ou faucet.circle.com).
3. Deposite no Gateway, uma vez, com gás: `CRIPTOKYC_BUYER_PRIVATE_KEY=0x... bun run deposit -- 1`.

Depois disso o agente paga as consultas sem gás, só do saldo Gateway.

## Instalar nos clientes

Use o caminho **absoluto** da pasta no lugar de `/CAMINHO/mcp-server`. Requer [Bun](https://bun.sh)
(ou Node 22.18+ rodando `node /CAMINHO/mcp-server/index.ts`). O gateway e a API interna precisam estar no ar
(veja `../agent-gateway/README.md`).

**Claude Desktop** (`claude_desktop_config.json`) e **Cursor** (`~/.cursor/mcp.json`, ou `.cursor/mcp.json` no projeto):

```json
{
  "mcpServers": {
    "criptokyc": {
      "command": "bun",
      "args": ["run", "/CAMINHO/mcp-server/index.ts"],
      "env": {
        "CRIPTOKYC_BUYER_PRIVATE_KEY": "0x...",
        "CRIPTOKYC_API_URL": "http://127.0.0.1:3100"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add criptokyc -e CRIPTOKYC_BUYER_PRIVATE_KEY=0x... -e CRIPTOKYC_API_URL=http://127.0.0.1:3100 -- bun run /CAMINHO/mcp-server/index.ts
```

Windsurf, Cline e VS Code usam o mesmo formato `command` / `args` / `env` no arquivo de MCP de cada um.

> Estes trechos seguem o formato padrão de cada cliente, mas o servidor foi testado aqui com um cliente MCP
> de teste (SDK oficial), não dentro de cada aplicativo. Teste cada cliente antes de recomendá-lo a alguém.

## IAs sem MCP

O gateway publica um OpenAPI em `GET /openapi.json`. Qualquer agente que fale HTTP e x402 pode consumir a API
direto, sem este servidor. Chamadas sem pagamento recebem `402` com as condições.

## Testes

```bash
bun run test:client   # sobe o servidor como processo filho e fala MCP de verdade (11 verificações)
bun run typecheck
```

## Para uso público (ainda não feito)

1. Hospedar o gateway e a API interna em URL pública com HTTPS e apontar `CRIPTOKYC_API_URL` para ela.
2. Definir os preços finais em `../agent-gateway/pricing.ts` e confirmar a taxa de venda do Nanopayments com a Circle.
3. Habilitar mainnet (exige revisão e o aviso de mainnet) e sacar o saldo Gateway da treasury.
4. Publicar o pacote (por exemplo no npm) para instalar com um comando.
