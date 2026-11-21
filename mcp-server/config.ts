/**
 * config.ts — constantes do pacote (sem segredos).
 */

// Endereço público do gateway x402. Sobrescreva com CRIPTOKYC_API_URL (ex.: http://127.0.0.1:3100 em dev).
export const DEFAULT_API_URL = 'https://agents.criptokyc.tech'

// Esta versão só roda em testnet.
export const CHAIN = 'arcTestnet' as const

// Faucet público de USDC de teste.
export const FAUCET_URL = 'https://faucet.circle.com'

export const PACKAGE_NAME = 'criptokyc-mcp'
export const SERVER_NAME = 'criptokyc'

export const apiUrl = (): string => (process.env.CRIPTOKYC_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '')
