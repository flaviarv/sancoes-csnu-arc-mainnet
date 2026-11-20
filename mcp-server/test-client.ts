/**
 * Teste: sobe o servidor MCP como processo filho e fala com ele como um cliente MCP real
 * (o mesmo protocolo de Claude Desktop, Cursor etc.). Lê a chave de ../agent-gateway/.env.buyer.
 */
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const key = /^BUYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m.exec(
  readFileSync(new URL('../agent-gateway/.env.buyer', import.meta.url).pathname, 'utf8'),
)![1]

async function session(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['run', new URL('./index.ts', import.meta.url).pathname],
    env: { ...(process.env as Record<string, string>), CRIPTOKYC_BUYER_PRIVATE_KEY: key, ...env },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'test-client', version: '0.0.1' })
  await client.connect(transport)
  return client
}
type Text = { content: Array<{ type: string; text: string }>; isError?: boolean }
const text = (r: unknown) => (r as Text).content.map((c) => c.text).join('\n')
let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' -> ' + detail : ''}`)
  if (!ok) failures++
}

// --- Sessão A: tetos normais ---
const a = await session({ CRIPTOKYC_MAX_PRICE_PER_CALL: '0.05', CRIPTOKYC_MAX_SPEND_PER_SESSION: '0.04' })
const tools = (await a.listTools()).tools
check('A1 lista as 4 ferramentas', tools.length === 4, tools.map((t) => t.name).join(', '))
check('A2 nenhuma ferramenta de depósito/saque exposta', !tools.some((t) => /deposit|withdraw|transfer|key/i.test(t.name)))

const pricing = await a.callTool({ name: 'get_pricing', arguments: {} })
check('A3 get_pricing é grátis e retorna preços', /0\.01/.test(text(pricing)))

const bal = await a.callTool({ name: 'get_budget', arguments: {} })
check('A4 get_budget mostra saldo e tetos', /Gateway/i.test(text(bal)) && /0\.05/.test(text(bal)), text(bal).split('\n')[0])
check('A5 nenhuma saída contém a chave privada', !text(bal).includes(key.slice(2, 22)) && !text(pricing).includes(key.slice(2, 22)))

const csnu = await a.callTool({ name: 'check_csnu_names', arguments: { names: ['Noor Wali Mehsud', 'Flavia Ramos Vieira'] } })
const csnuText = text(csnu)
check('A6 check_csnu_names paga e retorna veredito', !(csnu as Text).isError && /Noor Wali Mehsud/.test(csnuText) && /SANCIONADO|sanctioned/i.test(csnuText), csnuText.split('\n').slice(0, 3).join(' | '))

const w1 = await a.callTool({ name: 'check_wallet_sanctions', arguments: { wallets: ['TWBAPzpPiZarfVsY2BLXeaLhNHurn4wkWG'] } })
check('A7 check_wallet_sanctions paga e acusa OFAC', !(w1 as Text).isError && /OFAC/.test(text(w1)), text(w1).split('\n').slice(0, 2).join(' | '))

// teto da sessão (0.04): já gastou 0.01 + 0.02 = 0.03; mais uma de 0.02 chegaria a 0.05 e estoura -> deve recusar sem pagar
const w2 = await a.callTool({ name: 'check_wallet_sanctions', arguments: { wallets: ['0x27d5b2b1769d2cb013e02dce0c1a6c4feb3b6b92'] } })
check('A8 teto da sessão bloqueia a 3a chamada', (w2 as Text).isError === true && /teto|limit|cap/i.test(text(w2)), text(w2).slice(0, 120))
await a.close()

// --- Sessão B: teto por chamada abaixo do preço ---
const b = await session({ CRIPTOKYC_MAX_PRICE_PER_CALL: '0.005' })
const b1 = await b.callTool({ name: 'check_csnu_names', arguments: { names: ['x'] } })
check('B1 teto por chamada menor que o preço bloqueia', (b1 as Text).isError === true && /teto|limit|cap|price/i.test(text(b1)), text(b1).slice(0, 120))
await b.close()

// --- Sessão C: entrada inválida não gasta nada ---
const c = await session({})
const c1 = await c.callTool({ name: 'check_csnu_names', arguments: { names: [] } }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e) }] }))
check('C1 lista vazia é rejeitada', (c1 as Text).isError === true)
await c.close()

console.log(failures === 0 ? '\nRESULTADO: TUDO OK' : `\nRESULTADO: ${failures} FALHA(S)`)
process.exit(failures === 0 ? 0 : 1)
