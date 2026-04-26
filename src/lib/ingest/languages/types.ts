/**
 * LanguageAdapter interface — W2.D1.
 *
 * Every language backend (TypeScript, Python, Go, …) must implement this
 * interface. Adding a new language = one adapter file + one registry call.
 *
 * Fact types live in `../facts`; Parser type comes from `web-tree-sitter`.
 */

import type Parser from 'web-tree-sitter'
import type { FactInputModule } from '../facts'

// Re-export ParsedSymbol shape so adapter files don't need a second import.
export type { FactInputModule }

/**
 * Core pluggable interface. One instance per language.
 *
 * Constraint: `extractFacts` must return a `FactInputModule` for a single
 * file — same shape accepted by `buildFactGraph` in `../facts`.
 */
export interface LanguageAdapter {
  /** Canonical language id. Must be unique across registered adapters. */
  readonly id: string
  /** File extensions handled by this adapter, e.g. ['.ts', '.tsx']. */
  readonly fileExtensions: readonly string[]
  /**
   * Extract imports/exports/symbols from a parsed tree. Callers supply a
   * pre-parsed `Parser.Tree` so adapters don't own parser lifecycle.
   *
   * Returns a `FactInputModule` compatible with `buildFactGraph`.
   */
  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule
  /**
   * Infer a human-readable tech-stack label from previously extracted facts.
   * e.g. 'TypeScript/Next.js', 'Python/FastAPI', 'Go/Gin'.
   */
  inferTechStack(facts: FactInputModule[]): string
  /**
   * Lazily load and return a language-specific `Parser` instance (web-tree-sitter).
   * Implementations must cache internally — callers may call this repeatedly.
   */
  loadParser(): Promise<Parser>
}
