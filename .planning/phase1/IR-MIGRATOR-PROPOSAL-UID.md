# IR Migrator Proposal — Persistent UID Strategy

**Author**: Proposer B (persistent uid + sidecar mapping)
**Status**: Design proposal — counter to content-hash approach
**Date**: 2026-04-14

---

## Verdict

**Persistent uid wins.** Every node gets one uid at creation, forever.
Content hash is not an identity — it is a fingerprint. Fingerprints change on rename.

---

## 1. uid Algorithm Selection

### cuid2 vs nanoid

| Criterion | cuid2 (`@paralleldrive/cuid2`) | nanoid (`nanoid`) |
|---|---|---|
| Length | 24 chars (default) | 21 chars (default) |
| Collision resistance | 2^122, monotonically friendly | ~UUID-level (2^126) |
| Sort-friendly | Yes — time-ordered prefix | No — pure random |
| Browser-safe | Yes | Yes |
| Node-safe | Yes | Yes |
| Bundle size | ~2 KB gz | ~1 KB gz |
| Alphabet | `a-z0-9` only — YAML-safe, no quoting needed | `A-Za-z0-9_-` — also safe but mixed case |
| Already in project | No | Effectively yes — @xyflow uses nanoid-style IDs, existing `node.id` values are nanoid |

**Decision: nanoid.** The existing `Node<CanvasNodeData>.id` values from Zustand/xyflow are already nanoid-style (e.g., `dXp4kE9mQ1r`). Introducing cuid2 would create a heterogeneous corpus of ID formats in YAML the moment any legacy project is round-tripped. Consistency beats marginal sort-friendliness — we are not sorting by ID, we are querying by it.

Use `nanoid(21)` from the existing `nanoid` package (already a transitive dep via xyflow). No new dependency.

**Exception**: IR containers use the existing human-readable convention (`cnt_frontend`) because containers are user-named and low-cardinality. Blocks and edges always get nanoid uids.

---

## 2. uid Assignment Rules

### When is a uid assigned?

| Event | uid lifecycle |
|---|---|
| User drags a new block onto canvas | `nanoid(21)` generated in `addNode()` action in `store.ts` — **before** any save |
| Block imported from SchemaDocument (first IR migration) | Keep the existing `block.id` if it is already a valid non-empty string. Do NOT rewrite. |
| Block imported from legacy YAML (normalizeLegacyDocument path) | Existing fallback IDs (`${group}-${index+1}`) are preserved as-is. They are stable within that document. |
| Block produced by ingest pipeline (new cluster) | `nanoid(21)` generated in `cluster.ts` at cluster-assignment time. Stored in IR immediately. |
| Edge created | `nanoid(21)` in `addCanvasEdge()` — already the current behavior. |

**Rule**: uid is assigned exactly once, at the moment of node creation. It never changes.

### Where is uid stored?

```
Zustand:  node.id                      (already exists — Node<CanvasNodeData>.id)
IR YAML:  blocks[].id / edges[].id     (direct field, no transformation)
YAML file: .archviber/ir.yaml          (serialized as-is)
```

No prefix transformation in the migrator. The `prefixedId()` function in the current IR-SCHEMA.md §6 pseudocode **is the problem** — it rewrites IDs. Remove it entirely.

---

## 3. Orphan Node Semantics

Orphan blocks (blocks with no parent container) are a first-class IR entity. They are NOT dropped, NOT merged into a synthetic bucket, and their uid is NOT affected by their orphan status.

```yaml
blocks:
  - id: "dXp4kE9mQ1r"       # persistent uid, regardless of parent
    name: "Legacy Auth Module"
    container_id: null        # null = orphan. Explicit, not absent.
    ...
```

The current IR-SCHEMA.md §6 migrator silently drops the `ungrouped` container and sets `container_id: null`. That part is correct. What must NOT happen: assigning a new uid because the node is ungrouped. The uid is independent of topology.

**Zod validator** must accept `container_id: null` without error. This is already specified in IR-SCHEMA §8 ("must match some containers[].id or be null") — confirmed compatible.

---

## 4. Rename and Move Stability

### Rename scenario

```
Before: block id="dXp4kE9mQ1r", name="AuthService"
User renames to: "AuthModule"
After:  block id="dXp4kE9mQ1r", name="AuthModule"
```

