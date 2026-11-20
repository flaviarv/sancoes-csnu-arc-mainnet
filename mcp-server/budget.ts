/**
 * budget.ts — tetos de gasto do agente. Este arquivo decide quanto a IA pode pagar.
 *
 * ── PROTECTED ───────────────────────────────────────────────────
 * NÃO modifique sem aprovação explícita da proprietária.
 * ─────────────────────────────────────────────────────────────────
 */

const ATOMIC = 1_000_000 // USDC tem 6 casas decimais

function usdcToAtomic(v: string, name: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(v)) throw new Error(`${name} inválido: use um número de USDC, ex.: 0.05`)
  const [whole, frac = ''] = v.split('.')
  return BigInt(whole) * BigInt(ATOMIC) + BigInt((frac + '000000').slice(0, 6))
}

export const fmt = (atomic: bigint): string => {
  const whole = atomic / BigInt(ATOMIC)
  const frac = (atomic % BigInt(ATOMIC)).toString().padStart(6, '0')
  return `${whole}.${frac}`
}

export class Budget {
  readonly maxPerCall: bigint
  readonly maxPerSession: bigint
  private spent = 0n
  private calls = 0

  constructor(env: NodeJS.ProcessEnv) {
    // Padrões conservadores: a IA só gasta centavos até você aumentar de propósito.
    this.maxPerCall = usdcToAtomic(env.CRIPTOKYC_MAX_PRICE_PER_CALL ?? '0.05', 'CRIPTOKYC_MAX_PRICE_PER_CALL')
    this.maxPerSession = usdcToAtomic(env.CRIPTOKYC_MAX_SPEND_PER_SESSION ?? '0.50', 'CRIPTOKYC_MAX_SPEND_PER_SESSION')
  }

  /** Retorna o motivo da recusa, ou null se o pagamento é permitido. */
  refusalReason(price: bigint): string | null {
    if (price > this.maxPerCall) {
      return `teto por chamada excedido: a consulta custa ${fmt(price)} USDC e o teto é ${fmt(this.maxPerCall)} USDC`
    }
    if (this.spent + price > this.maxPerSession) {
      return `teto da sessão excedido: já gastou ${fmt(this.spent)} USDC de ${fmt(this.maxPerSession)} USDC`
    }
    return null
  }

  record(amount: bigint): void {
    this.spent += amount
    this.calls += 1
  }

  summary() {
    return { spent: fmt(this.spent), calls: this.calls, remaining: fmt(this.maxPerSession - this.spent), maxPerCall: fmt(this.maxPerCall), maxPerSession: fmt(this.maxPerSession) }
  }
}
