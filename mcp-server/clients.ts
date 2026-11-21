/**
 * clients.ts — registra o servidor nos clientes de IA, sem o usuário editar JSON.
 *
 * Nunca grava a chave privada na configuração do cliente: a carteira fica em ~/.criptokyc/.
 * Se o arquivo de configuração existir mas for inválido, NÃO o sobrescreve.
 */
import { spawnSync } from 'node:child_process'
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PACKAGE_NAME, SERVER_NAME, packageVersion } from './config.ts'

export type ClientId = 'claude-desktop' | 'cursor' | 'claude-code'
export const ALL_CLIENTS: ClientId[] = ['claude-desktop', 'cursor', 'claude-code']

const isWin = () => process.platform === 'win32'

/** Pacote com a versão FIXADA: uma atualização maliciosa no npm não roda sozinha na carteira do usuário. */
const pinned = (): string => `${PACKAGE_NAME}@${packageVersion()}`

/** Entrada MCP padrão. No Windows, "npx" precisa passar pelo cmd. */
export function mcpEntry(): { command: string; args: string[] } {
  const args = ['-y', pinned()]
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
      return { client: id, status: 'skipped', detail: `Claude Code CLI not found. Run: claude mcp add -s user ${SERVER_NAME} -- npx -y ${pinned()}` }
    }
    const add = () => spawnSync('claude', ['mcp', 'add', '-s', 'user', SERVER_NAME, '--', 'npx', '-y', pinned()], { encoding: 'utf8', shell: isWin() })
    let r = add()
    let out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n')[0] ?? ''
    if (r.status !== 0 && /already exists/i.test(out)) {
      // já registrado: atualiza para a versão fixada atual
      spawnSync('claude', ['mcp', 'remove', '-s', 'user', SERVER_NAME], { stdio: 'ignore', shell: isWin() })
      r = add()
      out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n')[0] ?? ''
    }
    if (r.status === 0) return { client: id, status: 'installed', detail: `registered with "claude mcp add" (${pinned()})` }
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
  } else {
    mkdirSync(dirname(file), { recursive: true })
  }
  const servers = (config.mcpServers ??= {})
  const entry = mcpEntry()
  if (JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(entry)) return { client: id, status: 'already', detail: file }

  // Backup só quando vamos modificar, e NUNCA sobrescreve um backup existente (o original é preservado).
  if (existsSync(file)) {
    const bak = `${file}.criptokyc.bak`
    copyFileSync(file, existsSync(bak) ? `${bak}.${Date.now()}` : bak, constants.COPYFILE_EXCL)
  }
  servers[SERVER_NAME] = entry
  // Escrita atômica: um erro no meio nunca deixa a configuração do cliente corrompida.
  const tmp = `${file}.criptokyc.tmp`
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n')
  renameSync(tmp, file)
  return { client: id, status: 'installed', detail: file }
}
