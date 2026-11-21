/**
 * config.ts — constantes do pacote (sem segredos).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Endereço público do gateway x402. Sobrescreva com CRIPTOKYC_API_URL (ex.: http://127.0.0.1:3100 em dev).
export const DEFAULT_API_URL = 'https://agents.criptokyc.tech'

// Esta versão só roda em testnet.
export const CHAIN = 'arcTestnet' as const

// Faucet público de USDC de teste.
export const FAUCET_URL = 'https://faucet.circle.com'

export const PACKAGE_NAME = 'criptokyc-mcp'
export const SERVER_NAME = 'criptokyc'

export const apiUrl = (): string => (process.env.CRIPTOKYC_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '')

// Endereço que RECEBE os pagamentos (a treasury do criptokyc.tech). O servidor MCP recusa pagar
// qualquer outro destino: se o domínio do gateway fosse sequestrado, o agente não enviaria dinheiro
// a um terceiro. Sobrescreva com CRIPTOKYC_PAY_TO só em desenvolvimento.
export const EXPECTED_PAY_TO = '0xd2f80f6cf27483392f70f21b3381109f9c33c390'
export const expectedPayTo = (): string => (process.env.CRIPTOKYC_PAY_TO ?? EXPECTED_PAY_TO).toLowerCase()

/** Versão deste pacote (lida do package.json ao lado do código). */
export function packageVersion(): string {
  for (const rel of ['./package.json', '../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as { name?: string; version?: string }
      if (pkg.name === PACKAGE_NAME && pkg.version) return pkg.version
    } catch {
      // tenta o próximo caminho
    }
  }
  return 'latest'
}
