// ── PROTECTED ─────────────────────────────────────────────────
// Este arquivo define as regras de negócio do criptokyc.tech.
// NÃO modifique sem aprovação explícita da proprietária.
// Alterações aqui afetam preços, carteiras e contratos em produção.
// ──────────────────────────────────────────────────────────────

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  BUSINESS RULES — criptokyc.tech                            ║
 * ║                                                              ║
 * ║  ATENÇÃO: Este arquivo NÃO deve ser modificado por IA.      ║
 * ║  Qualquer alteração requer aprovação explícita da            ║
 * ║  proprietária do produto.                                    ║
 * ║                                                              ║
 * ║  ATTENTION: Do NOT modify this file via AI assistant.       ║
 * ║  All changes require explicit owner approval.               ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import type { Address } from 'viem'

// ─── Blockchain ───────────────────────────────────────────────
export const CHAIN_ID = 5042 // Arc Mainnet (NEVER change to testnet in production)

// ─── Contracts ────────────────────────────────────────────────
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as Address
export const AGENTIC_COMMERCE_ADDRESS = '0x975a005E4107c12e585DB71059fe857449510c99' as Address

// ─── Treasury ─────────────────────────────────────────────────
// This address receives ALL service revenue (provider 0.99 + fee 0.01 = 1 USDC)
export const TREASURY_ADDRESS = '0xd2f80f6cf27483392f70f21b3381109f9c33c390' as Address

// ─── Pricing ──────────────────────────────────────────────────
// Fixed at contract level — must match SEARCH_PRICE_USDC in AgenticCommerce.sol
export const SEARCH_PRICE_USDC = 1_000_000n // 1 USDC (6 decimals)
export const PLATFORM_FEE_BPS = 100 // 1% fee

// ─── Payment UX ───────────────────────────────────────────────
export const PAYMENT_TIMEOUT_MS = 600_000 // 10 minutes (viem default is 180_000)
export const JOB_EXPIRY_SECONDS = 3600 // 1 hour escrow window

// ─── Products ─────────────────────────────────────────────────
// Add new products here when launching new services
export const PRODUCTS = {
  CSNU_NAMES: {
    id: 'csnu',
    name: 'CSNU Names',
    price: SEARCH_PRICE_USDC,
    apiEndpoint: '/api/check-names',
    completeEndpoint: '/api/complete-job',
    description: 'UN Security Council Consolidated Sanctions List',
  },
  WALLET_SANCTIONS: {
    id: 'wallets',
    name: 'Wallet Sanctions',
    price: SEARCH_PRICE_USDC,
    apiEndpoint: '/api/check-wallets',
    completeEndpoint: '/api/complete-job',
    description: 'OFAC, Israel NBCTF, UK OFSI, EU, UN, Switzerland SECO',
  },
} as const

export type ProductId = keyof typeof PRODUCTS
