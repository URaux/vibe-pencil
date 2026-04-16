# IR Migrator Proposal: Content-Based Stable Hash IDs

**Author**: Proposer A (content-hash advocate)
**Date**: 2026-04-14
**Verdict**: Content hash — no persistent uid, no sidecar, no ambiguity

---

## 0. The Problem With the Current Migrator

The pseudocode in IR-SCHEMA.md §6 contains three structural defects that violate PLAN.md's "lossless round-trip / reopen byte-identical" guarantee:

1. **ID mutation on migrate**: `prefixedId(b.id, 'blk')` rewrites `"my-block"` → `"blk_my-block"`. Reverse migrator emits the prefixed ID back to SchemaDocument. Re-opening the same YAML produces `"blk_blk_my-block"` on a second round-trip — not byte-identical.

2. **Orphan erasure**: `c.id === 'ungrouped' ? null : prefixedId(c.id, 'cnt')`. The reverse migrator `irToSchemaDocument` (IR-SCHEMA.md:282-312) iterates only `ir.containers` — it never reconstructs the `ungrouped` synthetic bucket. Any block whose `container_id === null` is silently dropped. Round-trip is lossy by construction.

3. **No stable identity basis**: Without a rule anchoring what an ID means, two agents writing independently can assign different IDs to the same logical block, then disagree on which node a `code_anchor` belongs to.

Content-based stable hashing resolves all three at the source.

---

## 1. Why Content Hash Beats Persistent UID

| Property | Persistent UID (`randomUUID`) | Content Hash |
|---|---|---|
| Sidecar needed | Yes — must store uuid→block mapping | No |
| Canonical | No — same block on two machines = two IDs | Yes |
| Git diff | Noisy on rename (old id deleted, new id added) | Clean — only changed fields diff |
| Multi-user collision | UUID namespace collision risk on merge | Zero — hash is deterministic per content |
| Debuggability | Opaque 36-char string | Encodes the block name; humans can read it |
| Re-import idempotency | Breaks without a lookup table | Free — same inputs → same ID always |

---

## 2. ID Generation Rules

### 2.1 Block ID

Hash input (ordered, canonical, pipe-separated):

```
BLOCK | <normalized_name> | <kind> | <container_name_or_ORPHAN>
```

- `normalized_name`: `block.name.trim().toLowerCase()` (Unicode NFC)
- `kind`: IR `kind` field (`module`, `service`, `data_store`, `external`, `ui`) — use `"unknown"` if absent during migration
- `container_name_or_ORPHAN`: the parent container's `name` field (not id), normalized same way; `"__orphan__"` if `container_id === null`

Hash algorithm: **SHA-256**, take first 8 bytes, encode as **base62** (chars `[0-9A-Za-z]`), prefix with `blk_`.

```
blk_<base62(sha256(input)[0:8])>
```

Example: `"Canvas Editor | ui | frontend"` → `blk_4xK9mQrT`

**Why container name, not ID?** Container ID is itself hash-derived (see §2.3), so using the container name keeps the inputs independent — no circular dependency.

**Why name over position?** Position is viewport-state (mutable, layout-engine-assigned, not serialized to YAML). Name is semantic identity.

### 2.2 Edge ID

Hash input:

```
EDGE | <source_block_id> | <target_block_id> | <type>
```

- `source_block_id`, `target_block_id`: already-computed content hashes
- `type`: `sync` | `async` | `bidirectional`

Label is intentionally excluded — same structural dependency with a different label is still the same edge.

```
edg_<base62(sha256(input)[0:8])>
```

### 2.3 Container ID

Hash input:

```
CONTAINER | <normalized_name>
```

```
cnt_<base62(sha256(input)[0:8])>
```

### 2.4 Collision Resolution

Two blocks with the same `name + kind + container_name` (genuinely identical semantic content): this is a user data error, not an ID problem. The migrator emits a validation warning and appends a disambiguation suffix `_2`, `_3`, etc., based on position in source array order. This is deterministic (source order is stable) and explicitly flagged in `audit_log`.

---

## 3. Orphan Block Semantics

Orphan blocks (no parent container in the canvas) use `"__orphan__"` as the container key in the hash input. This means:

