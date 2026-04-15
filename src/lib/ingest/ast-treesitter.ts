/**
 * AST scaffold — tree-sitter backend (W2.D2, stub).
 *
 * Complements `ast-ts.ts` (ts-morph, authoritative for TS) by offering a
 * faster, error-tolerant parser that can extend to non-TS languages
 * (Python, Go, JSX dialects, etc.) in later milestones.
 *
 * Status: STUB. Neither `tree-sitter` (native) nor `web-tree-sitter` (wasm)
 * is installed yet — see `package.json`. This file defines the public
 * interface and language-detection plumbing so downstream consumers
 * (facts.ts, W2.D3) can depend on a stable shape while the real parser
 * is wired up.
 *
 * TODO(W2.D2): install tree-sitter (prefer `web-tree-sitter` for
 * cross-platform wasm — avoids native rebuilds on Windows) plus the
 * grammar wasm files (tree-sitter-typescript, tree-sitter-javascript),
 * then replace `parseWithStub` with a real parser that walks the CST
 * and populates `imports`, `exports`, and `symbols`. Mirror the node-kind
 * mapping from `ast-ts.ts`'s `inferSymbolKindFromNode`.
 */

import * as path from 'node:path'
import type { ParsedImport, ParsedSymbol, SymbolKind } from './ast-ts'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Languages the tree-sitter backend is prepared to handle. TS/JS are the
 * bootstrap targets; Python / Go are reserved for later extension.
 */
export type TreeSitterLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'

/**
 * Per-file parse result. Intentionally mirrors `ParsedModule` from
 * `ast-ts.ts` so downstream code can unify the two backends behind a
 * single type. The extra `language` field records which grammar was used.
 */
export interface TreeSitterParseResult {
  /** Absolute, normalized (forward-slash) path to the source file. */
  file: string
  language: TreeSitterLanguage
  imports: ParsedImport[]
  /** Exported binding names (including `default`). */
  exports: string[]
  symbols: ParsedSymbol[]
  /** Non-fatal notes — e.g. "stub: returned empty result". */
  warnings: string[]
}

/**
 * Thrown when `parseTreeSitterFile` is called before the real parser is
 * wired up. Distinct class so tests and callers can `instanceof`-check
 * rather than string-matching a message.
 */
export class TreeSitterNotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TreeSitterNotImplementedError'
  }
}

/**
 * Thrown for unsupported file extensions. Callers that want to silently
 * skip non-TS files should pre-filter via `detectLanguage`.
 */
export class UnsupportedLanguageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedLanguageError'
  }
}

// ---------------------------------------------------------------------------
// Language detection — extensible map, exported for tests & callers
// ---------------------------------------------------------------------------

/**
 * Map of lowercase file extension (including leading dot) → language id.
 * Extend this when adding a new grammar (e.g. `.py`: 'python').
 */
export const LANGUAGE_EXTENSIONS: Readonly<Record<string, TreeSitterLanguage>> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
}

/**
 * Best-effort language detection from a filesystem path. Returns
 * `undefined` for unsupported extensions so callers can decide whether
 * to skip or treat as an error. `.d.ts` is intentionally unsupported —
 * declaration files are handled (or ignored) by the ts-morph backend.
 */
export function detectLanguage(filePath: string): TreeSitterLanguage | undefined {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.d.ts')) return undefined
  const ext = path.extname(lower)
  return LANGUAGE_EXTENSIONS[ext]
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Parse a single source file via tree-sitter and return imports/exports/
 * symbols in a shape compatible with `ast-ts.ts`'s `ParsedModule`.
 *
 * STUB: currently returns an empty-but-valid result for supported languages
 * and throws `TreeSitterNotImplementedError` when `strict: true` is passed.
 * This lets downstream scaffolding integrate today while the real parser
 * is wired up separately.
 *
 * TODO(W2.D2): replace the stub body with a real tree-sitter walk.
 */
export function parseTreeSitterFile(
  filePath: string,
  source: string,
  options: { strict?: boolean } = {},
): TreeSitterParseResult {
  const language = detectLanguage(filePath)
  if (!language) {
    throw new UnsupportedLanguageError(
      `tree-sitter backend: unsupported extension for ${filePath}`,
    )
  }

  if (options.strict) {
    throw new TreeSitterNotImplementedError(
      `tree-sitter backend not yet wired up — install web-tree-sitter and implement parseWithStub (W2.D2 TODO). file=${filePath}`,
    )
  }

  return parseWithStub(filePath, source, language)
}

// ---------------------------------------------------------------------------
// Internal — stub implementation
// ---------------------------------------------------------------------------

/**
 * Placeholder for the real tree-sitter walk. Returns a syntactically valid
 * but empty `TreeSitterParseResult` so downstream code can wire up and test
 * end-to-end flow without waiting for the grammar load path.
 *
 * TODO(W2.D2): replace with a real parser. The `_source` param will feed
 * `parser.parse(source)` once the grammar is loaded; see module-level TODO.
 */
function parseWithStub(
  filePath: string,
  _source: string,
  language: TreeSitterLanguage,
): TreeSitterParseResult {
  return {
    file: normalizePath(filePath),
    language,
    imports: [],
    exports: [],
    symbols: [],
    warnings: [
      'tree-sitter backend is a stub — returned empty imports/exports/symbols',
    ],
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePath(p: string): string {
  return p.split('\\').join('/')
}

// Re-export shared symbol kind so downstream consumers can unify types
// against the tree-sitter backend without importing from ast-ts directly.
export type { SymbolKind, ParsedImport, ParsedSymbol }
