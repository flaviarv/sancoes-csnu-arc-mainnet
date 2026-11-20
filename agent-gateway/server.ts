/**
 * agent-gateway/server.ts
 *
 * Proxy x402 (Circle Gateway Nanopayments) na frente da API de sanções, para
 * agentes de IA pagarem por chamada em USDC, sem gás e sem sessão.
 *
 * Fluxo: agente -> 402 (preço) -> assina offchain -> este proxy verifica e
 * liquida -> encaminha para a API interna (127.0.0.1) -> resposta.
 *
 * Este servidor NÃO guarda chave privada: só o endereço que recebe (SELLER_ADDRESS).
 * Esta versão é só TESTNET.
 */

import express, { type NextFunction, type Request, type Response } from 'express'
import { createGatewayMiddleware } from '@circle-fin/x402-batching/server'
import { formatUnits } from 'viem'
import { MAX_ITEM_LENGTH, MAX_ITEMS_PER_CALL, PRICES } from './pricing.ts'

// ── Configuração (variáveis de ambiente) ─────────────────────────────────────
const MODE = process.env.X402_NETWORK ?? 'testnet'
if (MODE !== 'testnet') {
  console.error('Esta versão do agent-gateway só roda em testnet (X402_NETWORK=testnet).')
  process.exit(1)
}

const SELLER_ADDRESS = process.env.SELLER_ADDRESS ?? ''
if (!/^0x[a-fA-F0-9]{40}$/.test(SELLER_ADDRESS)) {
  console.error('Defina SELLER_ADDRESS com o endereço EVM que recebe os pagamentos (0x + 40 hex).')
  process.exit(1)
}

const PORT = Number(process.env.PORT ?? 3100)
const INTERNAL_API = process.env.INTERNAL_API_URL ?? 'http://127.0.0.1:3101'
const TESTNET_FACILITATOR = 'https://gateway-api-testnet.circle.com'

const gateway = createGatewayMiddleware({
  sellerAddress: SELLER_ADDRESS,
  facilitatorUrl: TESTNET_FACILITATOR,
})

type PaidRequest = Request & {
  payment?: { verified: boolean; payer: string; amount: string; network: string; transaction?: string }
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '50kb' }))

// ── Limite simples de requisições por IP (protege o proxy e o facilitator) ───
const hits = new Map<string, number[]>()
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? 'unknown'
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  if (recent.length >= 120) {
    res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Try again in a minute.' })
    return
  }
  recent.push(now)
  hits.set(ip, recent)
  next()
}

// ── Validação ANTES de cobrar: o agente não paga por um pedido inválido ──────
function validList(field: 'names' | 'wallets') {
  return (req: Request, res: Response, next: NextFunction) => {
    const list: unknown = (req.body as Record<string, unknown> | undefined)?.[field]
    const ok =
      Array.isArray(list) &&
      list.length >= 1 &&
      list.length <= MAX_ITEMS_PER_CALL &&
      list.every((x) => typeof x === 'string' && x.trim().length > 0 && x.length <= MAX_ITEM_LENGTH)
    if (!ok) {
      res.status(400).json({
        error: 'invalid_request',
        message: `Body must be {"${field}": string[]} with 1 to ${MAX_ITEMS_PER_CALL} non-empty items (max ${MAX_ITEM_LENGTH} chars each).`,
      })
      return
    }
    next()
  }
}

// ── Checa a API interna ANTES de cobrar: não cobra se não consegue entregar ──
let upstreamOkUntil = 0
async function ensureUpstream(_req: Request, res: Response, next: NextFunction) {
  if (Date.now() < upstreamOkUntil) return next()
  try {
    const r = await fetch(`${INTERNAL_API}/internal/health`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) throw new Error(`status ${r.status}`)
    upstreamOkUntil = Date.now() + 5000
    next()
  } catch {
    res.status(503).json({ error: 'service_unavailable', message: 'Data service unavailable. You were not charged.' })
  }
}

