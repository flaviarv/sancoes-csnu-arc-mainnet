# criptokyc-mcp

Sanctions screening inside your AI app. Ask Claude, Cursor or any MCP client whether a **person/entity name**
(UN Security Council list) or a **crypto wallet address** (OFAC, EU, UK, UN, Switzerland SECO, Israel NBCTF) is
sanctioned. You pay a few cents per screening in USDC, automatically, with no gas and no account.

> **Testnet only.** Payments use test USDC on Arc Testnet and have no real value.

## Install (3 commands)

```bash
npx -y criptokyc-mcp install
```
Creates your agent wallet and registers the server in Claude Desktop, Cursor and Claude Code (whichever you have).

```bash
# send test USDC (Arc Testnet) to the wallet address printed above: https://faucet.circle.com
npx -y criptokyc-mcp deposit 1
```
Moves 1 test USDC into your payment balance (asks for confirmation; this is the only step that pays gas).

Then **restart your AI app** and ask: *"Is Noor Wali Mehsud on the UN sanctions list?"*

Check everything any time with `npx -y criptokyc-mcp status`.

## Tools your AI gets

| Tool | Cost | What it does |
|---|---|---|
| `check_csnu_names` | per call (see `get_pricing`) | Names against the UN Security Council list, up to 50 per call |
| `check_wallet_sanctions` | per call | Wallet addresses against 6 official lists, up to 50 per call |
| `get_pricing` | free | Current prices |
| `get_budget` | free | Your wallet, balance and spending caps |

## Safety

- **Your AI can only spend, never move funds.** There is no tool to deposit, withdraw or transfer.
- **Spending caps** (defaults): 0.05 USDC per call and 0.50 USDC per session. Change with the env vars
  `CRIPTOKYC_MAX_PRICE_PER_CALL` and `CRIPTOKYC_MAX_SPEND_PER_SESSION`.
- The wallet's private key stays on your computer in `~/.criptokyc/wallet.json` (owner-only permissions on
  macOS/Linux). It is never written to your AI app's config and never shown to the AI.
- It is a dedicated wallet: keep only the small amount you want the AI to be able to spend.
- Results are informational, based on official lists. They do not replace a compliance review.

## Other clients

`install` auto-configures Claude Desktop, Cursor and Claude Code. For any other MCP client (Windsurf, Cline,
VS Code...), add this to its MCP settings, then run `npx -y criptokyc-mcp install` once to create the wallet:

```json
{ "mcpServers": { "criptokyc": { "command": "npx", "args": ["-y", "criptokyc-mcp"] } } }
```

On Windows some apps need `"command": "cmd", "args": ["/c", "npx", "-y", "criptokyc-mcp"]` (the installer does this for you).

## Troubleshooting

| Symptom | Fix |
|---|---|
| AI says "Insufficient Gateway balance" | Send test USDC to your wallet, then run `npx -y criptokyc-mcp deposit 1` |
| "Could not reach the screening service" | Run `npx -y criptokyc-mcp status`; the service may be offline |
| Tools do not appear | Fully quit and reopen the AI app after `install` |
| Spending cap reached | Restart the AI app (new session) or raise the caps with the env vars above |

## Configuration (optional env vars)

`CRIPTOKYC_API_URL` (service URL), `CRIPTOKYC_MAX_PRICE_PER_CALL`, `CRIPTOKYC_MAX_SPEND_PER_SESSION`,
`CRIPTOKYC_HOME` (wallet folder), `CRIPTOKYC_BUYER_PRIVATE_KEY` (use your own key instead of the generated wallet).
