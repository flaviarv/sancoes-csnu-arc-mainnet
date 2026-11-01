# criptokyc.tech — Sanctions Intelligence

> Built with Arc Studio - money-powered apps in minutes

---

## REGRAS PARA IA — LEIA ANTES DE QUALQUER MODIFICAÇÃO

**NÃO modifique sem instrução explícita da proprietária:**

- `src/config/business-rules.ts` — preço, endereços, chain ID
- `contracts/AgenticCommerce.sol` — contrato deployado em produção
- `TREASURY_ADDRESS` — carteira que recebe os pagamentos
- `SEARCH_PRICE_USDC` — preço fixo de 1 USDC por consulta
- `CHAIN_ID: 5042` — Arc Mainnet (produção)
- `AGENTIC_COMMERCE_ADDRESS` — endereço do contrato deployado

**Para adicionar um novo produto:**
1. Copie `src/products/_template/` para `src/products/novo-produto/`
2. Adicione o produto em `src/config/business-rules.ts` → `PRODUCTS`
3. Registre a rota no backend em `main_docker.py`
4. Importe no `src/App.tsx` e adicione uma nova aba

---

## Repository

- **Mainnet repo (active):** https://github.com/flaviarv/sancoes-csnu-arc-mainnet
- **Testnet repo (frozen):** https://github.com/flaviarv/sancoes-csnu-arc — NÃO fazer push aqui.

---

## Deployed Contract (AgenticCommerce — ERC-8183)

- Address: `0x975a005E4107c12e585DB71059fe857449510c99`
- Chain: Arc Mainnet (Chain ID: 5042)
- Deploy tx: `0x2615c0f9fe1c53e7fd0740a3be6a324a5d4d373bad7da334f4ad997cb81144d7`
- Treasury: `0xd2f80f6cf27483392f70f21b3381109f9c33c390`
- USDC: `0x3600000000000000000000000000000000000000`
- platformFeeBps: 100 (1%)
- SEARCH_PRICE_USDC: 1_000_000 (1 USDC)

---

## Project Structure

```
src/
├── config/
│   └── business-rules.ts     ← IMUTÁVEL — regras de negócio centralizadas
├── products/
│   ├── csnu-checker/
│   │   └── CsnuChecker.tsx   ← verifica nomes na lista CSNU
│   ├── wallet-sanctions/
│   │   └── WalletChecker.tsx ← verifica carteiras em 6 listas
│   └── _template/
│       └── ProductChecker.tsx ← template para novos produtos
├── shared/
│   └── components/
│       └── PaymentGate.tsx   ← pagamento ERC-8183 reutilizável
└── App.tsx                   ← composição das abas
```

---

## Products

| Produto | Arquivo | Endpoint backend |
|---|---|---|
| CSNU Names | `products/csnu-checker/CsnuChecker.tsx` | `POST /api/check-names` |
| Wallet Sanctions | `products/wallet-sanctions/WalletChecker.tsx` | `POST /api/check-wallets` |

---

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry
- Backend: Python FastAPI (main_docker.py), porta 3001 (dev) / 7860 (Docker)
- Chain: Arc Mainnet (Chain ID: 5042)
- Token: USDC 6 decimals (0x3600000000000000000000000000000000000000)

---

## Payment Flow (ERC-8183)

1. Usuário aprova + faz fund de 1 USDC no contrato escrow
2. Backend chama `submit()` + `complete()` como treasury
3. Treasury recebe 1 USDC (0.99 provider + 0.01 fee)
4. Frontend desbloqueia a busca

---

## To Run

```bash
bun install
bun run dev
# backend em outro terminal:
python3 main_docker.py
```