async function forward(path: string, body: unknown, req: PaidRequest, res: Response) {
  // Registra só dados do pagamento. NUNCA registra nomes ou carteiras consultadas.
  const p = req.payment
  if (p) console.log(`paid ${formatUnits(BigInt(p.amount), 6)} USDC by ${p.payer} on ${p.network} -> ${path}`)
  try {
    const r = await fetch(`${INTERNAL_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const data: unknown = await r.json().catch(() => ({}))
    res.status(r.status).json(data)
  } catch {
    res.status(502).json({ error: 'upstream_error', message: 'Data service failed after payment. Contact support with your payment reference.' })
  }
}

// ── Rotas gratuitas ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: MODE })
})

app.get('/v1/pricing', (_req, res) => {
  res.json({
    protocol: 'x402 (Circle Gateway Nanopayments)',
    network_mode: MODE,
    max_items_per_call: MAX_ITEMS_PER_CALL,
    endpoints: [
      { method: 'POST', path: '/v1/csnu/check', price: PRICES.csnu, body: { names: ['string'] } },
      { method: 'POST', path: '/v1/wallets/check', price: PRICES.wallets, body: { wallets: ['string'] } },
    ],
  })
})

// OpenAPI público: permite que qualquer agente ou IA (com ou sem MCP) descubra e chame a API.
// Chamadas sem pagamento recebem 402 com as condições (x402); quem não paga x402 não obtém dados.
app.get('/openapi.json', (_req, res) => {
  const listBody = (field: string, example: string[]) => ({
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: [field],
          properties: { [field]: { type: 'array', minItems: 1, maxItems: MAX_ITEMS_PER_CALL, items: { type: 'string', maxLength: MAX_ITEM_LENGTH } } },
        },
        example: { [field]: example },
      },
    },
  })
  const responses = {
    '200': { description: 'Screening result (payment settled).' },
    '400': { description: 'Invalid body. No payment is charged.' },
    '402': { description: 'Payment required (x402). Pay with a Circle Gateway Nanopayments authorization and retry with the Payment-Signature header; conditions are in the PAYMENT-REQUIRED header.' },
    '503': { description: 'Upstream unavailable. No payment is charged.' },
  }
  res.json({
    openapi: '3.1.0',
    info: {
      title: 'criptokyc.tech sanctions screening (x402)',
      version: '0.1.0',
      description: `Pay-per-call sanctions screening for AI agents. Network mode: ${MODE}. Payment: x402 via Circle Gateway Nanopayments (USDC, gas-free for the buyer).`,
    },
    paths: {
      '/v1/csnu/check': {
        post: {
          operationId: 'checkCsnuNames',
          summary: `Check names against the UN Security Council (CSNU) list. Price ${PRICES.csnu} per call.`,
          requestBody: listBody('names', ['Noor Wali Mehsud']),
          responses,
        },
      },
      '/v1/wallets/check': {
        post: {
          operationId: 'checkWalletSanctions',
          summary: `Check crypto wallet addresses against OFAC, Israel NBCTF, UK OFSI, EU, UN and SECO. Price ${PRICES.wallets} per call.`,
          requestBody: listBody('wallets', ['TWBAPzpPiZarfVsY2BLXeaLhNHurn4wkWG']),
          responses,
        },
      },
      '/v1/pricing': { get: { operationId: 'getPricing', summary: 'Current prices (free).', responses: { '200': { description: 'Prices.' } } } },
    },
  })
})

// ── Rotas pagas ──────────────────────────────────────────────────────────────
app.post('/v1/csnu/check', rateLimit, validList('names'), ensureUpstream, gateway.require(PRICES.csnu),
  (req: PaidRequest, res) => { void forward('/internal/check-names', { names: req.body.names }, req, res) })

app.post('/v1/wallets/check', rateLimit, validList('wallets'), ensureUpstream, gateway.require(PRICES.wallets),
  (req: PaidRequest, res) => { void forward('/internal/check-wallets', { wallets: req.body.wallets }, req, res) })

// JSON malformado -> 400 (antes de qualquer cobrança)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: number }).status ?? 500
  res.status(status >= 400 && status < 500 ? status : 500).json({ error: 'bad_request', message: 'Invalid request.' })
})

app.listen(PORT, () => {
  console.log(`agent-gateway (${MODE}) listening on :${PORT}, seller ${SELLER_ADDRESS}, upstream ${INTERNAL_API}`)
})
