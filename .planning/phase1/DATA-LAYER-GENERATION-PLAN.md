# Data-Layer Generation Plan
**Date**: 2026-04-17
**Scope**: Phase 1 planning only
**Status**: draft for implementation planning
**Boundaries**:
- This plan is for the data-layer schema generator slice.
- It is not a rewrite of the canvas chat pipeline.
- It is not part of the W2 four-layer ingest pipeline (`tree-sitter -> Louvain -> LLM naming -> ELK`).
- It does not propose edits under `src/` in this document.
- It assumes the current Phase 1 architecture/chat stack remains in place and is incrementally hardened.
**Source set used for this plan**: archive baseline `E:/edgedownload/可分享个人知识库-archive.json`; current generation path in `src/app/api/chat/route.ts`, `src/lib/context-engine.ts`, `src/lib/skill-loader.ts`, `src/lib/cc-native-scaffold.ts`, `src/hooks/useCanvasActions.ts`, `src/lib/store.ts`, `src/lib/schema-linter.ts`, `src/lib/types.ts`, `src/lib/ir/schema.ts`; planning style references in `.planning/phase1/PLAN.md`, `.planning/phase1/IR-SCHEMA.md`, `.planning/phase1/SESSION-HANDOFF-2026-04-15-evening.md`.
**Verified archive anchors used below**: `canvas.nodes[13]` = `postgresql-pgvector`; `canvas.nodes[14]` = DashScope `text-embedding-v3` embedding node; `chatSessions[1].messages[7]` = converged simple pgvector scope; `chatSessions[4].messages[7]` = expanded source scope; `chatSessions[4].messages[13-15]` = `Postgres + Qdrant + 对象存储` follow-up.
**Important grounding note**: schema defects are verified directly from `canvas.nodes[13]`; expanded-scope and embedding-model context are verified from the other archive anchors above; I did not find a literal `Grade: C` string inside the JSON, so that label remains review context rather than independently verified archive content.
## 1. Problem statement
The current generator can produce a visually plausible data-layer block, but it still behaves like a one-shot text completion step instead of a schema-generation pipeline.
The baseline `postgresql-pgvector` node in the archive makes that visible.
I am calling out three concrete failure modes that are true **today** and are directly evidenced by the archived node itself.
### 1.1 Failure mode A: integrity and access-path fundamentals are optional today
- Evidence: `canvas.nodes[13].data.schema.tables` contains `note_tags` with exactly two columns, `note_id` and `tag_id`, both marked only as `FK鈫?..`, and no PK or UNIQUE constraint is present anywhere on that table.
- Evidence: the same node defines five tables (`notes`, `tags`, `note_tags`, `embeddings`, `shares`) and none of the table objects include an `indexes` array.
- Consequence: duplicate junction rows are representable, foreign-key joins are unindexed by default, and lookup/index policy is entirely left to the model's whim.
- Why this matters in ArchViber: the current apply path accepts the blob as-is, so a structurally weak schema can become the canvas source of truth without a hard stop.
### 1.2 Failure mode B: the source/content model is underspecified relative to the workload
- Evidence: in `notes`, source provenance is modeled only as `source_type` and `source_url`.
- Evidence: `notes.source_type` has a `CHECK` constraint but is not marked `NOT NULL`.
- Evidence: `notes.source_url` is just `text` with no companion fields for source identity, import status, normalization, content type, object key, transcript linkage, or parser metadata.
- Evidence: `embeddings` stores `note_id`, `chunk_text`, `vector(1536)`, and `created_at`, but it has no `chunk_index`, `chunk_start`, or `chunk_end`.
- Consequence: the schema cannot reliably preserve provenance for heterogeneous imports, and the embedding rows cannot be traced back to chunk order or offsets.
- Why this matters in ArchViber: the brainstorm flow already captures source variety, but the generator has no structured handoff from those requirements into schema fields.
### 1.3 Failure mode C: sharing/public access is modeled as a static token row, not a lifecycle
- Evidence: `shares` contains `id`, `note_id`, `token`, `password_hash`, `expires_at`, and `created_at`.
- Evidence: `shares` has no `revoked_at`.
- Evidence: `shares` has no access-state field, no `last_accessed_at`, and no audit columns beyond `created_at`.
- Consequence: the design can create password-protected links but has no first-class representation for revocation, re-issue, or last-use tracking.
- Why this matters in ArchViber: public/share capabilities are common enough in brainstorm outcomes that this needs to be boilerplate, not an optional flourish.
### 1.4 Archive-backed secondary observations
- The `tags` table is flat in the archived node: it only has `id` and `name`.
- `tags is flat` is therefore verified, but I could not independently verify from the same session that hierarchical directories were explicitly required there; treat that part as upstream requirement context unless re-verified.
- The archived `embeddings.vector` type is hardcoded to `vector(1536)` even though `canvas.nodes[14]` identifies the embedding model as DashScope `text-embedding-v3`.
- The archive also confirms the larger scope mismatch: `chatSessions[1].messages[7]` converges on a compact pgvector design, while `chatSessions[4].messages[7]` and `chatSessions[4].messages[13-15]` converge on webpages/PDF/video/RSS plus `Postgres + Qdrant + 对象存储`.
### 1.5 What the current repo confirms about the failure being "today", not historical only
- `src/app/api/chat/route.ts:202-257` builds a phase-aware prompt from canvas YAML / IR, selected node context, code context, and conversation history.
- `src/app/api/chat/route.ts:272-280` marks `design` and `iterate` as canvas-editing phases.
- `src/lib/context-engine.ts:545-582` tells the model to always include `schema` on data-layer blocks and gives broad schema guidelines.
- `src/lib/context-engine.ts:1223-1231` explicitly routes `design` and `iterate` to diagram editing, not to a separate schema planner.
- `src/components/ChatPanel.tsx:646-714` auto-applies returned canvas actions and only follows up for three completeness gaps: missing edges, missing `schema`, or missing `schemaRefs` / `schemaFieldRefs`.
- `src/hooks/useCanvasActions.ts:160-165` merges `update-node` data directly into the node.
- `src/lib/store.ts:315-320` stores that merged node data without schema-specific validation.
- `src/lib/schema-linter.ts:63-202` defines useful lint rules, but my repo search did not find it wired into the chat apply path.
- Result: the current product still accepts one-shot schema blobs without a required integrity pass, index pass, or data-requirements extraction stage.
## 2. Generation model
### 2.1 Current model
Current behavior is effectively:
- One chat turn enters `design` or `iterate`.
- The prompt builder includes architecture YAML or IR plus some general schema guidance.
- The LLM emits `json:canvas-action` blocks.
- A data-layer block may be created or updated with a `data.schema` blob.
- The UI auto-applies that blob.
- The only automatic follow-up is whether schema exists at all and whether business nodes include schema references.
- There is no dedicated source-inventory artifact.
- There is no dedicated entity-to-table pass.
- There is no deterministic index pass.
- There is no embedding-dimension reconciler.
- There is no share/revocation boilerplate pass.
- There is no acceptance gate that can reject a schema as structurally invalid before it lands.
In short:
- one shot
- one schema blob
- no enforced constraints
- no validator in the accept path
- no referential-integrity pass
- no deterministic post-processing
- no patch-vs-regenerate policy
### 2.2 Proposed model
Proposed behavior is a staged data-layer generation pipeline that runs beside the existing design/iterate chat flow.
The pipeline still uses the LLM.
It stops asking the LLM to invent the entire final schema in one hop.
It breaks generation into six explicit stages with typed artifacts and validators.
### 2.3 S1 Source inventory extraction
**Goal**:
- Convert brainstorm/design context into a structured `DataRequirements` object.
**Why this stage exists**:
- The archive shows that source variety and platform shape are often decided in brainstorm, not in the final schema turn.
- The current generator loses that structure because it only sees prose + YAML context.
**Input**:
- Brainstorm convergence summary
- Prior assistant control state where available
- Current architecture nodes/edges
- Selected data-layer node context if present
- Explicit user modifications in the latest message
- Optional existing `DataRequirements` object for patch mode
**Output**:
- `DataRequirements`
**Recommended shape**:
- `sources`
- `content_units`
- `query_patterns`
- `retention`
- `sharing_modes`
- `auth_requirements`
- `embedding`
- `search`
- `storage_topology`
- `compliance`
- `pii`
- `expected_scale`
- `change_mode`
**Example fields**:
- `sources: ['obsidian_md', 'pdf_upload', 'web_clip', 'rss', 'video_subtitle']`
- `query_patterns: ['lookup_note_by_slug', 'filter_by_tag', 'fts_search', 'semantic_search', 'share_token_lookup']`
- `embedding.provider: 'dashscope'`
- `embedding.model: 'text-embedding-v3'`
- `storage_topology.vector_store: 'pgvector' | 'qdrant' | 'none'`
- `storage_topology.object_storage: 's3' | 'oss' | 'minio' | 'local' | 'none'`
- `sharing_modes: ['private', 'password_share', 'public_link']`
- `retention.raw_assets: true`
- `pii.level: 'none' | 'low' | 'moderate' | 'high'`
**Validator**:
- Runtime schema validation on the `DataRequirements` object
- Required presence of:
- at least one content source
- at least one query pattern
- a declared storage topology
- an explicit embedding choice when semantic search is enabled
- an explicit sharing mode when public/share nodes exist
**Deterministic or LLM**:
- LLM extraction
- deterministic normalization after extraction
**Acceptance rule**:
- If extraction fails validation, do not move to table generation.
- Retry once with error feedback.
- If it still fails, surface a user-facing 鈥渘eed one more clarification鈥?message rather than fabricating a schema.
### 2.4 S2 Entity -> table mapping
**Goal**:
- Turn `DataRequirements` into candidate tables, columns, foreign keys, and base constraints.
**Why this stage exists**:
- The LLM is still useful for identifying domain entities.
- It should not be trusted to self-police all relational fundamentals in the same completion.
**Input**:
- `DataRequirements`
- Current data-layer architecture nodes
- Existing schema for patch mode
- Resolved vector dimension from S4 if already known
**Output**:
- `SchemaDraft`
- Tables
- Columns
- Column constraints
- Foreign keys
- Candidate enums or lookup tables
- Table metadata flags like `is_junction`, `is_embedding_table`, `is_share_table`
**Required checks immediately after generation**:
- Every table has a primary key.
- Every foreign-key target exists.
- Every junction table has a composite PK or equivalent UNIQUE key.
- `created_at` and `updated_at` exist unless the table is explicitly exempt.
- Timestamps have defaults where defaults are expected.
- `NOT NULL` discipline is explicit on PKs, FKs, and required domain fields.
- Share/public tables include lifecycle fields when sharing is in scope.
- Source models include more than a thin `type + url` pair when heterogeneous imports are declared.
- Embedding tables carry chunk identity metadata when chunking is declared.
**Validator**:
- Runtime schema validation against a stricter internal type than the current `BlockSchema`
- Structural rule checks
- Referential integrity checks
- Domain heuristics keyed from `DataRequirements`
**Deterministic or LLM**:
- LLM proposes schema draft
- deterministic rule engine validates it
**Acceptance rule**:
- Fail if any required structural rule fails.
- Warning-only rules are allowed to continue only if the generator is in manual-review mode.
- For normal design/iterate auto-accept, structural rule failures block acceptance.
### 2.5 S3 Index pass
**Goal**:
- Add indexes deterministically from known access patterns rather than asking the LLM to remember them.
**Why this stage exists**:
- The archive schema had zero indexes.
- Index design is partially derivable from structure and query patterns.
**Input**:
- `DataRequirements.query_patterns`
- `SchemaDraft`
- Foreign-key graph
- Table role metadata from S2
**Output**:
- `IndexPlan`
- Plus an updated `SchemaDraft` enriched with indexes
**Deterministic rules**:
- B-tree index on every FK column unless it is already leftmost in an existing composite index.
- Composite index on junction tables across both FK columns.
- UNIQUE index on token-like or slug-like fields.
- GIN index for FTS document columns when `fts_search` exists in query patterns.
- HNSW or ivfflat index selection for vector columns depending on backend policy and extension support.
- Index on `shares.token`.
- Index on `shares.expires_at` when expiry scanning is expected.
- Optional filtered/partial indexes for `revoked_at IS NULL` or `published_at IS NOT NULL` patterns if the backend policy supports them.
**Validator**:
- Coverage checker:
- every FK has an index path
- every declared token-like lookup has UNIQUE or equivalent
- every semantic-search store has a vector index policy
- every FTS-enabled table has a text-search index policy
**Deterministic or LLM**:
- deterministic only
**Acceptance rule**:
- A schema that lacks required index coverage does not pass the generation gate.
### 2.6 S4 Embedding dimension reconciliation
**Goal**:
- Resolve vector dimensionality from the actual embedding-model node or model registry, never from LLM guesswork.
**Why this stage exists**:
- The archive uses `DashScope text-embedding-v3`.
- The archived schema still hardcodes `vector(1536)`.
**Input**:
- Architecture graph
- Embedding-model node metadata
- Local model-dimension registry
- Existing schema for patch mode
**Output**:
- `EmbeddingConfig`
- `provider`
- `model`
- `dimension`
- `vector_store_backend`
**Validator**:
- Model name must resolve to a known dimension or an explicit user-provided override.
- If semantic search is enabled and no dimension can be resolved, generation must halt rather than guessing.
- If vector store is not Postgres/pgvector, the SQL schema must not emit a `vector(N)` column as if it owned the vector store.
**Deterministic or LLM**:
- deterministic only
**Acceptance rule**:
- The resolved dimension is injected into prompts as an immutable fact.
- The LLM never gets to choose the number.
### 2.7 S5 Sharing/auth/revocation boilerplate
**Goal**:
- Make public/share features generate lifecycle-safe schema automatically.
**Why this stage exists**:
- The archive shows password-protected share links as a common product capability.
- The archived schema stops at `token/password_hash/expires_at`.
**Input**:
- `DataRequirements.sharing_modes`
- Architecture graph
- Existing schema draft
**Output**:
- Updated share/auth tables and fields
- Optional audit/access tables if policy enables them
**Required fields when sharing is in scope**:
- `revoked_at`
- `last_accessed_at`
- `created_at`
- `updated_at`
- Optional `revoked_by`
- Optional `access_count`
- Optional `status` if the team wants explicit lifecycle enums
**Validator**:
- If a share/public node exists and no revocation field exists, fail.
- If a share token exists and is not unique/indexed, fail.
- If expiry exists but revocation does not, warn at minimum and normally fail in auto-accept mode.
**Deterministic or LLM**:
- deterministic template insertion with optional LLM naming help
**Acceptance rule**:
- Sharing lifecycle coverage is treated as baseline completeness, not as a stretch enhancement.
### 2.8 S6 Validation gate
**Goal**:
- Reject invalid or incomplete schemas before they become accepted node state.
**Input**:
- `DataRequirements`
- `SchemaDraft`
- `IndexPlan`
- `EmbeddingConfig`
- Architecture graph
**Output**:
- `ValidationResult`
- `ok: true | false`
- errors
- warnings
- normalized schema payload ready for canvas storage
**Validator layers**:
- Zod-style runtime schema for internal generation artifacts
- relational integrity checks
- index coverage checks
- required-column checks
- embedding-dimension consistency check
- source-provenance coverage check
- share-lifecycle coverage check
- patch-safety check for iterate mode
**Deterministic or LLM**:
- deterministic only
**Acceptance rule**:
- The schema must pass S6 before it is allowed into node state.
- Validation failure triggers a structured repair retry.
- Two failed repair attempts escalate to the user instead of silently storing weak schema.
### 2.9 Why staged generation is the right fit for this repo
- It matches the existing architecture of ArchViber better than a rewrite would.
- `src/app/api/chat/route.ts:202-257` already centralizes prompt construction.
- `src/components/ChatPanel.tsx:646-714` already has an auto-follow-up loop for missing schema.
- `src/hooks/useCanvasActions.ts:160-165` and `src/lib/store.ts:315-320` already give one choke point before node data is accepted.
- `src/lib/schema-linter.ts:63-202` already contains part of the validation vocabulary and can be extended or wrapped.
- So the practical move is not 鈥渞eplace chat鈥?
- The practical move is 鈥渋nsert typed generation stages and a hard validation gate before `schema` becomes accepted canvas state.鈥?
## 3. WHEN to generate
The generator needs explicit lifecycle triggers.
Without trigger rules, ArchViber will keep oscillating between accidental full regeneration and under-reactive stale schemas.
### 3.1 Trigger A: first entry into `design` or `iterate` after brainstorm convergence
**Decision rule**:
- If the session phase transitions from `brainstorm` into `design`, and the architecture contains at least one data-layer block without accepted schema, run full generation from S1.
**Why**:
- `src/components/ChatPanel.tsx:650-652` already auto-transitions `design -> iterate` after first successful apply.
- The first design pass is where initial schema generation naturally belongs.
**Behavior**:
- Full run: S1 -> S6.
- Output: initial validated schema for the targeted data-layer node(s).
### 3.2 Trigger B: architecture node added or removed from the data layer
**Decision rule**:
- If a data-layer architecture edit adds/removes a storage concern node, rerun in patch mode.
**Examples**:
- adding `Qdrant`
- adding object storage
- removing share/public block
- replacing `pgvector` with `Qdrant`
**Behavior**:
- Patch mode:
- refresh S1 from latest architecture
- rerun S2-S6 for affected tables only
- preserve unaffected tables and user-approved custom columns where safe
**Why**:
- The archive shows this exact expansion pattern between the simple pgvector design and the later `Postgres + Qdrant + 瀵硅薄瀛樺偍` architecture.
### 3.3 Trigger C: embedding-model node changes
**Decision rule**:
- If the resolved embedding model or provider changes, rerun S4 and patch the embedding schema.
**Behavior**:
- Recompute vector dimension.
- Update vector column type or backend binding.
- Re-run S3 and S6 because vector index strategy may also change.
**Why**:
- This is a deterministic dependency.
- It should not require a full brainstorm rerun.
### 3.4 Trigger D: explicit user `regenerate` command
**Decision rule**:
- If the user explicitly says `regenerate schema`, `redo data layer`, or equivalent, run full regeneration from S1.
**Behavior**:
- Ignore patch optimization.
- Rebuild all stage artifacts.
- Still run S6 before accept.
**Why**:
- Sometimes the user wants a clean restart rather than a patch diff.
### 3.5 Trigger E: IR migrator detects source-code changes in data-layer binding
**Decision rule**:
- If the IR or source-to-architecture reconciliation path detects that the codebase鈥檚 data-layer bindings changed materially after schema generation, mark the schema stale.
**Behavior**:
- Do not auto-regenerate silently.
- Flag the data-layer node as stale.
- Prompt the user to review or rerun generation.
**Why**:
- This preserves trust.
- It avoids chat silently mutating a hand-edited schema because source code drifted.
### 3.6 Trigger F: schema validation failure after a manual data-layer edit
**Decision rule**:
- If the user manually edits schema through the canvas and breaks required invariants, run validation only first, then offer patch-generation if needed.
**Behavior**:
- Run S6 against the edited schema.
- If fixable deterministically, patch locally.
- If not fixable deterministically, invoke targeted repair generation beginning at S2 or S3 depending on failure type.
### 3.7 Trigger summary
- First design entry: full generation
- Data-layer topology change: patch generation
- Embedding-model change: dimension patch
- Explicit regenerate: full generation
- IR/source drift: stale flag plus prompt
- Manual invalid edit: validate-first then targeted repair
## 4. HOW to generate
### 4.1 Contract overview
The generator needs two contracts at once:
- a prompt contract for what the LLM may emit
- a validation contract for what ArchViber will accept
The current repo already has a canvas-action contract.
What it lacks is a generator-internal contract for data-layer artifacts.
That should be added before the canvas action is even formed.
### 4.2 Proposed internal artifact types
Use a small internal type system rather than asking the LLM to emit the final `BlockSchema` directly.
Recommended types:
- `DataRequirements`
- `SchemaDraft`
- `IndexPlan`
- `EmbeddingConfig`
- `ValidationResult`
Only after these pass should ArchViber synthesize the final `node.data.schema`.
### 4.3 Proposed `DataRequirements` contract
```json
{
  "sources": [
    {
      "kind": "obsidian_md",
      "retains_original_asset": false,
      "needs_parser_metadata": true
    },
    {
      "kind": "pdf_upload",
      "retains_original_asset": true,
      "needs_object_storage": true,
      "needs_page_offsets": true
    }
  ],
  "query_patterns": [
    "note_by_id",
    "note_by_slug",
    "tag_filter",
    "fts_search",
    "semantic_search",
    "share_token_lookup"
  ],
  "sharing_modes": ["password_share"],
  "embedding": {
    "enabled": true,
    "provider": "dashscope",
    "model": "text-embedding-v3"
  },
  "storage_topology": {
    "sql": "postgresql",
    "vector_store": "pgvector",
    "object_storage": "none"
  },
  "expected_scale": {
    "notes": "low",
    "embeddings": "medium"
  }
}
```
Rules:
- no prose paragraphs
- only declared enums / structured objects
- unknown keys rejected
- explicit booleans instead of implication
### 4.4 Proposed `SchemaDraft` contract
```json
{
  "tables": [
    {
      "name": "notes",
      "role": "primary_content",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "constraints": {
            "primary": true,
            "notNull": true,
            "default": "gen_random_uuid()"
          }
        }
      ],
      "indexes": [],
      "metadata": {
        "is_junction": false,
        "is_embedding_table": false,
        "is_share_table": false
      }
    }
  ]
}
```
Rules:
- Tables must include `role`.
- Tables must include `metadata`.
- Columns use the existing `constraints` object shape, not free-text `["PK"]` arrays.
- The LLM must emit `indexes: []` even before S3 so the structure is explicit.
- Table and column names are normalized before validation.
### 4.5 Required fields per table before validation can pass
These are the minimum acceptance rules.
- Every table needs a PK.
- Every table needs `created_at` unless explicitly exempt.
- Every mutable table needs `updated_at` unless explicitly exempt.
- Every FK must target an existing table/column.
- Every required domain field must carry `notNull: true`.
- Every junction table needs either:
- composite PK
- or composite UNIQUE covering both legs
- plus FK indexes
- Every embedding table needs:
- parent content FK
- chunk identity field
- vector field only when the vector store is SQL-hosted
- Every share/public table needs:
- token uniqueness
- revocation field
- last access field or explicit opt-out policy
### 4.6 Auto-index pass output
The deterministic index pass should not ask the LLM to rewrite tables.
It should emit an `IndexPlan`.
Example:
```json
{
  "indexes": [
    {
      "table": "note_tags",
      "name": "pk_note_tags",
      "columns": ["note_id", "tag_id"],
      "kind": "primary"
    },
    {
      "table": "shares",
      "name": "uq_shares_token",
      "columns": ["token"],
      "kind": "unique"
    },
    {
      "table": "embeddings",
      "name": "idx_embeddings_note_id",
      "columns": ["note_id"],
      "kind": "btree"
    }
  ]
}
```
Insertion rule:
- S2 produces the base table map.
- S3 appends or upgrades index definitions deterministically.
- S6 validates the merged result.
- Only the merged result becomes `node.data.schema`.
### 4.7 How the LLM gets source-inventory data first
There are two viable implementation paths.
Path A:
- Add a `DataRequirements` subphase immediately after brainstorm convergence and before the first schema-producing design turn.
Path B:
- Keep the user-visible phase names unchanged, but add an internal pre-prompt scoping step in `route.ts` before asking the model for schema-affecting canvas actions.
Recommendation:
- Use Path B first.
- It is lower-risk.
- It does not change the user-facing phase model.
- It fits the current `buildSplitPrompt` / `buildSystemContext` architecture.
Implementation behavior:
- When the requested action touches the data layer, the server first runs a cheap structured extraction call for `DataRequirements`.
- That structured artifact is injected into the later schema-generation prompt.
- The schema-generation prompt is then narrower and more factual.
### 4.8 Prompt contract for S2
The S2 prompt should stop saying 鈥渄esign a schema鈥?in broad prose.
It should instead say:
- Here is the `DataRequirements` object.
- Here is the storage topology.
- Here is the resolved embedding config.
- Emit only the `SchemaDraft` JSON.
- Do not invent storage systems outside the declared topology.
- Do not omit PKs.
- Do not leave nullability implicit.
- Do not invent vector dimension.
- Do not emit explanatory prose.
- If a requirement is ambiguous, choose the narrowest schema that still preserves provenance and queryability.
### 4.9 Validation contract after S2
If S2 fails validation:
- return a machine-readable list of failures
- retry once with those failures injected
- keep the retry prompt focused on repair, not full regeneration
Example retry feedback:
- `table note_tags missing primary or unique composite key`
- `embedding table missing chunk_index`
- `shares missing revoked_at`
- `vector dimension mismatch: expected 1024, got 1536`
### 4.10 Fallback policy
Fallback needs to be explicit.
Recommended policy:
- first failure: targeted repair retry
- second failure: reject accept-path mutation
- user-visible result: explain which rules failed and ask for clarification only if a missing product decision caused the failure
- never silently store a failing schema just because the LLM produced syntactically valid JSON
### 4.11 Where this plugs into today鈥檚 code path
Today鈥檚 generation decision happens here:
- `src/app/api/chat/route.ts:202-257`
- `src/app/api/chat/route.ts:272-280`
- `src/lib/context-engine.ts:545-582`
- `src/lib/context-engine.ts:1223-1231`
- `src/components/ChatPanel.tsx:646-714`
- `src/hooks/useCanvasActions.ts:160-165`
- `src/lib/store.ts:315-320`
Proposed insertion points:
- Before prompt assembly in `route.ts`, detect whether the requested change can affect data-layer schema.
- If yes, run S1 and resolve S4 first.
- Then run S2 as a structured-generation call.
- Then run S3 and S6 server-side.
- Only after S6 passes should the route permit a schema-bearing `update-node` / `add-node`.
- The UI remains the consumer of canvas actions.
- The server becomes the owner of schema-quality acceptance.
### 4.12 Prompt-fragment reality in this repo
The repo does not appear to have a dedicated `src/prompts/` directory for the brainstorm v2 prompt.
What I verified instead:
- `src/lib/skill-loader.ts:4` points skill discovery at `process.cwd()/skills`.
- `src/lib/skill-loader.ts:241-289` resolves prompt-type skills for context injection.
- `src/lib/skill-loader.ts:350-358` merges those skills.
- `src/lib/context-engine.ts:703-923` contains the brainstorm `json:user-choice` v2-style contract directly in the context builder.
- `src/lib/cc-native-scaffold.ts:104-170` also embeds the same brainstorm/card contract for native scaffold use.
- `src/lib/context-engine.ts:1308-1312` notes that canvas chat uses its own prompt assembly and only build agents resolve skill bodies through `resolveSkillContent`.
So:
- the reviewed schema was not produced by a separate prompt-fragment directory I could verify
- it was more likely produced by the embedded brainstorm/design prompt stack plus the canvas-action contract
- the data-layer plan should therefore target the route/context/apply path, not a nonexistent standalone prompt file
## 5. Migration of existing canvases
Existing canvases should not be force-regenerated on load.
The migrator strategy should be:
- preserve old `node.data.schema` as-is on load
- mark legacy schemas with an internal provenance/version stamp the first time they are touched by the new validator
- run the new S6 validation lazily when a legacy data-layer node is edited, regenerated, or otherwise affected by a schema-sensitive architecture change
- if the legacy schema passes, keep it
- if it fails, flag it as 鈥渓egacy schema needs upgrade鈥?and offer patch-generation instead of silent mutation
- the first upgrade should produce a diff-aware patch, not a full erase-and-rebuild, unless the user explicitly chooses full regeneration
This keeps old canvases usable while giving the new generator a clean forward path.
## 6. Implementation breakdown
This slice should use the repo鈥檚 week/day idiom, but stay explicitly separate from W2.
I recommend a follow-on slice under `W4`.
Reason:
- W2 is already reserved in Phase 1 planning for the code-ingest pipeline.
- This data-layer work is adjacent to chat/design, not to ingest clustering.
### W4.D1
**Goal**: add internal generation artifact types and validators
**Files touched**:
- `src/lib/data-layer/types.ts`
- `src/lib/data-layer/validators.ts`
- `src/lib/types.ts`
**Size**: M
**Depends on**:
- none
### W4.D2
**Goal**: add `DataRequirements` extraction stage and normalization
**Files touched**:
- `src/lib/data-layer/requirements.ts`
- `src/app/api/chat/route.ts`
- optional `src/lib/brainstorm/state.ts` integration hook
**Size**: M
**Depends on**:
- `W4.D1`
### W4.D3
**Goal**: add embedding-model dimension registry and reconciler
**Files touched**:
- `src/lib/data-layer/embedding-config.ts`
- `src/app/api/chat/route.ts`
- optional config file under `src/lib/data-layer/model-dimensions.ts`
**Size**: S
**Depends on**:
- `W4.D1`
### W4.D4
**Goal**: implement S2 entity-to-table mapping prompt path
**Files touched**:
- `src/lib/data-layer/schema-generator.ts`
- `src/lib/context-engine.ts`
- `src/app/api/chat/route.ts`
**Size**: L
**Depends on**:
- `W4.D1`
- `W4.D2`
- `W4.D3`
### W4.D5
**Goal**: implement deterministic index planner
**Files touched**:
- `src/lib/data-layer/index-planner.ts`
- `src/lib/schema-linter.ts`
- `src/lib/data-layer/validators.ts`
**Size**: M
**Depends on**:
- `W4.D1`
- `W4.D4`
### W4.D6
**Goal**: implement share/auth/revocation boilerplate pass
**Files touched**:
- `src/lib/data-layer/sharing-template.ts`
- `src/lib/data-layer/schema-generator.ts`
- `src/lib/data-layer/validators.ts`
**Size**: S
**Depends on**:
- `W4.D1`
- `W4.D4`
### W4.D7
**Goal**: add hard validation gate before schema-bearing canvas actions are accepted
**Files touched**:
- `src/app/api/chat/route.ts`
- `src/components/ChatPanel.tsx`
- `src/hooks/useCanvasActions.ts`
- `src/lib/store.ts`
**Size**: L
**Depends on**:
- `W4.D4`
- `W4.D5`
- `W4.D6`
### W4.D8
**Goal**: introduce patch-vs-regenerate trigger logic for data-layer changes
**Files touched**:
- `src/app/api/chat/route.ts`
- `src/lib/data-layer/change-detector.ts`
- `src/lib/ir/migrate.ts`
**Size**: M
**Depends on**:
- `W4.D2`
- `W4.D3`
- `W4.D7`
### W4.D9
**Goal**: migrate existing schema-linter rules into generation acceptance coverage
**Files touched**:
- `src/lib/schema-linter.ts`
- `tests/lib/schema-linter.test.ts`
- `tests/lib/data-layer/*.test.ts`
**Size**: M
**Depends on**:
- `W4.D1`
- `W4.D5`
### W4.D10
**Goal**: add golden tests from archive-derived cases
**Files touched**:
- `tests/lib/data-layer/archive-baseline.test.ts`
- `tests/lib/data-layer/index-coverage.test.ts`
- `tests/integration/data-layer-generation.test.ts`
**Size**: M
**Depends on**:
- `W4.D4`
- `W4.D5`
- `W4.D6`
- `W4.D7`
### W4.D11
**Goal**: add legacy-schema migration flags and upgrade prompts
**Files touched**:
- `src/lib/data-layer/legacy.ts`
- `src/app/api/chat/route.ts`
- `src/components/ChatPanel.tsx`
**Size**: S
**Depends on**:
- `W4.D7`
- `W4.D8`
### W4.D12
**Goal**: ship instrumentation and failure telemetry for schema generation
**Files touched**:
- `src/lib/data-layer/telemetry.ts`
- `src/app/api/chat/route.ts`
- optional `.archviber/cache/` output helpers
**Size**: S
**Depends on**:
- `W4.D7`
## 7. Open questions for the user
These are the questions where a wrong assumption would invalidate part of the plan.
### 7.1 Should ArchViber keep generating a single SQL schema blob for all data-layer blocks, or should it support mixed backends explicitly at generation time?
Why this matters:
- If mixed backends are first-class, S2/S3 need per-backend emitters.
- If not, the generator can stay SQL-first and only reference external stores abstractly.
Current assumption:
- Mixed backends should be explicit, because the archive already shows `Postgres + Qdrant + 瀵硅薄瀛樺偍` as a real converged outcome.
### 7.2 Is `BlockSchema` allowed to evolve, or must the accepted canvas schema remain exactly the current shape (`tables -> columns -> indexes`)?
Why this matters:
- A stricter internal type is easy.
- But if the final canvas payload cannot grow, some metadata will need to stay internal and be discarded before storage.
Current assumption:
- Internal generation artifacts can be richer.
- Final canvas payload should remain close to the current shape for compatibility.
### 7.3 Do you want the new generator to auto-patch legacy schemas on first relevant edit, or only after explicit user confirmation?
Why this matters:
- Auto-patch is smoother.
- Explicit confirmation is safer for trust.
Current assumption:
- Flag legacy schemas automatically.
- Require user confirmation before the first structural upgrade patch.
## 8. Done criteria
The data-layer generator is good enough to ship this phase when all of the following are true.
### 8.1 Functional correctness
- On first design entry after brainstorm convergence, a data-layer node can be generated through the staged pipeline without manual cleanup.
- A schema-bearing node is never accepted if it fails hard validation.
- Changing the embedding-model node updates vector dimensionality deterministically.
- Adding/removing a data-layer backend triggers patch logic instead of blind full regeneration.
### 8.2 Archive-regression coverage
- The archived `postgresql-pgvector` baseline no longer reproduces with:
- duplicate-ready junction tables
- zero indexes
- hardcoded wrong vector dimensions
- share tables without revocation support
- embedding rows without chunk identity metadata when chunking is declared
- source modeling reduced to only `source_type/source_url` when multi-source ingestion is declared
### 8.3 Validation coverage
- Every table has a PK.
- Every FK target exists.
- Every FK has index coverage.
- Every junction table has composite uniqueness.
- Every share/public table has lifecycle coverage.
- Every semantic-search schema has reconciled embedding dimensions.
- Validation failures are surfaced as structured errors and block acceptance.
### 8.4 UX behavior
- The user sees a clear message when generation fails due to missing product decisions versus structural schema errors.
- Legacy schemas are flagged, not silently rewritten.
- Explicit `regenerate` requests perform a full rerun from S1.
### 8.5 Testing
- Unit tests cover S1 normalization, S3 index planning, S4 dimension reconciliation, and S6 validation failures.
- Integration tests cover full generation and patch generation through the route/apply path.
- A golden test based on the archive baseline proves the new generator fixes the archived defects.
### 8.6 Operational quality
- The server records stage timings and validation failure categories.
- Retry loops are bounded.
- Deterministic stages are stable across model swaps.
### 8.7 Final ship bar
- A data-layer schema can no longer enter canvas state merely because the LLM emitted syntactically valid JSON.
- It enters state only after requirements extraction, deterministic enrichment, and hard validation.
- That is the minimum standard for this slice to be considered shipped.
