# IR Orphan Semantics — Analysis & Canonical Representation

**Scope**: Phase 1 IR migrator — how blocks without a container parent are represented in SchemaDocument, IR v0.1, and round-trips between them.

---

## 1. Current State (from source code, not assumptions)

### 1.1 Does ArchViber allow orphan blocks on the Canvas?

**Yes, explicitly.** Two code paths confirm this:

**`Canvas.tsx` line 586-595** — "Add Block" via drop. When no container is under the cursor, the block is created with `parentId` absent and `extent` absent:
```ts
addNode({
  id: `block-${Date.now()}`,
  type: 'block',
  position: targetContainer ? getRelativeBlockPosition(...) : position,
  ...(targetContainer
    ? { parentId: targetContainer.id, extent: 'parent' as const }
    : {}),   // <-- no parentId, no extent — valid orphan
  data: { name: '', description: '', status: 'idle' },
})
```

**`Canvas.tsx` lines 611-631** — Drag-to-reparent (onNodeDragStop). When a block is dragged off all containers, `nextParentId = null` and the node is updated with `parentId: undefined, extent: undefined`. This is a first-class "ungroup" operation.

The store's `updateNodeParent(nodeId, null)` (store.ts line 316-328) sets `parentId: undefined`. Orphan blocks live in `nodes[]` with no `parentId`. ReactFlow renders them as free-floating nodes on the canvas — this is fully valid in the XYFlow model.

### 1.2 How does SchemaDocument represent orphans?

`canvasToYaml` in `schema-engine.ts` lines 403-411:
```ts
const orphanBlocks = blocks.filter(
  (block) => !block.parentId || !containers.some((c) => c.id === block.parentId)
)
if (orphanBlocks.length > 0) {
  serializedContainers.push({
    ...UNGROUPED_CONTAINER,   // { id: 'ungrouped', name: 'Ungrouped', color: 'slate', blocks: [] }
    blocks: orphanBlocks.map(toSerializedBlock),
  })
}
```

The `ungrouped` container is a **synthetic bucket** — only emitted when orphan blocks exist. It is never created by the user. On reload, `yamlToCanvas` treats it as a normal container and builds a container node with `id: 'ungrouped'`. This means after one save/load cycle, previously free-floating blocks now have a visible "Ungrouped" container box on screen — **the round-trip is NOT identity**.

---

## 2. The IR Migrator Bug (Codex Review Finding)

The migrator in `IR-SCHEMA.md` lines 202-221 does two things:

**Step A** — drops the synthetic container:
```ts
const containers: IRContainer[] = doc.containers
  .filter(c => c.id !== 'ungrouped')   // ← removes it from containers array
  .map(...)
```

**Step B** — sets `container_id: null` for orphan blocks:
```ts
container_id: c.id === 'ungrouped' ? null : prefixedId(c.id, 'cnt'),
```

**What's lost**: The migrator correctly sets `container_id: null`. So far so good. The bug is in the **reverse path** `irToSchemaDocument` (lines 282-311).

`irToSchemaDocument` iterates over `ir.containers` only:
```ts
containers: ir.containers.map(c => ({
  ...
  blocks: ir.blocks
    .filter(b => b.container_id === c.id)
    .map(...)
}))
```

**Orphan blocks (`container_id === null`) are never emitted.** They vanish from the output `SchemaDocument`. When that document is fed back to `yamlToCanvas`, the orphan blocks are **permanently lost**.

**Concrete failure scenario**:
1. User has: `[BlockA (orphan), BlockB (in cnt_frontend), edge A→B]`
2. `canvasToYaml` → YAML has `containers: [cnt_frontend, ungrouped]`
3. `schemaDocumentToIr` → IR has `blocks: [blk_BlockA (container_id: null), blk_BlockB]`, `containers: [cnt_frontend]`
4. `irToSchemaDocument` → only emits `cnt_frontend` with `BlockB`. `BlockA` is gone.
5. Also: the edge `A→B` now has a dangling source. The Zod validator on `SchemaDocument` does not validate edge endpoints, so this silently corrupts the graph.

---

## 3. Three Candidate Representations

### Scheme X: Implicit Root Container

Add a reserved container `cnt_root` or `cnt_canvas` that all orphan blocks are assigned to. On import from SchemaDocument, orphans in `ungrouped` get `container_id: 'cnt_root'`. On export, `cnt_root` blocks emit as the `ungrouped` synthetic container.

