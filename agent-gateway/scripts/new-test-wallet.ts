/**
 * Gera uma carteira DESCARTÁVEL de comprador para testes em testnet.
 * A chave privada é gravada em agent-gateway/.env.buyer (ignorado pelo git, modo 600)
 * e NUNCA é impressa. Só o endereço aparece no terminal.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const FILE = new URL('../.env.buyer', import.meta.url).pathname

if (existsSync(FILE)) {
  console.error('.env.buyer já existe. Apague-o manualmente se quiser gerar outra carteira.')
  process.exit(1)
}

const key = generatePrivateKey()
writeFileSync(FILE, `BUYER_PRIVATE_KEY=${key}\n`, { mode: 0o600 })
console.log('Carteira de teste criada.')
console.log('Endereço do comprador:', privateKeyToAccount(key).address)
