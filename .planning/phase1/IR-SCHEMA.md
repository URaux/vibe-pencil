# IR Schema v0.1 — ArchViber Canonical Intermediate Representation

**Version**: 0.1.0
**Status**: spec locked for Phase 1 implementation
**File on disk**: `<project-root>/.archviber/ir.yaml` (versioned alongside source)

---

## 1. Design principles

1. **Superset of SchemaDocument** — every field in the existing `src/lib/schema-engine.ts#SchemaDocument` is representable; round-trip is lossless.
2. **Additive versioning** — v0.2 will only ADD fields; unknown fields on load are preserved untouched (forward-compat). Breaking changes bump major.
3. **Deterministic serialization** — keys in fixed order, sort sets alphabetically, no timestamps in data fields (only in `audit_log`). This keeps git diffs semantic.
4. **Facts vs. opinions split** — `blocks`/`edges` are opinions (user + LLM); `code_anchors` are facts (derived from AST). Regenerating anchors never mutates user opinions.
5. **Git-friendly** — YAML (not JSON) for readability; one top-level key per concern; small files (< 500 lines typical).

---

## 2. Top-level YAML shape

```yaml
ir_version: "0.1.0"

project:
  name: "ArchViber"
  root: "E:/claude-workspace/archviber"     # absolute on writing machine; normalized on read
  created_at: "2026-04-14T10:00:00Z"
  updated_at: "2026-04-14T14:23:45Z"
  source_language: "typescript"              # primary; polyglot support = Phase 2
  frameworks: ["nextjs", "react"]            # detected, not authored

seed_state:
  # What produced this IR. Used by ingest idempotency cache.
  origin: "import"                           # enum: "import" | "design" | "blank" | "migration"
  import_commit: "a1b2c3d..."                # git HEAD at import time, null if non-git
  ingest_version: "0.1.0"                    # pipeline version for cache-bust

blocks:
  - id: "blk_canvas_editor"                  # stable id, kebab-prefixed by type
    name: "Canvas Editor"                    # user-visible
    description: "React Flow host for diagram editing"
    status: "idle"                           # idle | building | done | error
    container_id: "cnt_frontend"             # parent container ref; null = orphan
    kind: "module"                           # module | service | data_store | external | ui
    tech_stack: "react, @xyflow/react"       # optional
    schema: null                             # BlockSchema passthrough (unchanged from SchemaDocument)
    schema_refs: []                          # string[]
    schema_field_refs: {}                    # Record<string, string[]>
    summary: null                            # agent-produced text
    error_message: null
    code_anchors:                            # SEE §3
      files: ["src/components/Canvas.tsx"]
      primary_entry: "src/components/Canvas.tsx"
      symbols:
        - { name: "Canvas", kind: "function", file: "src/components/Canvas.tsx", line: 47 }
      line_ranges:
        - { file: "src/components/Canvas.tsx", start: 1, end: 820 }
    policies:                                # SEE §4 — always present, may be empty
      write_scope: []
      read_only_scope: []
      allowed_shells: []
      tags: []

containers:
  - id: "cnt_frontend"
    name: "Frontend"
    color: "blue"
    collapsed: false
    parent_id: null                          # nested containers allowed but Phase 1 = flat

edges:
  - id: "edg_canvas_store"
    source: "blk_canvas_editor"
    target: "blk_store"
    type: "sync"                             # sync | async | bidirectional
    label: "reads/writes state"
    semantics: null                          # LLM-proposed edge verb, optional
    code_anchors:                            # optional — which imports justify the edge
      call_sites:
        - { file: "src/components/Canvas.tsx", line: 123, symbol: "useAppStore" }

policies:                                    # PROJECT-LEVEL, always present, always empty in Phase 1
  global_write_scope: []
  forbidden_imports: []
  # NOTE: Phase 1 = field present, NEVER VALIDATED. Phase 2 turns on enforcement.

audit_log:
  - at: "2026-04-14T14:23:45Z"
    actor: "ingest@0.1.0"                    # agent id or "user"
    action: "import"                         # enum: import | edit | modify | build | deep_analyze
    commit: "a1b2c3d..."                     # git HEAD after action, if in repo
    summary: "Imported 412 files, 17 blocks clustered"
    diff_ref: null                           # optional path to a patch file under .archviber/diffs/
```

---

## 3. `code_anchors` sub-schema (the critical Phase 1 addition)

`code_anchors` is the **fact layer** binding diagram entities to real code. Without it, Modify/deep_analyze cannot operate. TS/JS only in Phase 1; Python/Go stubs in Phase 2.

### 3.1 Block-level `code_anchors`

```yaml
code_anchors:
  files:                  # string[] — relative to project.root
    - "src/lib/store.ts"
    - "src/lib/types.ts"
  primary_entry: "src/lib/store.ts"   # the "front door" file — 1 per block

  symbols:
    - name: "useAppStore"             # exported identifier
      kind: "function"                # enum: function | class | type | variable | interface | enum | namespace | default_export
      file: "src/lib/store.ts"        # absolute-normalized to relative
      line: 42                        # 1-indexed, declaration site
      exported: true
      signature: "() => AppState"     # optional; populated by ts-morph when cheap

  line_ranges:            # informational; used by deep_analyze to extract context
    - { file: "src/lib/store.ts", start: 1, end: 380 }

  confidence: 0.92                    # 0..1, anchor-extractor self-score (low = manual review)
```