Git diff:
```diff
-    name: "AuthService"
+    name: "AuthModule"
```

One line changed. The uid is unchanged. No downstream reference (edges, code_anchors, audit_log) needs updating. Contrast with content-hash: rename = new hash = edge source/target references all break = cascade rewrite.

### Move scenario (block changes container)

```
Before: block id="dXp4kE9mQ1r", container_id: "cnt_frontend"
User moves to backend container
After:  block id="dXp4kE9mQ1r", container_id: "cnt_backend"
```

Git diff:
```diff
-    container_id: "cnt_frontend"
+    container_id: "cnt_backend"
```

One line changed. uid unchanged. This is the core claim: **a move is a single field change**, not a delete + insert. Git history is continuous across structural refactors.

---

## 5. Migrator: SchemaDocument → IR (corrected pseudocode)

The critical fix vs. IR-SCHEMA.md §6: **remove `prefixedId()`**. IDs pass through unmodified.

```typescript
// src/lib/ir/migrate.ts
import { nanoid } from 'nanoid'
import type { SchemaDocument, SerializedBlock } from '@/lib/schema-engine'
import type { IR, IRBlock, IREdge, IRContainer } from './schema'

export function schemaDocumentToIr(
  doc: SchemaDocument,
  opts: { root: string; origin?: IR['seed_state']['origin']; commit?: string | null }
): IR {
  const now = new Date().toISOString()

  // Pass IDs through unchanged. Do not prefix, do not slugify.
  const containers: IRContainer[] = doc.containers
    .filter(c => c.id !== 'ungrouped')   // ungrouped is synthetic; orphans go via container_id: null
    .map(c => ({
      id: c.id,                          // <-- transparent passthrough
      name: c.name,
      color: c.color as IRContainer['color'],
      collapsed: false,
      parent_id: null,
    }))

  const containerIds = new Set(containers.map(c => c.id))

  const blocks: IRBlock[] = doc.containers.flatMap(c =>
    c.blocks.map((b: SerializedBlock) => ({
      id: b.id,                          // <-- transparent passthrough
      name: b.name,
      description: b.description ?? '',
      status: (['idle','building','done','error'] as const).includes(b.status as any)
        ? b.status as IRBlock['status']
        : 'idle',
      container_id: (c.id === 'ungrouped' || !containerIds.has(c.id))
        ? null                           // preserve orphan semantic
        : c.id,                          // direct container ref — no prefix rewrite
      kind: inferKind(b, c),
      tech_stack: b.techStack ?? null,
      schema: b.schema ?? null,
      schema_refs: b.schemaRefs ?? [],
      schema_field_refs: b.schemaFieldRefs ?? {},
      summary: b.summary ?? null,
      error_message: b.errorMessage ?? null,
      code_anchors: { files: [], primary_entry: null, symbols: [], line_ranges: [], confidence: 0 },
      policies: { write_scope: [], read_only_scope: [], allowed_shells: [], tags: [] },
    }))
  )

  const edges: IREdge[] = (doc.edges ?? []).map(e => ({
    id: e.id,                            // <-- transparent passthrough
    source: e.source,                    // <-- no prefix rewrite; edge already refs block id
    target: e.target,
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
      source_language: 'typescript',
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
    audit_log: [{
      at: now,
      actor: 'migrator@0.1.0',
      action: 'import',
      commit: opts.commit ?? null,
      summary: `Migrated: ${containers.length} containers, ${blocks.length} blocks, ${edges.length} edges`,
      diff_ref: null,
    }],
  }
}
```

---

## 6. Reverse Migrator: IR → SchemaDocument (corrected pseudocode)

The current IR-SCHEMA.md §6 reverse is almost correct — it already passes `c.id` and `b.id` through. The only fix needed is handling orphan blocks (container_id: null), which the current reverse silently drops.

