/**
 * Depósito no saldo Gateway: comando para HUMANOS. A IA não tem ferramenta para isto.
 *
 *   CRIPTOKYC_BUYER_PRIVATE_KEY=0x... bun run deposit -- 5
 *
 * Move USDC da carteira para o Gateway (uma transação com gás). Depois disso, o agente paga
 * as consultas sem gás, só até os tetos configurados.
 */
import { GatewayClient } from '@circle-fin/x402-batching/client'

const key = process.env.CRIPTOKYC_BUYER_PRIVATE_KEY
const amount = process.argv.slice(2).find((a) => /^\d+(\.\d+)?$/.test(a))
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || !amount) {
  console.error('Uso: CRIPTOKYC_BUYER_PRIVATE_KEY=0x... bun run deposit -- <valor em USDC>')
  process.exit(1)
}
const client = new GatewayClient({ chain: 'arcTestnet', privateKey: key as `0x${string}` })
console.log('Carteira:', client.account.address)
const before = await client.getBalances()
console.log(`Antes: carteira ${before.wallet.formatted} USDC | Gateway ${before.gateway.formattedAvailable} USDC`)
await client.deposit(amount)
const after = await client.getBalances()
console.log(`Depois: carteira ${after.wallet.formatted} USDC | Gateway ${after.gateway.formattedAvailable} USDC`)