### 3.2 Edge-level `code_anchors` (optional)

```yaml
code_anchors:
  call_sites:
    - file: "src/components/Canvas.tsx"
      line: 123
      symbol: "useAppStore"            # what's being called/imported
      kind: "import" | "call" | "extends" | "implements"
```

### 3.3 Rules

- `files` ∩ (other block's `files`) SHOULD be empty unless file is explicitly shared infra. Overlap > 0 emits a warning during ingest but is not fatal.
- `primary_entry` MUST be in `files`.
- `symbols[].file` MUST be in `files`.
- On re-ingest: regenerated `code_anchors` replace old ones completely; manual edits to anchors are NOT preserved (edit the diagram semantically instead).
- Empty `code_anchors` = block is intentional (pure design, unbuilt) OR ingest failed. `seed_state.origin` + `status` disambiguates.

---

## 4. Policies sub-schema (field present, unenforced in Phase 1)

Reserved to avoid a schema migration when enforcement lands.

```yaml
policies:
  write_scope: ["src/components/**"]        # glob patterns the block may write to
  read_only_scope: ["src/lib/types.ts"]      # may read, not write
  allowed_shells: ["pnpm test", "tsc"]       # commands agents may run when operating on this block
  tags: ["ui", "performance-critical"]       # free-form labels
```

Phase 1 implementation: schema accepts, serializer emits, validator tolerates — **no handler reads it**.

---

## 5. Versioning strategy (v0.1 → v0.2+)

### Rules

1. **MINOR bump (0.1 → 0.2)** — additive only. New optional fields. Unknown fields on load are preserved via `unknownFields` bag (see §6).
2. **MAJOR bump (0.x → 1.x)** — breaking. Requires a migrator function `migrate_v0_x_to_v1(ir)`.
3. **PATCH bump (0.1.0 → 0.1.1)** — bugfixes only, no schema change.

### Preservation of unknown fields

The Zod validator uses `.passthrough()` at every object level. Unknown top-level keys are preserved in an internal `_unknown` bag and re-emitted on save. This means:

- An agent running v0.2 can write fields v0.1 doesn't know about; v0.1 will round-trip them losslessly.
- v0.1's serializer emits `_unknown` keys last so diffs stay clean.

### Known forward items (Phase 2 candidates)

- `blocks[].governance` — initiative metadata
- `blocks[].test_anchors` — parallel to `code_anchors` for tests
- `team` top-level — shared memory references
- `drift` top-level — last reconciliation with actual code state

---

## 6. Migrator: SchemaDocument → IR v0.1 (pseudocode)

```typescript
// src/lib/ir/migrate.ts
import type { SchemaDocument, SerializedContainer, SerializedBlock, SerializedEdge } from '@/lib/schema-engine'
import type { IR, IRBlock, IREdge, IRContainer } from './schema'
import { randomUUID } from 'crypto'

export function schemaDocumentToIr(
  doc: SchemaDocument,
  opts: { root: string; origin?: IR['seed_state']['origin']; commit?: string | null } = { root: '.' }
): IR {
  const now = new Date().toISOString()
  const prefixedId = (raw: string, prefix: string) =>
    raw.startsWith(`${prefix}_`) ? raw : `${prefix}_${raw.replace(/[^a-z0-9_-]/gi, '_')}`

  const containers: IRContainer[] = doc.containers
    .filter(c => c.id !== 'ungrouped')          // drop synthetic orphan bucket
    .map(c => ({
      id: prefixedId(c.id, 'cnt'),
      name: c.name,
      color: c.color as IRContainer['color'],
      collapsed: false,
      parent_id: null,
    }))

  const blocks: IRBlock[] = doc.containers.flatMap(c =>
    c.blocks.map((b: SerializedBlock) => ({
      id: prefixedId(b.id, 'blk'),
      name: b.name,
      description: b.description ?? '',
      status: (['idle','building','done','error'] as const).includes(b.status as any)
        ? (b.status as IRBlock['status'])
        : 'idle',
      container_id: c.id === 'ungrouped' ? null : prefixedId(c.id, 'cnt'),
      kind: inferKind(b, c),                    // heuristic: container.role + block.name
      tech_stack: b.techStack ?? null,
      schema: b.schema ?? null,
      schema_refs: b.schemaRefs ?? [],
      schema_field_refs: b.schemaFieldRefs ?? {},
      summary: b.summary ?? null,
      error_message: b.errorMessage ?? null,
      code_anchors: {                            // empty on migration — filled on next ingest
        files: [],
        primary_entry: null,
        symbols: [],
        line_ranges: [],
        confidence: 0,
      },
      policies: { write_scope: [], read_only_scope: [], allowed_shells: [], tags: [] },
    }))
  )

  const edges: IREdge[] = (doc.edges ?? []).map(e => ({
    id: prefixedId(e.id, 'edg'),
    source: prefixedId(e.source, 'blk'),
    target: prefixedId(e.target, 'blk'),
    type: (e.type as IREdge['type']) ?? 'sync',
    label: e.label ?? null,
    semantics: null,
    code_anchors: null,
  }))

  return {
    ir_version: '0.1.0',
    project: {
      name: doc.project,
      root: opts.root,
      created_at: now,
      updated_at: now,
      source_language: 'typescript',              // default; ingest overrides
      frameworks: [],
    },
    seed_state: {
      origin: opts.origin ?? 'migration',
      import_commit: opts.commit ?? null,
      ingest_version: '0.1.0',
    },
    containers,
    blocks,
    edges,
    policies: { global_write_scope: [], forbidden_imports: [] },
    audit_log: [
      {
        at: now,
        actor: 'migrator@0.1.0',
        action: 'import',
        commit: opts.commit ?? null,
        summary: `Migrated from SchemaDocument: ${containers.length} containers, ${blocks.length} blocks, ${edges.length} edges`,
        diff_ref: null,
      },
    ],
  }
}

// Reverse: needed so UI rendering path (yamlToCanvas) keeps working unchanged.
export function irToSchemaDocument(ir: IR): SchemaDocument {
  return {
    project: ir.project.name,
    containers: ir.containers.map(c => ({
      id: c.id,
      name: c.name,
      color: c.color,
      blocks: ir.blocks
        .filter(b => b.container_id === c.id)
        .map(b => ({
          id: b.id,
          name: b.name,
          description: b.description,
          status: b.status,
          ...(b.schema ? { schema: b.schema } : {}),
          ...(b.schema_refs.length ? { schemaRefs: b.schema_refs } : {}),
          ...(Object.keys(b.schema_field_refs).length ? { schemaFieldRefs: b.schema_field_refs } : {}),
          ...(b.tech_stack ? { techStack: b.tech_stack } : {}),
          ...(b.summary ? { summary: b.summary } : {}),
          ...(b.error_message ? { errorMessage: b.error_message } : {}),
        })),
    })),
    edges: ir.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      ...(e.label ? { label: e.label } : {}),
    })),
  }
}

function inferKind(b: SerializedBlock, c: SerializedContainer): IRBlock['kind'] {
  if (c.name.toLowerCase().includes('data')) return 'data_store'
  if (c.name.toLowerCase().includes('external')) return 'external'
  if (c.name.toLowerCase().includes('frontend') || c.name.toLowerCase().includes('ui')) return 'ui'
  if (c.name.toLowerCase().includes('service') || c.name.toLowerCase().includes('api')) return 'service'
  return 'module'
}
```

---

## 7. Load/save semantics

```typescript
// src/lib/ir/persist.ts
export async function loadIr(projectDir: string): Promise<IR | null> {
  const path = join(projectDir, '.archviber', 'ir.yaml')
  if (!existsSync(path)) return null
  const raw = await readFile(path, 'utf8')
  const parsed = YAML.parse(raw)                // yaml@^2.8
  return validateIr(parsed)                     // throws on shape error; tolerates unknown keys
}

export async function saveIr(projectDir: string, ir: IR): Promise<void> {
  const dir = join(projectDir, '.archviber')
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `ir.yaml.${process.pid}.tmp`)
  await writeFile(tmp, serializeIr(ir))         // deterministic output
  await rename(tmp, join(dir, 'ir.yaml'))       // atomic
  await ensureGitIgnore(dir)                    // writes .gitignore with "cache/" entry
}
```

Atomic rename guards against partial writes during crash. Determinism guards against spurious git diffs.

---

## 8. Validation rules enforced by Zod (Phase 1)

- `ir_version` must be a semver string starting with `0.1.`
- `project.root` must be a non-empty string
- `blocks[].id` / `containers[].id` / `edges[].id` unique within their array
- `blocks[].container_id` must match some `containers[].id` or be null
- `edges[].source` and `edges[].target` must match some `blocks[].id`
- `blocks[].code_anchors.primary_entry` if non-null must be in `files`
- `blocks[].code_anchors.symbols[].file` must be in `files`
- All `policies.*` arrays must be arrays (may be empty); no element validation in Phase 1

Failure modes:

| Failure | Behavior |
|---|---|
| File missing | `loadIr` returns `null`. UI falls back to legacy `yamlToCanvas` on `data/*.yaml` |
| YAML parse error | Throw. UI shows error toast with file path + "restore from git?" button |
| Zod validation fail | Throw with field path. UI shows error. User may click "migrate anyway" → runs `schemaDocumentToIr` with best-effort |
| Version too high (e.g. 0.2.x on 0.1 runtime) | Load succeeds if only new optional fields; fail if major mismatch |

---

## 9. File on disk — complete example

See `tests/fixtures/ir/archviber-sample.yaml` (to be created in W1.D3). Expected size: ~350 lines for ArchViber-on-itself.