**Round-trip**: Lossless if `cnt_root` is consistently mapped to/from `ungrouped`.
**Git diff readability**: `container_id: "cnt_root"` is explicit — no nulls — but semantically it's a lie. Two blocks in `cnt_root` are not in the same logical group; they just have no group.
**Implementation complexity**: Medium. Requires always injecting `cnt_root` into `ir.containers` even when empty, and filtering it from UI display. The Zod validation rule `container_id must match some containers[].id` is satisfied, but you now have a "ghost" container in the containers array that the UI must never show as a selectable group.
**Verdict**: Adds hidden state, makes the containers array non-authoritative for "what the user sees".

### Scheme Y: Flat Blocks with `container_id: string | null`

Current IR design. Each block has `container_id: string | null` where `null` means orphan. The bug is not in the data model — it's purely in `irToSchemaDocument` omitting null-container blocks. Fix the reverse path only.

**Round-trip**: Lossless after the one-line fix.
**Git diff readability**: `container_id: null` is semantically clear — "this block is on the canvas but not in any group". Stable under repeated saves if user doesn't change anything.
**Implementation complexity**: Minimal. Fix `irToSchemaDocument` to collect orphan blocks and emit the `ungrouped` synthetic container when needed. One extra `.filter(b => b.container_id === null)` clause.
**Verdict**: Correct model, trivial fix. `null` is honest — it says "no parent" rather than pretending one exists.

### Scheme Z: Explicit `"ungrouped"` Special Container ID

Like Scheme X but uses the string literal `"ungrouped"` as the reserved ID instead of `null`. Blocks get `container_id: "ungrouped"` and a matching entry always exists in `containers` with special flags.

**Round-trip**: Lossless but adds round-trip friction: `irToSchemaDocument` must not emit this as a visible container in `yamlToCanvas` path (or `yamlToCanvas` must skip it). Requires distinguishing "real" containers from this special one at every callsite.
**Git diff readability**: Noisier — every orphan block shows `container_id: "ungrouped"` instead of `null`. Moving a block between a real container and orphan status is indistinguishable in diff from renaming its container.
**Implementation complexity**: High. Every container list consumer must handle the sentinel case. The Zod validator must whitelist it. The UI must filter it from container pickers. This proliferates special-case checks.
**Verdict**: Unnecessary complexity. Solves a non-problem — `null` is already a valid sentinel in TypeScript.

---

## 4. Recommended Canonical Representation

**Scheme Y with `container_id: string | null`** — current IR data model is correct. The bug is a missing code path in `irToSchemaDocument`.

**Fix** (two changes):

```typescript
// irToSchemaDocument — add orphan handling
export function irToSchemaDocument(ir: IR): SchemaDocument {
  const orphanBlocks = ir.blocks.filter(b => b.container_id === null)

  return {
    project: ir.project.name,
    containers: [
      ...ir.containers.map(c => ({
        id: c.id,
        name: c.name,
        color: c.color,
        blocks: ir.blocks
          .filter(b => b.container_id === c.id)
          .map(blockToSerialized),
      })),
      // Emit synthetic ungrouped container only when needed — mirrors canvasToYaml behavior
      ...(orphanBlocks.length > 0
        ? [{ ...UNGROUPED_CONTAINER, blocks: orphanBlocks.map(blockToSerialized) }]
        : []),
    ],
    edges: ir.edges.map(edgeToSerialized),
  }
}
```

**Why `null` over alternatives**:
- TypeScript type system natively expresses optionality via `string | null`; no sentinel strings needed
- IR Zod schema already allows null: `container_id: z.string().nullable()`
- Git diffs are unambiguous: `container_id: null` clearly means "no parent"
- The SchemaDocument layer already has the `ungrouped` convention; the IR doesn't need to replicate it internally
- Reverse path is trivial: one filter clause, no new containers array entries

---

## 5. Cross-Impact with Persistent UID / Content Hash

The IR spec discussion mentions two ID schemes: stable random UIDs vs. content-hash-derived IDs.

### Orphan + hash scheme

If block ID is a hash of `(name, description, container_id, ...)`:

