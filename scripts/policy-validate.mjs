#!/usr/bin/env node
/**
 * policy-validate.mjs — phase3/policy-validate-cli
 *
 * Validates a policy.yaml against policySchema. Prints all Zod validation
 * issues with paths and exits 1 on any failure.
 *
 * Usage:
 *   node scripts/policy-validate.mjs [path]
 *
 * Defaults to .archviber/policy.yaml in the current working directory.
 * Exit codes:
 *   0  Valid
 *   1  File missing / invalid YAML / schema violation
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import jiti from '../node_modules/jiti/lib/jiti.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const jitiLoader = jiti(__filename, { interopDefault: true, esmResolve: true })
const { policySchema } = jitiLoader(path.join(__dirname, '../src/lib/policy/schema.ts'))

const DEFAULT_PATH = path.join('.archviber', 'policy.yaml')
const targetPath = process.argv[2] ?? DEFAULT_PATH

let text
try {
  text = fs.readFileSync(targetPath, 'utf8')
} catch (err) {
  const code = err?.code
  if (code === 'ENOENT') {
    console.error(`policy-validate: file not found: ${targetPath}`)
  } else {
    console.error(`policy-validate: cannot read ${targetPath}: ${err.message}`)
  }
  process.exit(1)
}

let raw
try {
  raw = parseYaml(text)
} catch (err) {
  console.error(`policy-validate: invalid YAML in ${targetPath}: ${err.message}`)
  process.exit(1)
}

const result = policySchema.safeParse(raw ?? {})
if (!result.success) {
  console.error(`policy-validate: schema violation in ${targetPath}`)
  for (const issue of result.error.issues) {
    const p = issue.path.length > 0 ? issue.path.join('.') : '(root)'
    console.error(`  ${p}: ${issue.message}`)
  }
  process.exit(1)
}

process.exit(0)