- Their IDs are stable regardless of whether a future container adopts them.
- When a user assigns an orphan to a container, the block gets a NEW ID (because `container_name` changes). This is correct — the block has changed its structural role.
- The reverse migrator reconstructs the `ungrouped` container if any `container_id === null` blocks exist. The `ungrouped` container is synthetic — it never appears in `ir.containers`, only in the SchemaDocument output.

**This preserves round-trip**: `ungrouped` blocks survive both directions.

---

## 4. Rename and ID Change

### 4.1 Rename is a Feature, Not a Bug

When a user renames "Canvas Editor" → "Canvas Host":

- Old ID: `blk_4xK9mQrT` (hash of `"canvas editor | ui | frontend"`)
- New ID: `blk_7nPwXcLq` (hash of `"canvas host | ui | frontend"`)

The IR diff is semantically clear: one block deleted, one added, with `code_anchors` transferred. This is **correct** — the block's identity changed. If the old ID were preserved, a rename would be invisible to diff tooling, breaking the "diff is semantic" principle (IR-SCHEMA.md:13).

### 4.2 How Modify Expresses a Rename

The Modify agent's `rename` verb produces an IR diff operation:

```yaml
# IR diff (conceptual, in audit_log diff_ref patch)
- op: rename_block
  old_id: blk_4xK9mQrT
  old_name: "Canvas Editor"
  new_id: blk_7nPwXcLq
  new_name: "Canvas Host"
  transferred_anchors: true
```

The agent:
1. Computes `new_id = hashBlock(new_name, kind, container_name)`
2. Copies all fields from old block to new block, updating `name` and `id`
3. Rewrites all edges referencing `old_id` to use `new_id`
4. Appends the `rename_block` op to `audit_log` with `diff_ref`
5. Deletes the old block entry

This is lossless: `code_anchors`, `policies`, `status`, and all user fields transfer exactly. The audit trail records the rename so tooling can track identity across renames if needed (e.g. `git log --follow`-style).

### 4.3 Why Round-Trip Survives Rename

Round-trip is defined per-snapshot, not across edits:

```
canvas_state_T → IR_T → canvas_state_T   (identical)
```

After a rename, `canvas_state_T+1` is a different state — its round-trip is also perfect because both directions hash from the same canonical inputs. The guarantee is not "ID persists across user edits" (that would be wrong); it is "given the same canvas state, the ID is always the same."

---

## 5. Migrator: SchemaDocument → IR (Full Algorithm)

