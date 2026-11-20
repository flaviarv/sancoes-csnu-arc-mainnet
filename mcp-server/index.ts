#!/usr/bin/env bun
/**
 * criptokyc-mcp — servidor MCP (stdio) de triagem de sanções, pago por consulta em USDC via x402.
 *
 * Funciona com qualquer cliente MCP (Claude Desktop, Claude Code, Cursor, Windsurf, Cline, VS Code...).
 * A carteira do agente paga cada chamada, sem gás, do saldo Gateway, só até os tetos de budget.ts.
 *
 * Segurança: a IA NÃO tem ferramenta de depósito, saque ou transferência. A chave privada vem só
 * de variável de ambiente, nunca aparece em respostas e os logs vão para stderr (stdout é o protocolo).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { GatewayClient } from '@circle-fin/x402-batching/client'
import { z } from 'zod'
import { Budget, fmt } from './budget.ts'

const log = (...a: unknown[]) => console.error('[criptokyc-mcp]', ...a)
const die = (msg: string): never => {
  log(msg)
  process.exit(1)
}

const API_URL = (process.env.CRIPTOKYC_API_URL ?? 'http://127.0.0.1:3100').replace(/\/+$/, '')
if ((process.env.CRIPTOKYC_CHAIN ?? 'arcTestnet') !== 'arcTestnet') {
  die('Esta versão só roda em testnet (arcTestnet). Mainnet não está habilitada.')
}
const KEY = process.env.CRIPTOKYC_BUYER_PRIVATE_KEY ?? ''
if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) die('Defina CRIPTOKYC_BUYER_PRIVATE_KEY (0x + 64 hex) no env do cliente MCP.')

let budget: Budget
try {
  budget = new Budget(process.env)
} catch (e) {
  die(e instanceof Error ? e.message : String(e))
  throw e
}

const client = new GatewayClient({ chain: 'arcTestnet', privateKey: KEY as `0x${string}` })
client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
  const reason = budget.refusalReason(BigInt(selectedRequirements.amount))
  if (reason) return { abort: true as const, reason }
})

// Pagamentos em fila: duas chamadas simultâneas não podem furar o teto da sessão.
let queue: Promise<unknown> = Promise.resolve()
const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

const scrub = (s: string) => s.replaceAll(KEY, '[redacted]').replace(/0x[0-9a-fA-F]{64}/g, '[redacted]')
const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const fail = (e: unknown) => ({
  isError: true as const,
  content: [{ type: 'text' as const, text: scrub(e instanceof Error ? e.message : String(e)) }],
})

const NOTE = 'Triagem informativa baseada em listas oficiais; não substitui análise de compliance.'
const item = z.string().min(1).max(200)

const server = new McpServer({ name: 'criptokyc', version: '0.1.0' })
const paidHints = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }

server.registerTool(
  'check_csnu_names',
  {
    title: 'Check names against the UN Security Council (CSNU) sanctions list',
    description:
      'Checks person or entity names against the UN Security Council consolidated sanctions list. ' +
      'COSTS USDC per call (see get_pricing), up to 50 names per call, paid automatically from the ' +
      'Gateway balance within the configured spending caps. One name per array item.',
    inputSchema: { names: z.array(item).min(1).max(50) },
    annotations: paidHints,
  },
  ({ names }) =>
    serialized(async () => {
      try {
        const r = await client.pay<{ results: Array<{ name: string; is_sanctioned: boolean }>; sanctioned_count: number }>(
          `${API_URL}/v1/csnu/check`,
          { method: 'POST', body: { names } },
        )
        budget.record(r.amount)
        const lines = r.data.results.map((x) => `- ${x.name}: ${x.is_sanctioned ? 'SANCTIONED (found in CSNU list)' : 'not found'}`)
        return ok(`CSNU: ${r.data.sanctioned_count} of ${r.data.results.length} sanctioned. Paid ${r.formattedAmount} USDC.\n${lines.join('\n')}\n${NOTE}`)
      } catch (e) {
        return fail(e)
      }
    }),
)

server.registerTool(
  'check_wallet_sanctions',
  {
    title: 'Check crypto wallet addresses against international sanctions lists',
    description:
      'Checks wallet addresses (EVM, Bitcoin, Tron, Solana, XRP and more) against OFAC (US), Israel NBCTF, ' +
      'UK OFSI, EU, UN and Switzerland SECO lists. COSTS USDC per call (see get_pricing), up to 50 addresses ' +
      'per call, paid automatically from the Gateway balance within the configured spending caps.',
    inputSchema: { wallets: z.array(item).min(1).max(50) },
    annotations: paidHints,
  },
  ({ wallets }) =>
    serialized(async () => {
      try {
        const r = await client.pay<{ results: Array<{ address: string; chain?: string; is_sanctioned: boolean; sources: string[] }>; sanctioned_count: number }>(
          `${API_URL}/v1/wallets/check`,
          { method: 'POST', body: { wallets } },
        )
        budget.record(r.amount)
        const lines = r.data.results.map(
          (x) => `- ${x.address} (${x.chain ?? 'unknown chain'}): ${x.is_sanctioned ? `SANCTIONED by ${x.sources.join(', ')}` : 'not found in any list'}`,
        )
        return ok(`Wallets: ${r.data.sanctioned_count} of ${r.data.results.length} sanctioned. Paid ${r.formattedAmount} USDC.\n${lines.join('\n')}\n${NOTE}`)
      } catch (e) {
        return fail(e)
      }
    }),
)

server.registerTool(
  'get_pricing',
  {
    title: 'Get the price of each screening call',
    description: 'Free. Returns the current USDC price per call and the maximum items per call.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const res = await fetch(`${API_URL}/v1/pricing`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`pricing unavailable (HTTP ${res.status})`)
      return ok(JSON.stringify(await res.json(), null, 2))
    } catch (e) {
      return fail(e)
    }
  },
)

server.registerTool(
  'get_budget',
  {
    title: 'Show payment balance and spending caps',
    description: 'Free. Shows the paying wallet address, its Gateway balance, how much was spent in this session and the spending caps.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const b = await client.getBalances()
      const s = budget.summary()
      return ok(
        [
          `Paying wallet: ${client.account.address}`,
          `Gateway balance (spendable): ${b.gateway.formattedAvailable} USDC`,
          `Wallet balance: ${b.wallet.formatted} USDC`,
          `Session: spent ${s.spent} USDC in ${s.calls} call(s); remaining under cap ${s.remaining} USDC`,
          `Caps: ${s.maxPerCall} USDC per call, ${s.maxPerSession} USDC per session`,
        ].join('\n'),
      )
    } catch (e) {
      return fail(e)
    }
  },
)

await server.connect(new StdioServerTransport())
log(`ready | api=${API_URL} | wallet=${client.account.address} | caps ${fmt(budget.maxPerCall)}/call ${fmt(budget.maxPerSession)}/session`)
