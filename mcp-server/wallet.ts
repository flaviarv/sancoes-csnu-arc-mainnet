/**
 * wallet.ts — carteira do agente, guardada localmente (nunca no arquivo de configuração do cliente de IA).
 *
 * Ordem de busca da chave: variável CRIPTOKYC_BUYER_PRIVATE_KEY, depois ~/.criptokyc/wallet.json.
 * Se não existir nenhuma, o servidor cria uma carteira NOVA e vazia (testnet) na primeira execução.
 * O arquivo é gravado com permissão 600 (pasta 700). No Windows essas permissões não se aplicam;
 * a proteção é a pasta do próprio usuário.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const KEY_RE = /^0x[0-9a-fA-F]{64}$/

export const walletDir = (): string => process.env.CRIPTOKYC_HOME ?? join(homedir(), '.criptokyc')
export const walletFile = (): string => join(walletDir(), 'wallet.json')

export interface LoadedWallet {
  key: `0x${string}`
  address: string
  source: 'env' | 'file'
  created: boolean
}

function parseKey(raw: unknown, where: string): `0x${string}` {
  if (typeof raw !== 'string' || !KEY_RE.test(raw)) throw new Error(`Invalid private key in ${where} (expected 0x + 64 hex characters).`)
  return raw as `0x${string}`
}

/** Carrega a carteira existente, ou cria uma nova se não houver nenhuma. */
export function ensureWallet(): LoadedWallet {
  const fromEnv = process.env.CRIPTOKYC_BUYER_PRIVATE_KEY
  if (fromEnv) {
    const key = parseKey(fromEnv, 'CRIPTOKYC_BUYER_PRIVATE_KEY')
    return { key, address: privateKeyToAccount(key).address, source: 'env', created: false }
  }

  const file = walletFile()
  if (existsSync(file)) {
    try {
      chmodSync(file, 0o600)
      chmodSync(walletDir(), 0o700)
    } catch {
      // Windows ou sem permissão: segue (a proteção é a pasta do usuário)
    }
    const key = parseKey((JSON.parse(readFileSync(file, 'utf8')) as { privateKey?: unknown }).privateKey, file)
    return { key, address: privateKeyToAccount(key).address, source: 'file', created: false }
  }

  mkdirSync(walletDir(), { recursive: true, mode: 0o700 })
  const key = generatePrivateKey()
  const address = privateKeyToAccount(key).address
  // flag 'wx': nunca sobrescreve uma carteira existente (duas execuções simultâneas não se atropelam)
  writeFileSync(file, JSON.stringify({ privateKey: key, address, network: 'arcTestnet', createdAt: new Date().toISOString() }, null, 2), {
    mode: 0o600,
    flag: 'wx',
  })
  return { key, address, source: 'file', created: true }
}