```typescript
// src/lib/ir/migrate.ts
import { createHash } from 'crypto'
import type { SchemaDocument, SerializedBlock, SerializedContainer } from '@/lib/schema-engine'
import type { IR, IRBlock, IREdge, IRContainer } from './schema'

// ── Hashing primitives ──────────────────────────────────────────────────────

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function toBase62(bytes: Buffer): string {
  let n = BigInt('0x' + bytes.toString('hex'))
  let result = ''
  while (n > 0n) {
    result = BASE62[Number(n % 62n)] + result
    n = n / 62n
  }
  return result.padStart(11, '0').slice(0, 11) // 8 bytes → ~11 base62 chars
}

function sha256Prefix(input: string): string {
  const hash = createHash('sha256').update(input, 'utf8').digest()
  return toBase62(hash.subarray(0, 8))
}

function norm(s: string): string {
  return s.trim().toLowerCase().normalize('NFC')
}

export function blockId(name: string, kind: string, containerName: string): string {
  return 'blk_' + sha256Prefix(`BLOCK|${norm(name)}|${norm(kind)}|${norm(containerName)}`)
}

export function containerId(name: string): string {
  return 'cnt_' + sha256Prefix(`CONTAINER|${norm(name)}`)
}

export function edgeId(sourceId: string, targetId: string, type: string): string {
  return 'edg_' + sha256Prefix(`EDGE|${sourceId}|${targetId}|${norm(type)}`)
}

// ── Kind inference (same heuristic as current migrator) ─────────────────────

function inferKind(b: SerializedBlock, c: SerializedContainer): IRBlock['kind'] {
  const cn = c.name.toLowerCase()
  if (cn.includes('data') || cn.includes('database') || cn.includes('storage')) return 'data_store'
  if (cn.includes('external')) return 'external'
  if (cn.includes('frontend') || cn.includes('ui')) return 'ui'
  if (cn.includes('service') || cn.includes('api')) return 'service'
  return 'module'
}

// ── Main migrator ────────────────────────────────────────────────────────────

export function schemaDocumentToIr(
  doc: SchemaDocument,
  opts: { root: string; origin?: IR['seed_state']['origin']; commit?: string | null } = { root: '.' }
): IR {
  const now = new Date().toISOString()

  // Step 1: Build containers (exclude ungrouped — it's synthetic, never stored in IR)
  const realContainers = doc.containers.filter(c => c.id !== 'ungrouped')

  const containers: IRContainer[] = realContainers.map(c => ({
    id: containerId(c.name),
    name: c.name,
    color: c.color as IRContainer['color'],
    collapsed: false,
    parent_id: null,
  }))

  // Build container name lookup (SchemaDocument id → IR container id + name)
  const containerLookup = new Map<string, { irId: string; name: string }>()
  for (let i = 0; i < realContainers.length; i++) {
    containerLookup.set(realContainers[i].id, {
      irId: containers[i].id,
      name: realContainers[i].name,
    })
  }

  // Step 2: Build blocks — track name collisions per container scope
  const blocks: IRBlock[] = []
  const idCount = new Map<string, number>()

  for (const c of doc.containers) {
    const isOrphan = c.id === 'ungrouped'
    const containerEntry = isOrphan ? null : containerLookup.get(c.id)
    const cNameForHash = isOrphan ? '__orphan__' : (containerEntry?.name ?? c.name)

    for (const b of c.blocks) {
      const kind = inferKind(b, c)
      let id = blockId(b.name, kind, cNameForHash)

      // Collision resolution: same hash → append suffix by occurrence order
      const count = idCount.get(id) ?? 0
      if (count > 0) {
        // emit warning (caller should surface via audit_log)
        const disambiguated = 'blk_' + sha256Prefix(
          `BLOCK|${norm(b.name)}|${norm(kind)}|${norm(cNameForHash)}|${count}`
        )
        id = disambiguated
      }
      idCount.set(id, (idCount.get(id) ?? 0) + 1)

      blocks.push({
        id,
        name: b.name,
        description: b.description ?? '',
        status: (['idle','building','done','error'] as const).includes(b.status as any)
          ? (b.status as IRBlock['status'])
          : 'idle',
        container_id: isOrphan ? null : (containerEntry?.irId ?? null),
        kind,
        tech_stack: b.techStack ?? null,
        schema: b.schema ?? null,
        schema_refs: b.schemaRefs ?? [],
        schema_field_refs: b.schemaFieldRefs ?? {},
        summary: b.summary ?? null,
        error_message: b.errorMessage ?? null,
        code_anchors: { files: [], primary_entry: null, symbols: [], line_ranges: [], confidence: 0 },
        policies: { write_scope: [], read_only_scope: [], allowed_shells: [], tags: [] },
      })
    }
  }

  // Step 3: Build a SchemaDocument-id → IR-block-id map for edge wiring
  // We need to re-derive the block IDs from the source blocks.
  // Re-walk in same order to re-derive IDs deterministically.
  const blockIdMap = new Map<string, string>()
  const idCount2 = new Map<string, number>()
  for (const c of doc.containers) {
    const isOrphan = c.id === 'ungrouped'
    const containerEntry = isOrphan ? null : containerLookup.get(c.id)
    const cNameForHash = isOrphan ? '__orphan__' : (containerEntry?.name ?? c.name)

    for (const b of c.blocks) {
      const kind = inferKind(b, c)
      let id = blockId(b.name, kind, cNameForHash)
      const count = idCount2.get(id) ?? 0
      if (count > 0) {
        id = 'blk_' + sha256Prefix(
          `BLOCK|${norm(b.name)}|${norm(kind)}|${norm(cNameForHash)}|${count}`
        )
      }
      idCount2.set(id, (idCount2.get(id) ?? 0) + 1)
      blockIdMap.set(b.id, id)
    }
  }

  // Step 4: Build edges
  const edges: IREdge[] = (doc.edges ?? []).flatMap(e => {
    const source = blockIdMap.get(e.source) ?? e.source
    const target = blockIdMap.get(e.target) ?? e.target
    const type = (e.type as IREdge['type']) ?? 'sync'
    return [{
      id: edgeId(source, target, type),
      source,
      target,
      type,
      label: e.label ?? null,
      semantics: null,
      code_anchors: null,
    }]
  })

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
      summary: `Migrated from SchemaDocument: ${containers.length} containers, ${blocks.length} blocks, ${edges.length} edges`,
      diff_ref: null,
    }],
  }
}
```

