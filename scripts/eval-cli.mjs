#!/usr/bin/env node
/**
 * eval-cli.mjs — phase3/eval-cli: unified eval entry point.
 *
 * Usage:
 *   node scripts/eval-cli.mjs <subcommand> [args...]
 *
 * Subcommands:
 *   live     Run live LLM eval (run-eval-live.mjs)
 *   history  Aggregate eval snapshot history (eval-history.mjs)
 *   alerts   Check accuracy alerts (eval-alert.mjs)
 *   multi    Parallel multi-model eval (run-eval-multi.mjs)
 *   help     Print this message
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SUBCOMMANDS = {
  live: 'run-eval-live.mjs',
  history: 'eval-history.mjs',
  alerts: 'eval-alert.mjs',
  multi: 'run-eval-multi.mjs',
}

const HELP = `
eval-cli — unified eval entry point

Usage:
  node scripts/eval-cli.mjs <subcommand> [args...]

Subcommands:
  live     Run live LLM eval (run-eval-live.mjs)
  history  Aggregate eval snapshot history (eval-history.mjs)
  alerts   Check accuracy alerts (eval-alert.mjs)
  multi    Parallel multi-model eval (run-eval-multi.mjs)
  help     Print this message
`.trim()

const [subcommand, ...rest] = process.argv.slice(2)

if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
  console.log(HELP)
  process.exit(0)
}

const target = SUBCOMMANDS[subcommand]
if (!target) {
  console.error(`eval-cli: unknown subcommand '${subcommand}'`)
  console.error(`Run 'node scripts/eval-cli.mjs help' for usage.`)
  process.exit(1)
}

const scriptPath = path.join(__dirname, target)
const child = spawn(process.execPath, [scriptPath, ...rest], { stdio: 'inherit' })

child.on('error', (err) => {
  console.error(`eval-cli: failed to spawn ${target}: ${err.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
