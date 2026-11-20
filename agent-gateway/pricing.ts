// ── PROTECTED ─────────────────────────────────────────────────
// Preços e limites do agent-gateway (x402).
// NÃO modifique sem aprovação explícita da proprietária.
// Alterações aqui afetam quanto os agentes pagam por chamada.
// ──────────────────────────────────────────────────────────────

// ATENÇÃO: valores de TESTE (testnet). O preço definitivo por consulta ainda
// precisa ser decidido pela proprietária antes de qualquer uso real.
export const PRICES = {
  csnu: '$0.01',     // por chamada, até MAX_ITEMS_PER_CALL nomes
  wallets: '$0.02',  // por chamada, até MAX_ITEMS_PER_CALL carteiras
} as const

// Limite de itens por chamada paga. Precisa ser igual ao MAX_ITEMS de internal_api.py.
export const MAX_ITEMS_PER_CALL = 50

// Tamanho máximo de cada item (nome ou endereço), em caracteres.
export const MAX_ITEM_LENGTH = 200
