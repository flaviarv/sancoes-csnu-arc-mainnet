/**
 * Comprador de teste (testnet): simula um agente pagando o agent-gateway.
 *
 *   bun run buyer:test                  -> mostra saldos e tenta pagar as duas consultas
 *   bun run buyer:test -- --deposit 1   -> antes, deposita 1 USDC no Gateway (uma vez)
 *
 * Lê BUYER_PRIVATE_KEY de agent-gateway/.env.buyer. Nunca imprime a chave.
 */
import { existsSync, readFileSync } from 'node:fs'
import { GatewayClient } from '@circle-fin/x402-batching/client'

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://127.0.0.1:3100'
const ENV_FILE = new URL('../.env.buyer', import.meta.url).pathname

if (!existsSync(ENV_FILE)) {
  console.error('Rode antes: bun run wallet:new')
  process.exit(1)
}
const match = /^BUYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m.exec(readFileSync(ENV_FILE, 'utf8'))
if (!match) {
  console.error('BUYER_PRIVATE_KEY ausente ou inválida em .env.buyer')
  process.exit(1)
}

const client = new GatewayClient({ chain: 'arcTestnet', privateKey: match[1] as `0x${string}` })
console.log('Comprador:', client.account.address)

async function showBalances(label: string) {
  const b = await client.getBalances()
  console.log(`[${label}] carteira: ${b.wallet.formatted} USDC | Gateway disponível: ${b.gateway.formattedAvailable} USDC`)
  return b
}

const depositIdx = process.argv.indexOf('--deposit')
if (depositIdx !== -1) {
  const amount = process.argv[depositIdx + 1]
  if (!amount || !/^\d+(\.\d+)?$/.test(amount)) {
    console.error('Uso: --deposit <valor em USDC>, ex.: --deposit 1')
    process.exit(1)
  }
  console.log(`Depositando ${amount} USDC no Gateway (uma vez, com gás)...`)
  const d = await client.deposit(amount)
  console.log('Depósito enviado:', JSON.stringify(d, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).slice(0, 300))
}

const before = await showBalances('antes')

console.log('\n1) CSNU: "Noor Wali Mehsud" e "Flavia Ramos Vieira"')
const csnu = await client.pay<{ results: unknown[]; sanctioned_count: number }>(`${GATEWAY_URL}/v1/csnu/check`, {
  method: 'POST',
  body: { names: ['Noor Wali Mehsud', 'Flavia Ramos Vieira'] },
})
console.log(`   status ${csnu.status} | pago ${csnu.formattedAmount} USDC | sancionados: ${csnu.data.sanctioned_count}`)
console.log('   ', JSON.stringify(csnu.data.results))

console.log('\n2) Carteiras: TWBAPzpPiZarfVsY2BLXeaLhNHurn4wkWG (OFAC) e 0x27d5b2b1769d2cb013e02dce0c1a6c4feb3b6b92')
const wallets = await client.pay<{ results: Array<{ address: string; is_sanctioned: boolean; sources: string[] }>; sanctioned_count: number }>(
  `${GATEWAY_URL}/v1/wallets/check`,
  { method: 'POST', body: { wallets: ['TWBAPzpPiZarfVsY2BLXeaLhNHurn4wkWG', '0x27d5b2b1769d2cb013e02dce0c1a6c4feb3b6b92'] } },
)
console.log(`   status ${wallets.status} | pago ${wallets.formattedAmount} USDC | sancionadas: ${wallets.data.sanctioned_count}`)
for (const r of wallets.data.results) console.log(`    ${r.address.slice(0, 12)}… sancionada=${r.is_sanctioned} fontes=${r.sources.join(',') || '-'}`)

const after = await showBalances('depois')
console.log(`\nGasto total no Gateway: ${(Number(before.gateway.available - after.gateway.available) / 1e6).toFixed(6)} USDC`)