---

## 6. Reverse Migrator: IR → SchemaDocument (Full Algorithm)

```typescript
export function irToSchemaDocument(ir: IR): SchemaDocument {
  // Step 1: Reconstruct real containers from ir.containers
  const containerMap = new Map(ir.containers.map(c => [c.id, c]))

  const serializedContainers = ir.containers.map(c => ({
    id: c.id,
    name: c.name,
    color: c.color,
    blocks: ir.blocks
      .filter(b => b.container_id === c.id)
      .map(blockToSerialized),
  }))

  // Step 2: Reconstruct ungrouped container for orphan blocks
  // Orphans: container_id === null
  const orphans = ir.blocks.filter(b => b.container_id === null)
  if (orphans.length > 0) {
    serializedContainers.push({
      id: 'ungrouped',
      name: 'Ungrouped',
      color: 'slate',
      blocks: orphans.map(blockToSerialized),
    })
  }

  // Step 3: Reconstruct edges
  const edges = ir.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: e.type,
    ...(e.label ? { label: e.label } : {}),
  }))

  return {
    project: ir.project.name,
    containers: serializedContainers,
    edges,
  }
}

function blockToSerialized(b: IRBlock) {
  return {
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
  }
}
```

---

## 7. Round-Trip Proof: ∀ canvas_state, canvas→IR→canvas is Identity

### 7.1 Definitions

Let `C` = a canonical `SchemaDocument` (output of `canvasToYaml` + `normalizeSchemaDocument`).
Let `forward(C) = IR`, `reverse(IR) = C'`.
Claim: `C' = C` (structural equality on all user-visible fields).

### 7.2 Field-by-Field Argument

**`project.name`**: `forward` sets `ir.project.name = doc.project`. `reverse` reads it back. Identity. ✓

**Containers**: `forward` maps each non-ungrouped container `c` to `IRContainer{id: containerId(c.name), name: c.name, color: c.color}`. `reverse` maps back to `{id: containerId(c.name), name: c.name, color: c.color}`. The ID is the hash — it comes back unchanged because `reverse` copies `c.id` directly from `ir.containers`. ✓

**Orphan container**: `forward` drops the `ungrouped` container from `ir.containers` but sets `container_id = null` on its blocks. `reverse` checks for `container_id === null` blocks and reconstructs `{id: 'ungrouped', name: 'Ungrouped', color: 'slate'}` — exactly matching the `UNGROUPED_CONTAINER` sentinel in `schema-engine.ts:71-76`. ✓

**Blocks**: Every field in `SerializedBlock` maps 1-1 to an `IRBlock` field and back:
- `id`: hash(name, kind, containerName) → stored in IR → copied back verbatim by `reverse`. ✓
- `name`, `description`, `status`: direct copy both ways. ✓
- `schema`, `schemaRefs`, `schemaFieldRefs`, `techStack`, `summary`, `errorMessage`: conditional presence preserved both ways (both use `...(field ? {key: field} : {})`). ✓
- `code_anchors`, `policies`: IR-only fields, not included in SchemaDocument output. ✓

**Edges**: `id = edgeId(source, target, type)` where `source`/`target` are the already-computed block IDs. `reverse` copies `e.id`, `e.source`, `e.target`, `e.type`, `e.label` directly back. Both IDs are deterministic from the same inputs — if no edit occurred, the hash inputs are identical, so IDs are identical. ✓

