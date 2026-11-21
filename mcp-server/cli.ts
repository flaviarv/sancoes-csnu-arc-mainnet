#!/usr/bin/env node
/**
 * cli.ts — ponto de entrada do pacote `criptokyc-mcp`.
 *
 *   npx -y criptokyc-mcp            (sem argumentos) roda o servidor MCP; é o que os clientes de IA executam
 *   npx -y criptokyc-mcp install    cria a carteira do agente e registra o servidor no Claude / Cursor
 *   npx -y criptokyc-mcp deposit 1  move USDC de teste da carteira para o saldo Gateway (comando de HUMANO)
 *   npx -y criptokyc-mcp status     mostra carteira, saldos e se o serviço está no ar
 *
 * Os comandos humanos escrevem em stdout. O servidor escreve só em stderr (stdout é o protocolo MCP).
 */
import { createInterface } from 'node:readline/promises'
import { ALL_CLIENTS, detectClients, installInto, mcpEntry, type ClientId } from './clients.ts'
import { CHAIN, FAUCET_URL, PACKAGE_NAME, SERVER_NAME, apiUrl } from './config.ts'
import { ensureWallet, walletFile } from './wallet.ts'

const [, , cmd, ...rest] = process.argv
const flag = (name: string) => rest.includes(`--${name}`)
const option = (name: string) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : undefined
}
const out = (...a: unknown[]) => console.log(...a)

async function gatewayClient() {
  const { GatewayClient } = await import('@circle-fin/x402-batching/client')
  const w = ensureWallet()
  return { w, client: new GatewayClient({ chain: CHAIN, privateKey: w.key }) }
}

function nextSteps(address: string) {
  out('\nNext steps:')
  out(`  1. Send test USDC (Arc Testnet) to your agent wallet: ${address}`)
  out(`     Faucet: ${FAUCET_URL}  (choose Arc Testnet)`)
  out(`  2. Move some into the payment balance (one time, asks for confirmation): npx -y ${PACKAGE_NAME} deposit 1`)
  out('  3. Restart your AI app, then ask it to check a name or wallet against sanctions lists.')
}

async function install() {
  const w = ensureWallet()
  out(w.created ? `Agent wallet created: ${w.address}` : `Agent wallet: ${w.address}`)
  out(`  (private key stored only on this computer: ${w.source === 'env' ? 'environment variable' : walletFile()})`)

  const requested = option('client')
  let targets: ClientId[]
  if (requested && requested !== 'all') {
    if (!ALL_CLIENTS.includes(requested as ClientId)) {
      out(`Unknown client "${requested}". Use: ${ALL_CLIENTS.join(', ')}, all`)
      process.exit(1)
    }
    targets = [requested as ClientId]
  } else {
    targets = requested === 'all' ? ALL_CLIENTS : detectClients()
  }

  if (targets.length === 0) {
    out('\nNo supported AI app detected automatically. Add this to the MCP settings of your app:')
    out(JSON.stringify({ mcpServers: { [SERVER_NAME]: mcpEntry() } }, null, 2))
  } else {
    out('')
    for (const id of targets) {
      const r = installInto(id)
      out(`  [${r.status}] ${id}: ${r.detail}`)
    }
  }
  nextSteps(w.address)
}

async function deposit() {
  const amount = rest.find((a) => /^\d+(\.\d+)?$/.test(a)) ?? '1'
  const { w, client } = await gatewayClient()
  const before = await client.getBalances()
  out(`Wallet ${w.address}`)
  out(`  wallet balance: ${before.wallet.formatted} USDC | payment (Gateway) balance: ${before.gateway.formattedAvailable} USDC`)
  if (Number(before.wallet.formatted) < Number(amount)) {
    out(`\nNot enough USDC in the wallet to deposit ${amount}. Send test USDC to ${w.address} first (${FAUCET_URL}, Arc Testnet).`)
    process.exit(1)
  }
  if (!flag('yes')) {
    if (!process.stdin.isTTY) {
      out('Run in an interactive terminal, or add --yes to confirm without asking.')
      process.exit(1)
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(`Deposit ${amount} USDC (testnet) into the payment balance? [y/N] `)
    rl.close()
    if (!/^y(es)?$/i.test(answer.trim())) {
      out('Cancelled.')
      return
    }
  }
  out('Depositing (one on-chain transaction, pays gas once)...')
  await client.deposit(amount)
  const after = await client.getBalances()
  out(`Done. Payment (Gateway) balance: ${after.gateway.formattedAvailable} USDC. Your AI can now pay per screening, gas-free.`)
}

async function status() {
  const { w, client } = await gatewayClient()
  out(`Agent wallet: ${w.address}  (${w.source === 'env' ? 'from environment' : walletFile()})`)
  try {
    const b = await client.getBalances()
    out(`Wallet balance: ${b.wallet.formatted} USDC | Payment (Gateway) balance: ${b.gateway.formattedAvailable} USDC`)
    if (b.gateway.available === 0n) nextSteps(w.address)
  } catch (e) {
    out(`Could not read balances: ${e instanceof Error ? e.message : String(e)}`)
  }
  try {
    const res = await fetch(`${apiUrl()}/health`, { signal: AbortSignal.timeout(8000) })
    out(`Service ${apiUrl()}: ${res.ok ? 'online' : `HTTP ${res.status}`}`)
  } catch {
    out(`Service ${apiUrl()}: NOT reachable (offline, or CRIPTOKYC_API_URL is wrong)`)
  }
}

function help() {
  out(`${PACKAGE_NAME}: pay-per-use sanctions screening for AI apps (testnet)

  npx -y ${PACKAGE_NAME} install [--client claude-desktop|cursor|claude-code|all]
  npx -y ${PACKAGE_NAME} deposit [amount] [--yes]
  npx -y ${PACKAGE_NAME} status
  npx -y ${PACKAGE_NAME}            run the MCP server (your AI app does this for you)`)
}

switch (cmd) {
  case undefined:
  case 'serve':
    await import('./server.ts')
    break
  case 'install':
    await install()
    break
  case 'deposit':
    await deposit()
    break
  case 'status':
    await status()
    break
  default:
    help()
    process.exit(cmd === 'help' || cmd === '--help' || cmd === '-h' ? 0 : 1)
}
