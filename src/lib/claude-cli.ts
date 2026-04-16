import fs from 'fs'
import path from 'path'

const DEFAULT_NPM_GLOBAL = process.env.NPM_GLOBAL_PATH ?? 'E:/tools/npm-global'

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
