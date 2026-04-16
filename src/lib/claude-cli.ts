import fs from 'fs'
import os from 'os'
import path from 'path'

const DEFAULT_NPM_GLOBAL = process.env.NPM_GLOBAL_PATH ?? 'E:/tools/npm-global'

/**
 * Writes (once per process) an empty MCP-servers config under a temp dir and
 * returns its absolute path. Paired with `--strict-mcp-config`, this prevents
 * a spawned Claude Code child from loading ANY MCP server — critical because
 * the user's global settings enable the Telegram plugin, and a child process
 * polling the same bot token races with the host CC and silently drops
 * inbound updates. Host keeps Telegram; ArchViber children stay dark.
 */
let cachedEmptyMcpConfigPath: string | null = null
export function getEmptyMcpConfigPath(): string {
  if (cachedEmptyMcpConfigPath && fs.existsSync(cachedEmptyMcpConfigPath)) {
    return cachedEmptyMcpConfigPath
  }
  const dir = path.join(os.tmpdir(), 'archviber')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, 'child-mcp-empty.json')
  fs.writeFileSync(filePath, JSON.stringify({ mcpServers: {} }), 'utf8')
  cachedEmptyMcpConfigPath = filePath
  return filePath
}

/** Extra CLI flags every ArchViber-spawned CC child should receive. */
export function getChildIsolationArgs(): string[] {
  return ['--strict-mcp-config', '--mcp-config', getEmptyMcpConfigPath()]
}

/**
 * Scrubs env keys that a child should never see. Currently: Telegram bot
 * token — belt + braces against the plugin trying to read it from the
 * environment in addition to the channels/.env file. Mutates in place.
 */
export function scrubChildEnv(env: NodeJS.ProcessEnv): void {
  delete env.TELEGRAM_BOT_TOKEN
  delete env.TELEGRAM_CHAT_ID
}

function getClaudeCliCandidates(cwd: string) {
  return [
    path.join(cwd, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    path.join(DEFAULT_NPM_GLOBAL, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
  ]
}

export function resolveClaudeCliScriptPath(cwd: string = process.cwd()) {
  for (const candidate of getClaudeCliCandidates(cwd)) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export function getClaudeCliInvocation(args: string[], cwd: string = process.cwd()) {
  const scriptPath = resolveClaudeCliScriptPath(cwd)

  if (scriptPath) {
    return {
      command: process.execPath,
      args: [scriptPath, ...args],
      useShell: false,
    }
  }

  return {
    command: 'claude',
    args,
    useShell: undefined,
  }
}
