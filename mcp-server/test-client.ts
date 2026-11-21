/**
 * Teste de ponta a ponta do PACOTE instalado, em Node puro, falando MCP de verdade (stdio).
 *
 *   TEST_CLI=/caminho/node_modules/criptokyc-mcp/dist/cli.js \
 *   TEST_FUNDED_KEY=0x... (carteira de testnet com saldo Gateway) \
 *   bun run test-client.ts
 *
 * Cada cenário usa uma "casa" (HOME) temporária própria, como uma máquina de usuário diferente.
 */
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { privateKeyToAccount } from 'viem/accounts'

const CLI = process.env.TEST_CLI ?? new URL('./dist/cli.js', import.meta.url).pathname
const FUNDED_KEY = process.env.TEST_FUNDED_KEY as `0x${string}`
const API = process.env.TEST_API_URL ?? 'http://127.0.0.1:3100'
if (!/^0x[0-9a-fA-F]{64}$/.test(FUNDED_KEY ?? '')) throw new Error('Defina TEST_FUNDED_KEY')

type Text = { content: Array<{ type: string; text: string }>; isError?: boolean }
const text = (r: unknown) => (r as Text).content.map((c) => c.text).join('\n')
let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' -> ' + detail.replace(/\n/g, ' | ').slice(0, 170) : ''}`)
  if (!ok) failures++
}

function newHome(walletKey?: `0x${string}`): string {
  const home = mkdtempSync(join(tmpdir(), 'ckyc-home-'))
  if (walletKey) {
    mkdirSync(join(home, '.criptokyc'), { recursive: true })
    const address = privateKeyToAccount(walletKey).address
    writeFileSync(join(home, '.criptokyc', 'wallet.json'), JSON.stringify({ privateKey: walletKey, address }))
  }
  return home
}

async function connect(home: string, env: Record<string, string> = {}) {
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('CRIPTOKYC_') && k !== 'HOME') base[k] = v
  const transport = new StdioClientTransport({
    command: 'node',
    args: [CLI],
    env: { ...base, HOME: home, CRIPTOKYC_API_URL: API, ...env },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'e2e', version: '0.0.1' })
  await client.connect(transport)
  return client
}

// ── A: usuário com saldo (carteira lida do arquivo, nenhuma chave em variável de ambiente) ──
const a = await connect(newHome(FUNDED_KEY), { CRIPTOKYC_MAX_PRICE_PER_CALL: '0.05', CRIPTOKYC_MAX_SPEND_PER_SESSION: '0.04' })
const tools = (await a.listTools()).tools
check('A1 4 ferramentas, nenhuma de depósito/saque', tools.length === 4 && !tools.some((t) => /deposit|withdraw|transfer|key/i.test(t.name)), tools.map((t) => t.name).join(','))
check('A2 get_pricing (grátis)', /0\.01/.test(text(await a.callTool({ name: 'get_pricing', arguments: {} }))))
const bud = text(await a.callTool({ name: 'get_budget', arguments: {} }))
check('A3 get_budget mostra carteira e saldo, sem dica de depósito', /Paying wallet: 0x/.test(bud) && !/Next step/.test(bud), bud.split('\n')[1])
const c1 = await a.callTool({ name: 'check_csnu_names', arguments: { names: ['Noor Wali Mehsud', 'Flavia Ramos Vieira'] } })
check('A4 CSNU paga e retorna veredito', !(c1 as Text).isError && /Noor Wali Mehsud: SANCTIONED/.test(text(c1)) && /Flavia Ramos Vieira: not found/.test(text(c1)), text(c1))
const w1 = await a.callTool({ name: 'check_wallet_sanctions', arguments: { wallets: ['TWBAPzpPiZarfVsY2BLXeaLhNHurn4wkWG'] } })
check('A5 carteira paga e acusa OFAC', !(w1 as Text).isError && /OFAC/.test(text(w1)), text(w1))
const w2 = await a.callTool({ name: 'check_wallet_sanctions', arguments: { wallets: ['0x27d5b2b1769d2cb013e02dce0c1a6c4feb3b6b92'] } })
check('A6 teto da sessão bloqueia sem pagar', (w2 as Text).isError === true && /session spending cap/i.test(text(w2)), text(w2))
check('A7 chave privada nunca aparece nas respostas', ![bud, text(c1), text(w1), text(w2)].some((t) => t.includes(FUNDED_KEY.slice(2, 22))))
await a.close()

// ── B: usuário novo SEM saldo: erro precisa dizer o que fazer ──
const home = newHome()
const b = await connect(home)
const b1 = await b.callTool({ name: 'check_csnu_names', arguments: { names: ['x'] } })
const addrB = /(0x[0-9a-fA-F]{40})/.exec(text(await b.callTool({ name: 'get_budget', arguments: {} })))?.[1] ?? ''
check('B1 primeira execução cria a carteira sozinha', existsSync(join(home, '.criptokyc', 'wallet.json')) && addrB.length === 42, addrB)
check('B2 sem saldo: erro guiado (endereço, faucet e comando de depósito)', (b1 as Text).isError === true && /deposit/.test(text(b1)) && /faucet\.circle\.com/.test(text(b1)) && text(b1).includes(addrB), text(b1))
check('B3 get_budget também traz o próximo passo', /Next step/.test(text(await b.callTool({ name: 'get_budget', arguments: {} }))))
await b.close()

// ── C: serviço fora do ar: mensagem compreensível ──
const c = await connect(newHome(FUNDED_KEY), { CRIPTOKYC_API_URL: 'http://127.0.0.1:9' })
const c1b = await c.callTool({ name: 'check_csnu_names', arguments: { names: ['x'] } })
check('C1 serviço offline: mensagem clara', (c1b as Text).isError === true && /Could not reach the screening service/.test(text(c1b)), text(c1b))
await c.close()

// ── D: entrada inválida ──
const d = await connect(newHome(FUNDED_KEY))
const d1 = await d.callTool({ name: 'check_csnu_names', arguments: { names: [] } }).catch(() => ({ isError: true, content: [{ type: 'text', text: '' }] }))
check('D1 lista vazia rejeitada', (d1 as Text).isError === true)
await d.close()

console.log(failures === 0 ? '\nRESULTADO: TUDO OK' : `\nRESULTADO: ${failures} FALHA(S)`)
process.exit(failures === 0 ? 0 : 1)