```typescript
export function irToSchemaDocument(ir: IR): SchemaDocument {
  // Reconstruct the synthetic ungrouped container if orphans exist
  const orphanBlocks = ir.blocks.filter(b => b.container_id === null)

  const containers = ir.containers.map(c => ({
    id: c.id,
    name: c.name,
    color: c.color,
    blocks: ir.blocks
      .filter(b => b.container_id === c.id)
      .map(b => ({
        id: b.id,                        // uid passes back unchanged
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
  }))

  // Re-emit ungrouped container only if orphans exist — preserves yamlToCanvas compat
  if (orphanBlocks.length > 0) {
    containers.push({
      id: 'ungrouped',
      name: 'Ungrouped',
      color: 'slate',
      blocks: orphanBlocks.map(b => ({
        id: b.id,
        name: b.name,
        description: b.description,
        status: b.status,
        ...(b.schema ? { schema: b.schema } : {}),
        ...(b.tech_stack ? { techStack: b.tech_stack } : {}),
        ...(b.summary ? { summary: b.summary } : {}),
        ...(b.error_message ? { errorMessage: b.error_message } : {}),
      })),
    })
  }

  return {
    project: ir.project.name,
    containers,
    edges: ir.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      ...(e.label ? { label: e.label } : {}),
    })),
  }
}
```

---

## 7. Round-Trip Proof

**Claim**: `irToSchemaDocument(schemaDocumentToIr(doc))` is deep-equal to `doc` for any valid SchemaDocument.

**Proof sketch**:

1. `schemaDocumentToIr(doc)`:
   - `containers`: each `c.id → c.id`, `c.name → c.name`, `c.color → c.color` (lossless)
   - `blocks`: each `b.id → b.id`, all optional fields spread with null-coalescing (lossless for non-null values)
   - `ungrouped` container filtered out; its blocks get `container_id: null` in IR
   - `edges`: each `e.id → e.id`, `e.source → e.source`, `e.target → e.target` (lossless)

2. `irToSchemaDocument(ir)`:
   - Containers re-emitted from `ir.containers` — same ids and fields
   - Blocks re-distributed by `container_id` match — same grouping
   - `ungrouped` synthetic container re-constructed from `container_id: null` blocks
   - Edges re-emitted from `ir.edges` — same ids, source, target

3. Fields only present in SchemaDocument and absent in IR (`BlockNodeData.position`, etc.) are not part of SchemaDocument — SchemaDocument itself does not store positions. ✓

4. The only field IR adds that SchemaDocument lacks is `code_anchors` + IR metadata — these are stripped in the reverse pass by construction. ✓

**Byte-identical** on the YAML level requires deterministic serialization (fixed key order, stable sort). The `serializeIr` function in `src/lib/ir/serialize.ts` must emit blocks in stable order (sort by `id` lexicographically). With uid passthrough, IDs do not change between runs, so sort order is stable across round-trips. ✓

**Failure case in current IR-SCHEMA.md §6**: `prefixedId("canvas-editor", "blk")` → `"blk_canvas_editor"`. Then `irToSchemaDocument` emits `id: "blk_canvas-editor"`. Edge references `source: "blk_canvas-editor"`. But original `SchemaDocument` had `source: "canvas-editor"`. **Round-trip broken.** This is the concrete evidence the prefix rewrite is wrong.

---

## 8. Compatibility with Existing Zustand node.id

`store.ts` creates nodes via `addNode(node: Node<CanvasNodeData>)`. The `node.id` is set by the caller — typically by canvas interaction code that calls `nanoid()` or is assigned from schema load.

In `yamlToCanvas` → `buildBlockNode(block, containerId)`: `id: block.id`. The id comes directly from the YAML. With uid passthrough in the migrator, this chain is:

```
ir.yaml block.id
  → irToSchemaDocument → SerializedBlock.id
  → yamlToCanvas → buildBlockNode → Node<CanvasNodeData>.id
  → Zustand store node.id
```

Every step passes the id through unchanged. The Zustand store never generates a new id for loaded nodes — it only generates ids for newly created nodes (which is correct: new creation = new uid assignment).

**No store.ts changes required.** The existing `addNode` pattern is compatible.

---

## 9. Sidecar Mapping — Do We Need It?

Sidecar mapping = a separate file recording `{uid → [historical_uids, parent_history]}` for lineage tracking.

**Phase 1 verdict: Not needed. Phase 2: Optional.**

