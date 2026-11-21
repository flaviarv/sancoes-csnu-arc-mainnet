/**
 * test-security.ts — testes de segurança do pacote JÁ INSTALADO (rodar com Bun, o pacote roda em Node).
 *   TEST_CLI=/caminho/node_modules/criptokyc-mcp/dist/cli.js TEST_FUNDED_KEY=0x... bun run test-security.ts
 * Pré-requisito: gateway de teste em http://127.0.0.1:3100 com SELLER_ADDRESS = treasury.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const CLI = process.env.TEST_CLI ?? ''
const KEY = process.env.TEST_FUNDED_KEY ?? ''
if (!CLI || !/^0x[0-9a-fA-F]{64}$/.test(KEY)) throw new Error('defina TEST_CLI e TEST_FUNDED_KEY')

let pass = 0
let fail = 0
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${extra}`}`)
  cond ? pass++ : fail++
}
const tmpHome = () => mkdtempSync(join(tmpdir(), 'ck-sec-'))
const cli = (home: string, args: string[]) =>
  spawnSync('node', [CLI, ...args], { env: { ...process.env, HOME: home, APPDATA: join(home, 'AppData') }, encoding: 'utf8' })

// ── Servidor MCP com carteira financiada, destino configurável ───────────────
async function withServer(payTo: string | undefined, fn: (c: Client) => Promise<void>) {
  const home = tmpHome()
  mkdirSync(join(home, '.criptokyc'), { recursive: true })
  writeFileSync(join(home, '.criptokyc', 'wallet.json'), JSON.stringify({ privateKey: KEY }), { mode: 0o600 })
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: home, CRIPTOKYC_API_URL: 'http://127.0.0.1:3100' }
  if (payTo) env.CRIPTOKYC_PAY_TO = payTo
  const t = new StdioClientTransport({ command: 'node', args: [CLI], env, stderr: 'ignore' })
  const c = new Client({ name: 'sec-test', version: '1.0.0' })
  await c.connect(t)
  try {
    await fn(c)
  } finally {
    await c.close()
  }
}
const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? '')

// S1 destino correto paga
await withServer(undefined, async (c) => {
  const r = await c.callTool({ name: 'check_csnu_names', arguments: { names: ['Noor Wali Mehsud'] } })
  check('S1 destino esperado (treasury): paga e responde', !(r as { isError?: boolean }).isError && /SANCTIONED/.test(text(r)), text(r).slice(0, 120))
})
// S2 destino diferente é recusado ANTES de assinar
await withServer('0x000000000000000000000000000000000000dead', async (c) => {
  const r = await c.callTool({ name: 'check_csnu_names', arguments: { names: ['Noor Wali Mehsud'] } })
  check('S2 destino diferente: pagamento recusado', (r as { isError?: boolean }).isError === true && /destination/i.test(text(r)), text(r).slice(0, 160))
  const b = await c.callTool({ name: 'get_budget', arguments: {} })
  check('S2b nada foi gasto na recusa', /Spent this session: 0\.000000/.test(text(b)) || /spent[^0-9]*0\.000000/i.test(text(b)), text(b).slice(0, 200))
})

// S3 install: versão fixada, backup do original, idempotência, atualização, escrita atômica
const home = tmpHome()
mkdirSync(join(home, '.cursor'), { recursive: true })
const cfgFile = join(home, '.cursor', 'mcp.json')
const original = JSON.stringify({ mcpServers: { outro: { command: 'x' } }, nota: 'original' }, null, 2)
writeFileSync(cfgFile, original)
let r1 = cli(home, ['install', '--client', 'cursor'])
const cfg1 = JSON.parse(readFileSync(cfgFile, 'utf8')) as { mcpServers: Record<string, { args: string[] }>; nota: string }
const pinnedArg = cfg1.mcpServers.criptokyc?.args.find((a) => a.startsWith('criptokyc-mcp'))
check('S3a versão FIXADA na configuração (criptokyc-mcp@x.y.z)', /^criptokyc-mcp@\d+\.\d+\.\d+/.test(pinnedArg ?? ''), String(pinnedArg))
check('S3b configuração existente preservada', cfg1.mcpServers.outro !== undefined && cfg1.nota === 'original')
check('S3c backup criado com o conteúdo ORIGINAL', existsSync(`${cfgFile}.criptokyc.bak`) && readFileSync(`${cfgFile}.criptokyc.bak`, 'utf8') === original)
check('S3d sem arquivo temporário sobrando', !existsSync(`${cfgFile}.criptokyc.tmp`))
check('S3e chave privada NÃO está na configuração', !/0x[0-9a-fA-F]{64}/.test(readFileSync(cfgFile, 'utf8')))

r1 = cli(home, ['install', '--client', 'cursor'])
check('S3f segundo install é idempotente (already)', /already/i.test(r1.stdout + r1.stderr))
check('S3g backup original NÃO foi sobrescrito', readFileSync(`${cfgFile}.criptokyc.bak`, 'utf8') === original)

// simula versão antiga fixada -> install atualiza a entrada e mantém o 1º backup
const old = JSON.parse(readFileSync(cfgFile, 'utf8')) as { mcpServers: Record<string, { args: string[] }> }
old.mcpServers.criptokyc!.args = ['-y', 'criptokyc-mcp@0.0.1']
writeFileSync(cfgFile, JSON.stringify(old, null, 2))
cli(home, ['install', '--client', 'cursor'])
const upd = JSON.parse(readFileSync(cfgFile, 'utf8')) as { mcpServers: Record<string, { args: string[] }> }
check('S3h install atualiza a versão fixada antiga', !upd.mcpServers.criptokyc!.args.includes('criptokyc-mcp@0.0.1'))
check('S3i backup original continua intacto após atualização', readFileSync(`${cfgFile}.criptokyc.bak`, 'utf8') === original)

// S4 JSON inválido nunca é sobrescrito
const bad = tmpHome()
mkdirSync(join(bad, '.cursor'), { recursive: true })
writeFileSync(join(bad, '.cursor', 'mcp.json'), '{ isto nao e json')
cli(bad, ['install', '--client', 'cursor'])
check('S4 JSON inválido preservado (não sobrescreve)', readFileSync(join(bad, '.cursor', 'mcp.json'), 'utf8') === '{ isto nao e json')

// S5 permissões da carteira
const w = tmpHome()
cli(w, ['install', '--client', 'cursor'])
const wf = join(w, '.criptokyc', 'wallet.json')
check('S5 carteira criada com permissão 600', existsSync(wf) && (spawnSync('stat', ['-c', '%a', wf], { encoding: 'utf8' }).stdout.trim() === '600'))
// carteira existente com permissão frouxa é corrigida ao iniciar o servidor
spawnSync('chmod', ['644', wf])
await new Promise<void>((resolve) => {
  const t = new StdioClientTransport({ command: 'node', args: [CLI], env: { ...(process.env as Record<string, string>), HOME: w }, stderr: 'ignore' })
  const c = new Client({ name: 'perm', version: '1' })
  c.connect(t).then(async () => { await c.close(); resolve() }).catch(() => resolve())
})
check('S5b permissão frouxa (644) corrigida para 600', spawnSync('stat', ['-c', '%a', wf], { encoding: 'utf8' }).stdout.trim() === '600')

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
