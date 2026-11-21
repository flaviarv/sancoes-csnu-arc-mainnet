/**
 * clients.ts — registra o servidor nos clientes de IA, sem o usuário editar JSON.
 *
 * Nunca grava a chave privada na configuração do cliente: a carteira fica em ~/.criptokyc/.
 * Se o arquivo de configuração existir mas for inválido, NÃO o sobrescreve.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PACKAGE_NAME, SERVER_NAME } from './config.ts'

export type ClientId = 'claude-desktop' | 'cursor' | 'claude-code'
export const ALL_CLIENTS: ClientId[] = ['claude-desktop', 'cursor', 'claude-code']

const isWin = () => process.platform === 'win32'

/** Entrada MCP padrão. No Windows, "npx" precisa passar pelo cmd. */
export function mcpEntry(): { command: string; args: string[] } {
  const args = ['-y', PACKAGE_NAME]
  return isWin() ? { command: 'cmd', args: ['/c', 'npx', ...args] } : { command: 'npx', args }
}

export function configPath(id: ClientId): string | null {
  const home = homedir()
  if (id === 'cursor') return join(home, '.cursor', 'mcp.json')
  if (id === 'claude-desktop') {
    if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    if (isWin()) return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
    return join(home, '.config', 'Claude', 'claude_desktop_config.json')
  }
  return null // claude-code usa o comando "claude mcp add"
}

function hasClaudeCli(): boolean {
  return spawnSync('claude', ['--version'], { stdio: 'ignore', shell: isWin() }).status === 0
}

/** Clientes que parecem instalados nesta máquina. */
export function detectClients(): ClientId[] {
  const found: ClientId[] = []
  for (const id of ['claude-desktop', 'cursor'] as const) {
    const p = configPath(id)
    if (p && existsSync(dirname(p))) found.push(id)
  }
  if (hasClaudeCli()) found.push('claude-code')
  return found
}

export interface InstallResult {
  client: ClientId
  status: 'installed' | 'already' | 'skipped' | 'failed'
  detail: string
}

export function installInto(id: ClientId): InstallResult {
  if (id === 'claude-code') {
    if (!hasClaudeCli()) {
      return { client: id, status: 'skipped', detail: `Claude Code CLI not found. Run: claude mcp add -s user ${SERVER_NAME} -- npx -y ${PACKAGE_NAME}` }
    }
    const r = spawnSync('claude', ['mcp', 'add', '-s', 'user', SERVER_NAME, '--', 'npx', '-y', PACKAGE_NAME], { encoding: 'utf8', shell: isWin() })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n')[0] ?? ''
    if (r.status === 0) return { client: id, status: 'installed', detail: 'registered with "claude mcp add"' }
    if (/already exists/i.test(out)) return { client: id, status: 'already', detail: 'already registered' }
    return { client: id, status: 'failed', detail: out || 'claude mcp add failed' }
  }

  const file = configPath(id)!
  let config: { mcpServers?: Record<string, unknown> } = {}
  if (existsSync(file)) {
    try {
      config = JSON.parse(readFileSync(file, 'utf8') || '{}') as typeof config
    } catch {
      return { client: id, status: 'failed', detail: `${file} is not valid JSON; left untouched. Fix it or add the entry by hand.` }
    }
    copyFileSync(file, `${file}.criptokyc.bak`)
  } else {
    mkdirSync(dirname(file), { recursive: true })
  }
  const servers = (config.mcpServers ??= {})
  if (servers[SERVER_NAME]) return { client: id, status: 'already', detail: file }
  servers[SERVER_NAME] = mcpEntry()
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
  return { client: id, status: 'installed', detail: file }
}
