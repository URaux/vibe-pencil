/**
 * Language adapter registry — W2.D1.
 *
 * Central store for all registered LanguageAdapters. Keyed by adapter id.
 * Extension lookup is O(n) over registered adapters — fine at our scale
 * (expected ≤ 10 languages for the foreseeable future).
 *
 * WASM grammar paths:
 *   All grammars are sourced from `tree-sitter-wasms` (npm package).
 *   The `out/` directory contains pre-built .wasm files for all major languages.
 *   Available grammars confirmed in tree-sitter-wasms@^0.1.13:
 *     typescript, tsx, javascript, python, go, java, rust, c, cpp, c_sharp,
 *     bash, css, html, json, kotlin, lua, ruby, scala, swift, …
 *   Import path pattern: `<pkg-root>/out/tree-sitter-<lang>.wasm`
 *   Resolved via `createRequire(import.meta.url).resolve('tree-sitter-wasms/package.json')`.
 *   No additional npm dependencies are needed — tree-sitter-wasms ships them all.
 */

import type { LanguageAdapter } from './types'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Internal store
// ---------------------------------------------------------------------------

const adapters = new Map<string, LanguageAdapter>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register an adapter. Registering an adapter with the same id as an existing
 * one **replaces** the existing registration (last-writer-wins). This is
 * intentional: test overrides and hot-patching during dev should work without
 * ceremony. If you want strict uniqueness, check `listAdapters()` first.
 */
export function registerAdapter(adapter: LanguageAdapter): void {
  adapters.set(adapter.id, adapter)
}

/**
 * Look up the adapter responsible for a given file path by matching its
 * extension against each registered adapter's `fileExtensions`.
 *
 * Returns `null` when no registered adapter covers the extension.
 */
export function findAdapter(filePath: string): LanguageAdapter | null {
  const ext = path.extname(filePath).toLowerCase()
  for (const adapter of adapters.values()) {
    if (adapter.fileExtensions.includes(ext)) return adapter
  }
  return null
}

/**
 * Return all registered adapters in registration-insertion order.
 * The returned array is a snapshot — mutations to the registry after this
 * call do not affect the returned array.
 */
export function listAdapters(): LanguageAdapter[] {
  return Array.from(adapters.values())
}
