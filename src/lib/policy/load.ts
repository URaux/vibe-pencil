/**
 * Policy loader — W3.D5.
 *
 * Reads `.archviber/policy.yaml` at the project root. Returns the parsed
 * Policy or DEFAULT_POLICY when the file is absent. Schema-validation errors
 * surface as thrown Errors so callers know to surface them — silently
 * defaulting on a malformed policy file would mask real misconfiguration.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { policySchema, DEFAULT_POLICY, type Policy } from './schema'

export const POLICY_RELATIVE_PATH = path.join('.archviber', 'policy.yaml')

export async function loadPolicy(projectRoot: string): Promise<Policy> {
  const abs = path.join(projectRoot, POLICY_RELATIVE_PATH)
  let text: string
  try {
    text = await fs.readFile(abs, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return DEFAULT_POLICY
    throw err
  }

  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (err) {
    throw new Error(
      `policy.yaml is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const result = policySchema.safeParse(parsed ?? {})
  if (!result.success) {
    throw new Error(
      `policy.yaml schema validation failed: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    )
  }
  return result.data
}