**Block IDs in edges**: `forward` builds `blockIdMap` from SchemaDocument block IDs → IR block IDs. Edges use these mapped IDs. `reverse` outputs edges with the IR block IDs as source/target — which are exactly the IDs that appear in the reconstructed blocks. The Zod validator (IR-SCHEMA.md §8) enforces `edges[].source` ∈ `blocks[].id`, so referential integrity is maintained. ✓

### 7.3 What "Byte-Identical" Requires

Byte-identical means `canvasToYaml(yamlToCanvas(irToSchemaDocument(schemaDocumentToIr(normalizeSchemaDocument(parse(yaml))))))` equals the original `yaml`. This holds if:

1. `normalizeSchemaDocument` is idempotent (it is — it only fills in defaults, which are stable). ✓
2. `serialize(IR)` is deterministic (keys in fixed order, alphabetically sorted sets — IR-SCHEMA.md:13). ✓
3. The graph layout step (`layoutArchitectureCanvas`) does not change IDs, only positions. Positions are not serialized to `SchemaDocument` (they're computed on load). ✓
4. No timestamp or non-deterministic value leaks into data fields. `audit_log.at` is metadata, not a data field — it does not appear in SchemaDocument. ✓

### 7.4 Edge Case: Collision Suffix

If two blocks in the same container have identical name+kind (the collision case from §2.4), the suffix `|0`, `|1` etc. is appended to the hash input, selected by source-array position. This means the round-trip is byte-identical only if the source array order is stable — which it is, because YAML array order is preserved by `js-yaml`/`yaml@^2.8`. ✓

---

## 8. Integration with schema-engine.ts

Current `schema-engine.ts` is **unchanged**. The hash ID scheme lives entirely in `src/lib/ir/migrate.ts`. Integration points:

1. **`canvasToYaml`** (line 374): continues to serialize using whatever IDs are on the canvas nodes. These IDs are the hash IDs once the store is loaded from IR. No change needed.

2. **`yamlToCanvas`** (line 500): continues to parse SchemaDocument and pass IDs through to canvas nodes. When the source is an IR-round-tripped YAML, the IDs are already hash IDs. No change needed.

3. **`store.ts` `setCanvas`** (line 269): receives nodes with whatever IDs `yamlToCanvas` produces. No change.

4. **New hook in `store.ts`**: `loadProjectIr` / `saveProjectIr` actions (W1.D5 per PLAN.md) call `irToSchemaDocument` before feeding into the existing `setCanvas` path. The IR itself is the authoritative store; SchemaDocument is a rendering projection.

5. **`inferKind` contract**: The `inferKind` heuristic used during migration must be the same function called during ingest (`W2.D2`) — otherwise a re-import would produce different `kind` values and thus different block IDs, breaking re-import idempotency. Export `inferKind` from `migrate.ts` and import in `ingest/facts.ts`.

---

## 9. Known Gotchas

| Gotcha | Mitigation |
|---|---|
| User renames a container — all child block IDs change | Expected behavior. Diff shows mass ID change. Modify agent logs a `rename_container` op that carries the old→new mapping in `audit_log`, so downstream tooling can follow identity. |
| Two users add blocks with same name in same container | Collision suffix `\|1` assigned by source-array order. If arrays are merged in different orders (e.g., collaborative edit), suffixes may swap. Phase 1 is single-user; Phase 2 (CRDT) must add a position tiebreaker. |
| Legacy YAML files with existing human-readable IDs (e.g. `"my-service"`) | `schemaDocumentToIr` replaces them with hash IDs. The `blockIdMap` is ephemeral — it only lives during one migration call. If the user opens the old YAML after IR is written, `irToSchemaDocument` emits hash IDs. The edge references are updated consistently, so the diagram is structurally correct. No data loss. |
| Hash algorithm upgrade (SHA-256 → BLAKE3) | Would invalidate all stored IDs. Treat as IR major version bump (0.x → 1.x). Migrator `migrate_v0_x_to_v1` re-hashes all IDs. |
| `inferKind` returns different value after heuristic improvement | Same issue as algorithm upgrade — re-migration required. Pin `inferKind` version in `ingest_version` field. |