- **Problem**: Changing `container_id` from `null` to `"cnt_frontend"` (grouping an orphan) changes the hash → new ID → downstream edges break (they reference the old ID).
- **Mitigation option A**: Exclude `container_id` from the hash input. Hash only intrinsic block content: `(name, description, kind, tech_stack)`. Container membership is a structural/layout fact, not a semantic identity fact.
- **Mitigation option B**: Keep hash over all fields but make edge references use the old ID until an explicit "rename" action is committed.
- **Recommendation**: Exclude `container_id` from hash. A block's identity should not change because the user dragged it into a group.

### Orphan + UUID scheme

No issue. UUIDs are assigned once at block creation and never change regardless of parent transitions.

### orphan→grouped transition — ID impact

| Scheme | orphan→grouped | grouped→orphan |
|--------|----------------|----------------|
| UUID | ID unchanged, `container_id` changes | ID unchanged |
| Hash (content-only) | ID unchanged if name/desc unchanged | ID unchanged |
| Hash (includes container_id) | **ID changes** — all edges referencing it break | **ID changes** |

**Bottom line**: if using content hashing, the hash input MUST exclude `container_id`. This is the correct design regardless of orphan semantics.

---

## 6. Modify Intent — IR Diff for "Ungroup Block A"

When the agent receives intent "move block A to no container":

```yaml
# IR diff patch (JSON Patch / structural)
- op: replace
  path: /blocks/[id=blk_A]/container_id
  value: null
```

The audit_log entry:
```yaml
- at: "2026-04-14T15:00:00Z"
  actor: "user"
  action: "modify"
  summary: "Ungroup blk_A: container_id cnt_frontend → null"
  diff_ref: ".archviber/diffs/modify-20260414-150000.patch"
```

No other IR fields change. No containers are added or removed. The block persists in `blocks[]` with `container_id: null`. On next `irToSchemaDocument` call, the fixed reverse path emits it in the `ungrouped` synthetic container so `yamlToCanvas` renders it as a free-floating block.

---

## 7. TypeScript Schema Draft