Reasoning:
- The primary Phase 1 use case is rename + single-hop move. Uid stability alone makes git diff clean and round-trip lossless. No extra tracking needed.
- Code anchors are re-derived from AST on every ingest — they do not depend on parent lineage.
- The Modify agent's PR generator traces changes through git diff, not through a uid sidecar.

**Phase 2 scenario where sidecar adds value**: when implementing CRDT collaborative editing (team scenario), you need vector clocks and tombstoning. At that point, a sidecar `uid-lineage.yaml` under `.archviber/` makes sense:

```yaml
# .archviber/uid-lineage.yaml  (Phase 2 only)
lineage:
  - uid: "dXp4kE9mQ1r"
    born_at: "2026-04-14T10:00:00Z"
    moves:
      - at: "2026-04-16T09:00:00Z"
        from_container: "cnt_frontend"
        to_container: "cnt_backend"
        actor: "user"
```

This file does NOT affect Phase 1 correctness. Pre-place an empty `uid-lineage.yaml` stub if desired, but do not implement the handler.

---

## 10. New Node uid Generation — Timing and Persistence

```
1. User drops node on canvas
   ↓
2. canvas interaction handler calls store.addNode({
     id: nanoid(21),       ← uid assigned HERE, synchronously, in the browser
     type: 'block',
     ...
   })
   ↓
3. Zustand state updated — node.id is now the persistent uid
   ↓
4. useAutoSave fires (debounced 500ms) → canvasToYaml → SchemaDocument with block.id = uid
   ↓
5. PUT /api/project/ir → schemaDocumentToIr → block.id passed through → ir.yaml written
   ↓
6. uid is now persisted on disk. Survives reload.
```

**Invariant**: uid is assigned before the first save, and never reassigned. If a save fails, the node is in Zustand with a uid that will be used on the next successful save. No regeneration occurs on reload.

**Ingest-generated nodes** (from clustering pipeline): uid assigned in `cluster.ts` at cluster resolution time, stored in IR directly. These nodes never go through `nanoid()` in the browser — the ingest pipeline owns their uid assignment. This is safe because ingest is deterministic per git commit (seeded Louvain, as specified in PLAN.md §3 W2.D3 mitigation).

---

## 11. Git Diff Behavior Summary

| Operation | Content-hash approach | Persistent uid approach |
|---|---|---|
| Rename block name | ID changes → edge refs break → cascade diff | ID stable → 1-line diff |
| Move block to new container | ID might change (if hash includes parent) → cascade | `container_id` field change → 1-line diff |
| Edit block description | Hash changes → appears as delete+insert | ID stable → 1-line diff |
| Add new block | New ID (correct) | New nanoid (correct) |
| Delete block | ID removed, edge refs removed | Same |
| No-op round-trip | Non-deterministic diff if hash changes | Zero diff (uid stable + deterministic serialize) |

The persistent uid approach produces **semantically meaningful diffs**: every change in the diff corresponds to a real user intent. Content-hash diffs conflate identity change with content change.

---

## 12. Known Gotchas

1. **Legacy IDs are not nanoid format** — existing YAML files have IDs like `canvas-editor`, `store`, `legacy-services-1`. These are preserved as-is. They will not sort the same way as nanoid IDs. Mitigation: sorting in `serializeIr` is by current id value — it is stable across round-trips for any given document. Mixed formats are ugly but functional.

2. **prefixedId removal breaks IR-SCHEMA.md §8 Zod rule** — the validator currently has no format constraint on `blocks[].id` beyond "unique non-empty string". No change needed to the Zod schema.

3. **Ingest re-runs must be idempotent on uids** — if the ingest pipeline re-runs on an already-ingested project, it must detect existing IR and preserve existing uids rather than generating new nanoids. Strategy: `loadIr()` first; if a block with matching `code_anchors.primary_entry` already exists, reuse its uid. Only assign new nanoid for genuinely new clusters.

4. **cuid2 rejected** — if a future contributor argues for cuid2 for sort-friendliness, the counter-argument is: we do not paginate or range-query by uid. Sort-friendliness provides no benefit in this system.

5. **Phase 2 uid collision across merged projects** — if two separately-imported projects are merged into one diagram, nanoid collision probability is negligible (2^126 space, 21 chars) but non-zero. Mitigation: on merge, validate uniqueness and reassign only colliding uids (expected: 0 in practice).