```typescript
// src/lib/ir/schema.ts

import { z } from 'zod'

export const IRContainerSchema = z.object({
  id: z.string().regex(/^cnt_/),
  name: z.string().min(1),
  color: z.enum(['blue', 'green', 'purple', 'amber', 'rose', 'slate']),
  collapsed: z.boolean().default(false),
  parent_id: z.string().nullable().default(null),
}).passthrough()

export const IRCodeAnchorsSchema = z.object({
  files: z.array(z.string()),
  primary_entry: z.string().nullable(),
  symbols: z.array(z.object({
    name: z.string(),
    kind: z.enum(['function', 'class', 'type', 'variable', 'interface', 'enum', 'namespace', 'default_export']),
    file: z.string(),
    line: z.number().int().positive(),
    exported: z.boolean().optional(),
    signature: z.string().optional(),
  })),
  line_ranges: z.array(z.object({
    file: z.string(),
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  })),
  confidence: z.number().min(0).max(1).default(0),
}).passthrough()

export const IRBlockSchema = z.object({
  id: z.string().regex(/^blk_/),
  name: z.string().min(1),
  description: z.string().default(''),
  status: z.enum(['idle', 'building', 'done', 'error']).default('idle'),
  // KEY FIELD: null = orphan (valid, free-floating on canvas)
  // MUST be excluded from content-hash computation if using hash IDs
  container_id: z.string().nullable(),
  kind: z.enum(['module', 'service', 'data_store', 'external', 'ui']).default('module'),
  tech_stack: z.string().nullable().default(null),
  schema: z.unknown().nullable().default(null),
  schema_refs: z.array(z.string()).default([]),
  schema_field_refs: z.record(z.array(z.string())).default({}),
  summary: z.string().nullable().default(null),
  error_message: z.string().nullable().default(null),
  code_anchors: IRCodeAnchorsSchema,
  policies: z.object({
    write_scope: z.array(z.string()).default([]),
    read_only_scope: z.array(z.string()).default([]),
    allowed_shells: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
  }).passthrough(),
}).passthrough()

export const IREdgeSchema = z.object({
  id: z.string().regex(/^edg_/),
  source: z.string(),  // must be a blocks[].id — validated separately
  target: z.string(),  // must be a blocks[].id — validated separately
  type: z.enum(['sync', 'async', 'bidirectional']).default('sync'),
  label: z.string().nullable().default(null),
  semantics: z.string().nullable().default(null),
  code_anchors: z.unknown().nullable().default(null),
}).passthrough()

export const IRSchema = z.object({
  ir_version: z.string().regex(/^0\.1\./),
  project: z.object({
    name: z.string().min(1),
    root: z.string().min(1),
    created_at: z.string(),
    updated_at: z.string(),
    source_language: z.string().default('typescript'),
    frameworks: z.array(z.string()).default([]),
  }).passthrough(),
  seed_state: z.object({
    origin: z.enum(['import', 'design', 'blank', 'migration']),
    import_commit: z.string().nullable().default(null),
    ingest_version: z.string(),
  }).passthrough(),
  containers: z.array(IRContainerSchema),
  blocks: z.array(IRBlockSchema),
  edges: z.array(IREdgeSchema),
  policies: z.object({
    global_write_scope: z.array(z.string()).default([]),
    forbidden_imports: z.array(z.string()).default([]),
  }).passthrough(),
  audit_log: z.array(z.object({
    at: z.string(),
    actor: z.string(),
    action: z.enum(['import', 'edit', 'modify', 'build', 'deep_analyze']),
    commit: z.string().nullable().default(null),
    summary: z.string().default(''),
    diff_ref: z.string().nullable().default(null),
  }).passthrough()).default([]),
}).passthrough()

export type IR = z.infer<typeof IRSchema>
export type IRBlock = z.infer<typeof IRBlockSchema>
export type IRContainer = z.infer<typeof IRContainerSchema>
export type IREdge = z.infer<typeof IREdgeSchema>
export type IRCodeAnchors = z.infer<typeof IRCodeAnchorsSchema>

// Zod refinement: cross-field validation
export const IRRefinedSchema = IRSchema.superRefine((ir, ctx) => {
  const blockIds = new Set(ir.blocks.map(b => b.id))
  const containerIds = new Set(ir.containers.map(c => c.id))

  // block IDs unique
  const seenBlocks = new Set<string>()
  for (const b of ir.blocks) {
    if (seenBlocks.has(b.id)) ctx.addIssue({ code: 'custom', message: `Duplicate block id: ${b.id}` })
    seenBlocks.add(b.id)
  }

  // container_id must match a real container OR be null (orphan)
  for (const b of ir.blocks) {
    if (b.container_id !== null && !containerIds.has(b.container_id)) {
      ctx.addIssue({ code: 'custom', path: ['blocks', b.id, 'container_id'],
        message: `container_id "${b.container_id}" not found in containers` })
    }
  }

  // edge endpoints must be valid block IDs
  for (const e of ir.edges) {
    if (!blockIds.has(e.source)) {
      ctx.addIssue({ code: 'custom', path: ['edges', e.id, 'source'],
        message: `source "${e.source}" not in blocks` })
    }
    if (!blockIds.has(e.target)) {
      ctx.addIssue({ code: 'custom', path: ['edges', e.id, 'target'],
        message: `target "${e.target}" not in blocks` })
    }
  }

  // code_anchors integrity
  for (const b of ir.blocks) {
    const ca = b.code_anchors
    if (ca.primary_entry !== null && !ca.files.includes(ca.primary_entry)) {
      ctx.addIssue({ code: 'custom', path: ['blocks', b.id, 'code_anchors', 'primary_entry'],
        message: 'primary_entry must be in files' })
    }
    for (const sym of ca.symbols) {
      if (!ca.files.includes(sym.file)) {
        ctx.addIssue({ code: 'custom', path: ['blocks', b.id, 'code_anchors', 'symbols'],
          message: `symbol file "${sym.file}" not in files` })
      }
    }
  }
})

export function validateIr(raw: unknown): IR {
  return IRRefinedSchema.parse(raw)
}
```

---

## 8. Summary of Required Changes to IR-SCHEMA.md

1. **`irToSchemaDocument`** (lines 282-311): add orphan block collection and emit `UNGROUPED_CONTAINER` when `ir.blocks.some(b => b.container_id === null)`.

2. **Zod validation rule** (§8 of IR-SCHEMA.md): update the existing rule `blocks[].container_id must match some containers[].id or be null` — this is already stated correctly in the spec, confirming the data model is right and only the reverse path is broken.

3. **Hash ID note** (if Phase 2 introduces content hashing): document that `container_id` is excluded from hash input by design.

4. No changes needed to `schemaDocumentToIr` — it already handles orphans correctly via `container_id: c.id === 'ungrouped' ? null : prefixedId(c.id, 'cnt')`.
