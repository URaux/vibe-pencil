import type { Locale } from './i18n'
import type { SessionPhase } from './store'
import type { Ir } from './ir'
import { irSchema, serializeIr } from './ir'

export type AgentType = 'canvas' | 'build'

export type TaskType =
  | 'discuss'         // chat global mode
  | 'discuss-node'    // chat with selected node
  | 'import'          // reverse-engineer codebase
  | 'import-enhance'  // refine skeleton with pre-digested project data
  | 'analyze'         // review architecture
  | 'implement'       // build a node
  | 'refactor'        // refactor a node

export interface ContextOptions {
  agentType: AgentType
  task: TaskType
  locale: Locale
  skillContent?: string
  canvasYaml?: string
  selectedNodeContext?: string
  conversationHistory?: string
  taskParams?: Record<string, string>  // dir, workDir, nodeName, waveInfo, etc.
  codeContext?: string
  buildSummaryContext?: string
  sessionPhase?: SessionPhase
  brainstormRound?: number
  /** The backend the prompt will be fed into. Used to decide whether to run
   *  the full 7-layer context engine (needed by plain 3rd-party APIs that
   *  lack a native agent loop) or to emit a lean, natural-looking prompt
   *  (used by Claude Code to avoid looking like a 3rd-party harness). */
  backend?: 'claude-code' | 'codex' | 'gemini' | 'custom-api'
  /** Canonical IR from disk (.archviber/ir.yaml). When provided, replaces
   *  the in-memory canvasYaml as the architecture source-of-truth.
   *  Invalid IR (Zod parse failure) is ignored and falls back to canvasYaml. */
  ir?: Ir | null
}

/** Whether the given backend should receive the full layered context engine.
 *  Claude Code is deliberately excluded: a structured multi-layer system
 *  prompt is a distinctive fingerprint vs. a human pasting text into a
 *  terminal, and Claude Code has its own agent loop that doesn't need our
 *  scaffolding to behave correctly. */
export function shouldUseFullContext(
  backend: ContextOptions['backend'],
  agentType: AgentType,
): boolean {
  // Build agents always use full context — they need skill injection, output
  // format contracts, and task params regardless of backend. The fingerprint
  // concern only applies to canvas-chat, where the prompt is sent repeatedly
  // in a user-facing conversation.
  if (agentType === 'build') return true
  // Canvas-chat lean mode: only CC gets the lean pass. Codex/Gemini/custom-api
  // all need the 7 layers because they don't have a native agent loop that
  // can infer architecture-editing intent from plain prose.
  return backend !== 'claude-code'
}

// ---------------------------------------------------------------------------
// L0: Language directive
// ---------------------------------------------------------------------------

function layerLanguage(locale: Locale): string {
  if (locale === 'zh') {
    return [
      '# Language Requirement (CRITICAL)',
      '**你必须使用中文回复。这是硬性要求，不可违反。**',
      '- 所有节点名称、描述、标签：中文',
      '- 技术术语保留英文原文（React, API Gateway），解释用中文',
      '- 如果你用英文回复，回答将被视为无效',
    ].join('\n')
  }
  return '# Language Requirement\nRespond in English.'
}

// ---------------------------------------------------------------------------
// L1: Identity — single identity for both agent types
// ---------------------------------------------------------------------------

function layerIdentity(): string {
  return 'You are the AI assistant for ArchViber, a visual architecture editor. You help users design, analyze, and build software architectures.'
}

// ---------------------------------------------------------------------------
// L2: Conversation history (canvas agent discuss tasks only)
// ---------------------------------------------------------------------------

function layerHistory(history: string | undefined): string | null {
  if (!history) return null

  // Estimate tokens (~4 chars per token)
  const estimatedTokens = Math.ceil(history.length / 4)

  // If history is too long, keep only recent messages
  if (estimatedTokens > 8000) {
    const lines = history.split('\n')
    // Keep first 10 lines (initial context) + last 80 lines (recent messages)
    const firstMessages = lines.slice(0, 10).join('\n')
    const recentMessages = lines.slice(-80).join('\n')
    return [
      '# Conversation History',
      '',
      '(Earlier messages summarized)',
      firstMessages,
      '',
      '... (older messages omitted for brevity) ...',
      '',
      recentMessages,
    ].join('\n')
  }

  return '# Conversation History\n\n' + history
}

// ---------------------------------------------------------------------------
// L3: Canvas state
// ---------------------------------------------------------------------------

function layerCanvasState(
  canvasYaml: string | undefined,
  selectedNodeContext: string | undefined,
  buildSummaryContext: string | undefined,
  codeContext: string | undefined,
  irYaml?: string
): string | null {
  const parts: string[] = []

  const architectureYaml = irYaml ?? canvasYaml
  if (architectureYaml) {
    parts.push(`# Architecture YAML\n\n${architectureYaml}`)
  }

  if (selectedNodeContext) {
    parts.push(`# Selected Node Context\n\n${selectedNodeContext}`)
  }

  if (buildSummaryContext) {
    parts.push(`# Build Summary\n\n${buildSummaryContext}`)
  }

  if (codeContext) {
    parts.push(`# Code Context (files from the built node)\n\n${codeContext}`)
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}

// ---------------------------------------------------------------------------
// L4: Task definition
// ---------------------------------------------------------------------------

/**
 * Build-subagent contract template. Produces a 6-section prompt body that is
 * the L4 (Task) contribution for build/implement agents. Each section is
 * populated from `taskParams`; empty sections are omitted rather than padded
 * with placeholders, to keep the prompt tight when data is missing.
 *
 * Supported taskParams keys (all strings, all optional unless noted):
 *   - nodeName            — display name of the block being built (required-ish)
 *   - blockId             — canvas node id (used to derive write path when no
 *                           explicit writeScope is given)
 *   - workDir             — project root on disk (required-ish)
 *   - waveIndex/waveSize/
 *     waveTotal           — parallel-wave position so the agent knows it's
 *                           one of N siblings running concurrently
 *   - siblingNames        — comma-separated list of other blocks in the SAME
 *                           wave (= concurrent, don't coordinate)
 *   - writeScope          — newline-separated paths the agent may create/edit
 *   - readOnlyScope       — newline-separated paths the agent may READ but
 *                           NOT modify (siblings, shared libs, schemas)
 *   - exposedSymbols      — newline-separated "symbol — signature" lines the
 *                           agent must implement as public exports
 *   - consumedSymbols     — newline-separated "symbol — signature" lines the
 *                           agent may import from upstream-already-built
 *                           blocks (signatures are frozen contracts)
 *   - facts               — source-backed truths (existing code snippets,
 *                           pinned interface definitions)
 *   - shellAllowlist      — newline-separated commands the agent may execute
 *   - validationCmd       — the single command that verifies completion
 *                           (e.g. `npm run build && npm test`)
 *   - techStack           — optional hint, echoed in identity section
 *   - waveInfo            — free-form extra note from the caller
 */
function buildImplementContract(taskParams: Record<string, string>): string {
  const nodeName = taskParams.nodeName ?? 'the target node'
  const workDir = taskParams.workDir ?? '<workDir>'
  const blockId = taskParams.blockId ?? ''
  const techStack = taskParams.techStack ?? ''
  const waveIndex = taskParams.waveIndex
  const waveSize = taskParams.waveSize
  const waveTotal = taskParams.waveTotal
  const siblingNames = taskParams.siblingNames ?? ''
  const writeScope = taskParams.writeScope ?? ''
  const readOnlyScope = taskParams.readOnlyScope ?? ''
  const exposedSymbols = taskParams.exposedSymbols ?? ''
  const consumedSymbols = taskParams.consumedSymbols ?? ''
  const facts = taskParams.facts ?? ''
  const shellAllowlist = taskParams.shellAllowlist ?? ''
  const validationCmd = taskParams.validationCmd ?? ''
  const waveInfo = taskParams.waveInfo ?? ''

  const sections: string[] = []

  // --- 1. Identity -------------------------------------------------------
  const identityLines = [
    `You are the build agent for block **${nodeName}**${blockId ? ` (id: \`${blockId}\`)` : ''}.`,
  ]
  if (techStack) identityLines.push(`Tech stack: ${techStack}.`)
  if (waveIndex && waveSize && waveTotal) {
    identityLines.push(
      `You are one of ${waveSize} agents running in parallel in wave ${waveIndex}/${waveTotal}. ` +
      `Do NOT coordinate with sibling agents; do not share state; your output is the files you write.`,
    )
  } else if (waveSize) {
    identityLines.push(
      `You are one of ${waveSize} agents running in parallel. Do NOT coordinate with siblings.`,
    )
  }
  if (siblingNames) identityLines.push(`Siblings in this wave: ${siblingNames}.`)
  sections.push(['## Identity', '', identityLines.join(' ')].join('\n'))

  // --- 2. Your Scope -----------------------------------------------------
  const scopeLines: string[] = []
  scopeLines.push(`- **Write** (you own these; create or modify freely):`)
  if (writeScope) {
    for (const line of writeScope.split('\n').filter(Boolean)) scopeLines.push(`  - ${line}`)
  } else {
    scopeLines.push(
      `  - Files under ${workDir} directly belonging to **${nodeName}**. ` +
      `If the block has no pre-existing directory, create one whose name matches the block id.`,
    )
  }
  scopeLines.push(`- **Read-only reference** (siblings' outputs, shared scaffolding — do NOT edit):`)
  if (readOnlyScope) {
    for (const line of readOnlyScope.split('\n').filter(Boolean)) scopeLines.push(`  - ${line}`)
  } else {
    scopeLines.push(
      `  - Other blocks' source files in ${workDir}. Read them to understand contracts, ` +
      `never modify them.`,
    )
  }
  scopeLines.push(`- **Do NOT touch**: everything outside ${workDir}, and any read-only path above.`)
  scopeLines.push(
    `If you believe you need to modify a file outside your write scope, STOP and output ` +
    `\`SCOPE_VIOLATION: <path> — <why>\` instead of editing. Do not proceed.`,
  )
  sections.push(['## Your Scope', '', scopeLines.join('\n')].join('\n'))

  // --- 3. Interface Contracts -------------------------------------------
  if (exposedSymbols || consumedSymbols) {
    const contractLines: string[] = []
    if (exposedSymbols) {
      contractLines.push(`**Expose** — the symbols downstream blocks will import from you. ` +
        `Implement EXACTLY these signatures. Do not rename, reorder required params, or change return types:`)
      for (const line of exposedSymbols.split('\n').filter(Boolean)) contractLines.push(`- ${line}`)
    }
    if (consumedSymbols) {
      contractLines.push(``)
      contractLines.push(`**Consume** — symbols you may import from upstream blocks. ` +
        `Their signatures are FROZEN; do not re-declare or shim them:`)
      for (const line of consumedSymbols.split('\n').filter(Boolean)) contractLines.push(`- ${line}`)
    }
    contractLines.push(``)
    contractLines.push(
      `If an upstream block's actual implementation contradicts the frozen signature above, ` +
      `output \`CONTRACT_MISMATCH: <symbol> — <difference>\` and STOP.`,
    )
    sections.push(['## Interface Contracts', '', contractLines.join('\n')].join('\n'))
  }

  // --- 4. Source-Backed Facts vs Inferred Areas --------------------------
  if (facts) {
    sections.push([
      '## Source-Backed Facts vs Inferred Areas',
      '',
      '**Facts** (confirmed from existing code; treat as ground truth):',
      '',
      facts,
      '',
      '**Inferred** (your task — these are being designed now): anything not listed above.',
      'Do not treat inferred choices as facts. When the canvas spec and real code disagree, the real code wins.',
    ].join('\n'))
  }

  // --- 5. Allowed Operations --------------------------------------------
  const opsLines: string[] = []
  opsLines.push(`- **Read**: any file listed in Your Scope above.`)
  opsLines.push(`- **Write**: only files listed under "Write" in Your Scope.`)
  if (shellAllowlist) {
    opsLines.push(`- **Shell** (only these commands):`)
    for (const line of shellAllowlist.split('\n').filter(Boolean)) opsLines.push(`  - \`${line}\``)
  } else {
    opsLines.push(
      `- **Shell**: only non-destructive local commands needed to build or test your block ` +
      `(e.g. \`${techStack ? techStackShellHint(techStack) : 'npm run build, npm test'}\`). ` +
      `No global installs, no network calls beyond package managers.`,
    )
  }
  opsLines.push(
    `- **Forbidden**: \`git push\`, \`git commit\` (the orchestrator handles VCS), ` +
    `modifying any file outside your write scope, spawning sub-subagents, installing system packages.`,
  )
  sections.push(['## Allowed Operations', '', opsLines.join('\n')].join('\n'))

  // --- 6. Completion Contract -------------------------------------------
  const completionLines: string[] = []
  completionLines.push(`You are done when ALL of the following hold:`)
  completionLines.push(`1. Every file in your Write scope exists and is syntactically valid.`)
  if (exposedSymbols) {
    completionLines.push(`2. Every symbol in **Expose** is implemented with its exact signature.`)
    completionLines.push(`3. You have run the validation command and it returned success.`)
  } else {
    completionLines.push(`2. You have run the validation command and it returned success.`)
  }
  if (validationCmd) {
    completionLines.push(``)
    completionLines.push(`**Validation command** (run exactly this before reporting done):`)
    completionLines.push(`\`\`\`sh`)
    completionLines.push(validationCmd)
    completionLines.push(`\`\`\``)
  } else {
    completionLines.push(``)
    completionLines.push(
      `No explicit validation command was provided — run the idiomatic build/test for ` +
      `your tech stack and include the exit code + last 20 lines of output in the summary below.`,
    )
  }
  completionLines.push(``)
  completionLines.push(
    `**Output the following JSON as the LAST thing you produce**, on its own line, after all ` +
    `other work:`,
  )
  completionLines.push(`\`\`\`json`)
  completionLines.push(
    `{"block": "${blockId || nodeName}", "status": "ok|scope_violation|contract_mismatch|validation_failed", ` +
    `"exposed": [...], "files_written": [...], "issues": [...]}`,
  )
  completionLines.push(`\`\`\``)
  completionLines.push(
    `Do NOT stop before producing this line. Do NOT produce this line before validation passes.`,
  )
  sections.push(['## Completion Contract', '', completionLines.join('\n')].join('\n'))

  const header = `# Task\n\nImplement **${nodeName}** in \`${workDir}\`. Follow the contract below exactly.`
  const trailer = waveInfo ? `\n\n## Additional Context\n\n${waveInfo}` : ''

  return [header, ...sections].join('\n\n') + trailer
}

/** Best-guess validation command hints by tech stack. Used only when the
 *  caller didn't supply a specific shell allowlist. */
function techStackShellHint(techStack: string): string {
  const t = techStack.toLowerCase()
  if (/(next|react|vue|svelte|node|typescript|javascript)/.test(t)) return 'npm run build, npm test, npx tsc --noEmit'
  if (/python|django|flask|fastapi/.test(t)) return 'python -m pytest, ruff check, mypy'
  if (/go/.test(t)) return 'go build ./..., go test ./...'
  if (/rust/.test(t)) return 'cargo build, cargo test, cargo clippy'
  if (/java|spring|kotlin/.test(t)) return 'mvn test, gradle build'
  return 'the idiomatic build + test commands for your tech stack'
}

function layerTask(task: TaskType, taskParams: Record<string, string> = {}): string {
  switch (task) {
    case 'discuss':
      return '# Task\n\nDiscuss the architecture with the user. Answer questions, suggest improvements, and help reason about the design.'

    case 'discuss-node':
      return '# Task\n\nDiscuss the selected node with the user. Focus on its responsibilities, implementation details, dependencies, and how it fits into the broader architecture.'

    case 'import': {
      const dir = taskParams.dir ?? '<unknown dir>'
      return [
        '# Task',
        '',
        `Reverse-engineer the codebase at: ${dir}`,
        'Analyze the project and produce a structured architecture representation as React Flow canvas data.',
        'Favor a compact but meaningful graph.',
      ].join('\n')
    }

    case 'import-enhance': {
      const dir = taskParams.dir ?? '<unknown dir>'
      const projectSummary = taskParams.projectSummary ?? ''
      const existingYaml = taskParams.existingYaml ?? ''
      return [
        '# Task',
        '',
        `Refine the architecture of the project at: ${dir}`,
        '',
        'A preliminary scan has already been performed. The project summary and initial skeleton are provided below.',
        'Your job is to:',
        '1. Add meaningful descriptions to each block',
        '2. Identify the correct tech stack for each block',
        '3. Fix any incorrect container groupings (split or merge as needed)',
        '4. Add missing edges that represent real data flows',
        '5. Remove any blocks that are too granular or redundant',
        '6. Add any major architectural components the scan missed',
        '',
        'DO NOT read files from the filesystem. All the information you need is in this prompt.',
        'DO NOT use any tools. Respond with JSON only.',
        '',
        '## Pre-analyzed Project Summary',
        '',
        projectSummary,
        '',
        '## Current Skeleton (to refine)',
        '',
        existingYaml,
      ].join('\n')
    }

    case 'analyze':
      return '# Task\n\nReview the architecture, identify structural risks, and recommend the simplest viable improvements.'

    case 'implement': {
      // 6-section build-subagent contract, distilled from harness-creator +
      // aider (read-only vs editable file split), sweep (file_to_modify vs
      // relevant_file distinction, topological order awareness), and cline
      // (tool allowlist + explicit completion gate). Sections with no data
      // populated are dropped so the prompt stays tight when the caller
      // hasn't (yet) supplied the extra fields.
      return buildImplementContract(taskParams)
    }

    case 'refactor': {
      const nodeName = taskParams.nodeName ?? 'the target node'
      return `# Task\n\nRefactor ${nodeName}. Propose and apply a refactor plan that reduces complexity while preserving behavior.`
    }

    default:
      return '# Task\n\nAssist the user with their request.'
  }
}

// ---------------------------------------------------------------------------
// L5: Skills
// ---------------------------------------------------------------------------

function layerSkills(skillContent: string | undefined): string | null {
  if (!skillContent) return null
  return '# Skills\n\nFollow these skill instructions carefully.\n\n' + skillContent
}

// ---------------------------------------------------------------------------
// L6: Constraints
// ---------------------------------------------------------------------------

function layerConstraints(agentType: AgentType, taskParams: Record<string, string> = {}): string {
  if (agentType === 'canvas') {
    return [
      '# Constraints',
      '',
      'Do NOT modify any files on the filesystem.',
      'You may suggest canvas actions (add/update/remove nodes and edges) via structured JSON blocks.',
      'All suggestions are proposals — the user decides whether to apply them.',
    ].join('\n')
  }

  // build agent — scope and tool rules now live in layerTask's 6-section
  // contract (Your Scope / Allowed Operations / Completion Contract). Keep
  // only the schema-matching and YAML-immutability rules here, since they're
  // orthogonal to the per-block contract.
  return [
    '# Additional Constraints',
    '',
    'If the architecture YAML contains schema definitions for Data Layer blocks, you MUST generate database models (ORM entities, migrations) that exactly match the specified tables, columns, types, and constraints. Do not add, remove, or rename any columns.',
    'Do not modify the canvas YAML directly — your output is files on disk.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// L7: Output format
// ---------------------------------------------------------------------------

const CANVAS_ACTION_INSTRUCTIONS = [
  '# Output Format',
  '',
  'Respond in Markdown.',
  '',
  'IMPORTANT: When the user describes a system, product, or project idea, you MUST generate the architecture as canvas-action blocks. Do not just describe it in text — draw it on the canvas.',
  'When generating or modifying the architecture, include ```json:canvas-action blocks at the START of your response, before any explanation.',
  'Always generate canvas-action blocks when: the user asks to design/build/create a system, the user describes requirements, or the user asks to add/modify components.',
  '',
  '## canvas-action format',
  '',
  'Each action is a separate fenced code block with the language tag `json:canvas-action`.',
  'Available actions: add-node, update-node, remove-node, add-edge.',
  '',
  '### Complete example',
  '',
  'If the user says "make a web app with API and database", you MUST output:',
  '',
  '````',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"container","data":{"name":"Frontend","color":"blue","collapsed":false},"style":{"width":400,"height":200}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"container","data":{"name":"Backend","color":"green","collapsed":false},"style":{"width":400,"height":200}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"container","data":{"name":"Data Layer","color":"purple","collapsed":false},"style":{"width":400,"height":200}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"block","parentId":"frontend","data":{"name":"React App","description":"SPA frontend","status":"idle","techStack":"React"}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"block","parentId":"backend","data":{"name":"API Server","description":"REST API","status":"idle","techStack":"Node.js"}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"block","parentId":"data-layer","data":{"name":"PostgreSQL","description":"Main database","status":"idle","techStack":"PostgreSQL"}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"block","parentId":"data-layer","data":{"name":"Users DB","description":"User accounts and auth","status":"idle","techStack":"PostgreSQL","schema":{"tables":[{"name":"users","columns":[{"name":"id","type":"bigint","constraints":{"primary":true,"notNull":true}},{"name":"email","type":"varchar(255)","constraints":{"unique":true,"notNull":true}},{"name":"password_hash","type":"varchar(255)","constraints":{"notNull":true}},{"name":"created_at","type":"timestamptz","constraints":{"notNull":true,"default":"now()"}},{"name":"updated_at","type":"timestamptz","constraints":{"notNull":true,"default":"now()"}},{"name":"deleted_at","type":"timestamptz"}],"indexes":[{"name":"idx_users_email","columns":["email"],"unique":true}]}]}}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-edge","edge":{"source":"react-app","target":"api-server","type":"sync","label":"HTTPS"}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-edge","edge":{"source":"api-server","target":"postgresql","type":"sync","label":"SQL"}}',
  '```',
  '````',
  '',
  'Then write your explanation text AFTER all the code blocks.',
  '',
  '### Action schemas',
  '',
  '- add-node container: `{"action":"add-node","node":{"type":"container","data":{"name":"...","color":"blue|green|purple|amber|rose|slate","collapsed":false},"style":{"width":400,"height":200}}}`',
  '- add-node block: `{"action":"add-node","node":{"type":"block","parentId":"<container-id>","data":{"name":"...","description":"...","status":"idle","techStack":"...","schemaRefs":["users","departments"],"schemaFieldRefs":{"users":["id","name"],"departments":["id","dept_name"]}}}}`',
  '- update-node: `{"action":"update-node","target_id":"<node-id>","data":{"name":"..."}}`',
  '- remove-node: `{"action":"remove-node","target_id":"<node-id>"}`',
  '- add-edge: `{"action":"add-edge","edge":{"source":"<block-id>","target":"<block-id>","type":"sync|async|bidirectional","label":"..."}}`',
  '- add-edge (FK): `{"action":"add-edge","edge":{"source":"<source-block-id>","target":"<target-block-id>","type":"sync","label":"FK: orders.user_id → users.id","data":{"edgeType":"fk","sourceTable":"orders","sourceColumn":"user_id","targetTable":"users","targetColumn":"id"}}}`',
  'When a schema column has a foreign key referencing a table in a DIFFERENT block, ALWAYS create an FK edge connecting the two blocks.',
  '',
  'When adding blocks to a Data Layer container, ALWAYS include a schema field with table definitions.',
  'For NON-Data-Layer blocks that read/write data, schemaRefs and schemaFieldRefs are REQUIRED, not optional.',
  'schemaRefs must list only the tables this module reads or writes.',
  'schemaFieldRefs must list only the fields this module uses from each table; do not include unrelated columns.',
  'Do NOT duplicate full schema in non-data blocks; only reference the shared data-layer schema via schemaRefs/schemaFieldRefs.',
  '',
  '## Schema Design Guidelines',
  '',
  '### Naming',
  '- Tables: snake_case plural (users, order_items)',
  '- Columns: snake_case singular (user_id, created_at)',
  '- Indexes: idx_{table}_{column} (idx_users_email)',
  '- Foreign keys: column named {target_table_singular}_id (user_id → users.id)',
  '',
  '### Required columns (every table)',
  '- id: bigint PK (auto-increment or snowflake)',
  '- created_at: timestamptz NOT NULL DEFAULT now()',
  '- updated_at: timestamptz NOT NULL DEFAULT now()',
  '- deleted_at: timestamptz nullable (soft-delete, optional but recommended)',
  '',
  '### Type selection (strict rules)',
  '- Money/price → decimal(19,4), NEVER float',
  '- Time → timestamptz, NEVER varchar for dates',
  '- Status/type/category → enum or reference table, NEVER bare string',
  '- Boolean → boolean, NOT 0/1 integer',
  '- Long text → text; short fixed → varchar(N)',
  '- UUID → uuid type, NOT varchar(36)',
  '',
  '### Constraints (explicit is default)',
  '- Every table MUST have a PK',
  '- FK MUST reference an existing table.column in the schema',
  '- NOT NULL is the default stance — only nullable when truly optional',
  '- UNIQUE on natural keys (email, slug, phone)',
  '- DEFAULT values when a sensible default exists',
  '',
  '### Indexes',
  '- ALL FK columns MUST be indexed',
  '- High-frequency query columns: status, type, user_id',
  '- Composite indexes: respect left-prefix principle',
  '- Do NOT index low-cardinality columns alone (e.g., gender with 3 values)',
  '',
  '### Anti-patterns to avoid',
  '- All columns are string/text → lazy schema, use proper types',
  '- No PK → broken fundamentals',
  '- Float for money → precision loss',
  '- VARCHAR for timestamps → unsortable, uncomparable',
  '- Bare string status with no constraint → dirty data source',
  '- Table missing created_at/updated_at → untraceable',
  '- FK column without index → full table scan on joins',
  '- Storing JSON blobs for structured relational data → use proper tables',
  '',
  '### Cross-service data (microservice blocks)',
  '- No physical FK across blocks (cross-DB not supported)',
  '- Use logical FK: same column type + naming, add comment noting reference',
  '- Use Edge layer to express cross-block data dependencies',
  '',
  'Node IDs are auto-generated from name as kebab-case (e.g., "React App" → "react-app", "Data Layer" → "data-layer").',
  'If a name contains CJK characters, the auto-generated id will contain those CJK characters as-is (the kebab fallback preserves them). ',
  'When you emit add-edge actions, you MUST use the exact id assigned by the preceding add-node (or the id shown in the provided architecture_yaml). ',
  'Do NOT invent English-looking ids that were never declared — those edges will be silently dropped at apply time. ',
  'Safest pattern: declare every block with an explicit English kebab-case `id` field (e.g., `{"action":"add-node","node":{"id":"note-editor","data":{"name":"笔记编辑器"}}}`) so you can reference it later without guessing.',
  '',
  'CRITICAL RULES:',
  '- You MUST include add-edge actions to connect related blocks. An architecture without edges is incomplete.',
  '- Every block that communicates with another block MUST have an edge.',
  '- Only create edges between block nodes (not containers).',
  '- Put ALL ```json:canvas-action blocks FIRST, then explanation text AFTER.',
  '- Each code block contains exactly ONE JSON action.',
  '- Do NOT skip canvas-action blocks. If the user describes a system, ALWAYS generate them.',
].join('\n')

function layerOutputFormat(agentType: AgentType, task: TaskType, locale: Locale, sessionPhase?: SessionPhase, brainstormRound?: number, backend?: ContextOptions['backend']): string {
  if (task === 'import' || task === 'import-enhance') {
    const exampleContainerName = locale === 'zh' ? '客户端层' : 'Client Layer'
    const exampleBlockName = locale === 'zh' ? 'Web 应用' : 'Web App'
    const exampleBlockDesc = locale === 'zh' ? '用户交互界面' : 'User-facing application'

    return [
      '# Output Format',
      '',
      'Return structured JSON for React Flow and nothing else, unless you need a fenced ```json block.',
      'The preferred JSON shape is:',
      '{',
      '  "containers": [',
      '    {',
      '      "id": "container-client",',
      `      "name": "${exampleContainerName}",`,
      '      "color": "blue",',
      '      "blocks": [',
      '        {',
      '          "id": "block-web",',
      `          "name": "${exampleBlockName}",`,
      `          "description": "${exampleBlockDesc}",`,
      '          "status": "idle",',
      '          "techStack": "Next.js 16"',
      '        }',
      '      ]',
      '    }',
      '  ],',
      '  "edges": [',
      '    {',
      '      "id": "edge-1",',
      '      "source": "block-web",',
      '      "target": "block-api",',
      '      "type": "sync",',
      '      "label": "HTTPS"',
      '    }',
      '  ]',
      '}',
      'If you cannot produce the new format, the legacy shape with nodes.services/frontends/apis/databases/queues/externals is still accepted.',
      'Use only these edge types: sync, async, bidirectional.',
      'Use only these container colors: blue, green, purple, amber, rose, slate.',
    ].join('\n')
  }

  if (agentType === 'build') {
    return '# Output Format\n\nWrite files directly to the filesystem. Do not output file contents to stdout unless asked.'
  }

  // canvas agent in brainstorm phase: batched WHAT/HOW/DEPS protocol (v2).
  // See .planning/phase1/BRAINSTORM-SKILL-V2-DRAFT.md for the source spec.
  //
  // Core migration vs v1:
  //   - 3 batches (WHAT / HOW / DEPS) + 1 convergence round = 4 rounds max
  //   - Option cards are ```json:user-choice fenced blocks (NOT numbered md)
  //   - Control comments: <!-- progress: batch=X/3 round=N/4 mode=M -->
  //     <!-- decisions: {...} --> and <!-- externalDeps: [...] -->
  //   - Server-side state module re-injects prior decisions via a system
  //     prefix (formatStateForPrompt), so the LLM sees what's already decided
  //     without having to be reminded inside this prompt.
  if (sessionPhase === 'brainstorm') {
    const currentRound = brainstormRound ?? 1
    const MAX_ROUNDS = 4
    const isConverging = currentRound >= MAX_ROUNDS
    const zh = locale === 'zh'

    // Round-specific pressure text. Three regimes:
    //   round 1      → WHAT batch (always)
    //   round 2      → HOW batch (derive from batch 1)
    //   round 3      → DEPS batch (only if batch 2 surfaced external deps)
    //   round 4+     → convergence, NO option cards
    const roundGuidanceZh = isConverging
      ? `当前是第 ${currentRound} 轮（收敛轮）。禁止再发 \`\`\`json:user-choice 卡片。严格按 "收敛格式" 段落的要求回复。`
      : currentRound === 1
        ? `当前是第 1 轮。发 Batch 1 · WHAT 层：3 张独立的选项卡（目标、用户与规模、核心功能 3-5 个多选）+ 首轮末尾的模式开关卡。`
        : currentRound === 2
          ? `当前是第 2 轮。发 Batch 2 · HOW 层：基于第 1 轮答案选出的领域，发 3-4 张领域相关的选项卡。不要发与领域无关的卡。`
          : `当前是第 3 轮。发 Batch 3 · DEPS 层：只问 Batch 2 暴露的外部依赖需要澄清的部分（0-4 张卡）。没有就直接收敛。`

    const roundGuidanceEn = isConverging
      ? `This is round ${currentRound} (convergence). Do NOT emit any \`\`\`json:user-choice cards. Reply strictly per the "Convergence Format" section.`
      : currentRound === 1
        ? `This is round 1. Emit Batch 1 · WHAT: three independent cards (goal, users & scale, core features multi-select 3-5) + a mode-switch card at the end.`
        : currentRound === 2
          ? `This is round 2. Emit Batch 2 · HOW: 3-4 cards whose content is derived from the batch-1 answers. Do not emit cards unrelated to the user's domain.`
          : `This is round 3. Emit Batch 3 · DEPS: 0-4 cards clarifying the external dependencies surfaced by batch 2. If none are needed, skip straight to convergence.`

    const bodyZh = [
      '# 需求讨论阶段（v2 协议）',
      '',
      '## 协议总览',
      '',
      '按 3 个批次推进需求讨论，最多 4 轮：WHAT（目标/用户/功能）→ HOW（领域具体方案）→ DEPS（外部依赖澄清）→ 收敛。同批的选项卡互相独立，同一轮一次性全部发出。每轮回复 = 0 到 N 张 `json:user-choice` 选项卡 + 必须的尾部控制注释。',
      '',
      '## 本轮指令',
      '',
      roundGuidanceZh,
      '',
      '## 批次结构',
      '',
      '**Batch 1 · WHAT 层（第 1 轮，恒发）**',
      '- 卡 1：系统目标（单选）',
      '- 卡 2：目标用户与规模（单选）',
      '- 卡 3：核心功能（多选 3-5 个，`multi:true, min:3, max:5`）',
      '- 附加：首轮末尾发模式开关卡（见「新手/老手模式」）',
      '',
      '**Batch 2 · HOW 层（第 2 轮，领域相关）**',
      '卡片内容必须由 Batch 1 的领域答案推导，示例：',
      '- 电商 → 支付 / 库存 / 物流 / 营销',
      '- 个人知识库 → LLM / Embedding / 向量库 / 数据源',
      '- SaaS → 多租户 / 计费 / SSO / 审计',
      '- 通用兜底 → 技术栈 / 数据模型 / 集成',
      '',
      '**Batch 3 · DEPS 层（第 3 轮，按需）**',
      '只问 Batch 2 暴露出来的外部依赖澄清（key / 域名 / OAuth 应用 / 采购审批）。没有就直接进入收敛轮。',
      '',
      '## 选项卡格式（`json:user-choice`）',
      '',
      '每张卡一个 \\`\\`\\`json:user-choice 代码块。**严格按以下字段**（前端只解析这些 key）：',
      '',
      '```',
      '```json:user-choice',
      '{',
      '  "question": "要解决什么问题？",',
      '  "options": ["个人效率工具", "团队协作 SaaS", "电商平台", "内容社区", "不懂，请解释"]',
      '}',
      '```',
      '```',
      '',
      '**默认 `multi: true, ordered: true`** — 大多数需求梳理题都是"按重要度/相关度排序选几个"，排序本身就是信号。单选（`multi: false`）仅用于真正互斥的题（是/否、二选一的技术栈、严格互斥的模式）。',
      '',
      '可选字段（按需使用）：',
      '- `"multi": true` — 多选（checkbox + 提交按钮，**默认**）',
      '- `"ordered": true` — 多选但带排序徽章（①②③），代表用户按重要度/优先级排序，**绝大多数多选题都应开启**，隐含 `multi:true`',
      '- `"min": N` — 建议最少选几个（soft hint）',
      '- `"max": N` — 硬上限，超过会禁用',
      '- `"allowCustom": true` — 允许用户填自定义文本',
      '- `"allowIndifferent": true` — 底部追加「无所谓」选项，与其他互斥',
      '',
      '**禁止**：在 `options` 里再嵌问题；用编号 markdown 列表代替卡片；把 `question` 写在选项外。每张卡至少保留 1 个「不懂，请解释」或 `allowIndifferent:true` 兜底项。',
      '',
      '## 控制注释（必须附在回复尾部）',
      '',
      '**每轮都发 `progress`：**',
      '`<!-- progress: batch=N/3 round=N/4 mode=novice|expert -->`',
      '（`batch` 用数字 1/2/3，收敛轮写 `batch=3/3`；`mode` 反映当前模式）',
      '',
      '**首轮额外发 `title`：**',
      '`<!-- title: 项目标题 -->`（≤ 15 字）',
      '',
      '**`decisions` — 只在本轮产生新决策时发，遵守合并语义（硬约束，违反会丢数据）：**',
      '- `features`（数组）：每轮必须重发 **完整最终集合**，客户端做 last-write-wins 整组覆盖。发部分列表 = 丢数据。',
      '- 其他数组字段（如未来的 `integrations`、`data_sources`）同理：**整组重发**。',
      '- `domain` / `scale`（字符串）：正常覆写即可。',
      '- `tech_preferences`（对象 / RECORD）：按 key 浅合并 —— 本轮只需带要改的 key，未出现的 key 保留上一轮值。想清除某 key 就显式发 `{"该key": null}`。',
      '- 单个 key 的 value 若是数组（如 `tech_preferences.databases: [...]`），内部整组覆写。',
      '',
      '格式示例：',
      '`<!-- decisions: {"domain":"ecommerce","scale":"10k MAU","features":["浏览商品","购物车","下单支付"],"tech_preferences":{"frontend":"Next.js"}} -->`',
      '',
      '**`externalDeps` — 外部依赖事件流（累积追加，不覆盖）：**',
      '每次收到用户答复内省一次"这一步是否引入了外部服务 / 凭证 / 账号需求？"。是 → 在本轮回复尾追加一条事件数组。前端解析用 `service+type+envVar` 去重。',
      '',
      '依赖三类：',
      '- **A · data-input** — API key / 配置值 / OAuth secret（`type:"api_key"`，用户填进 `.env`）',
      '- **B · human-action** — OAuth 应用注册 / 账号开通 / 域名 DNS（`type:"oauth_app"` 等，需去某处操作）',
      '- **C · approval** — 法务 / 合规 / 采购（`type:"compliance"`，不阻塞构建，提示即可）',
      '',
      '事件字段：`op`（`add` | `update` | `remove`）、`service`、`type`、`status`（`needed` | `provided` | `skipped`）、可选 `group`、`envVar`、`action`、`docsUrl`、`notes`。示例：',
      '`<!-- externalDeps: [{"op":"add","service":"stripe","type":"api_key","status":"needed","group":"A","envVar":"STRIPE_SECRET_KEY","docsUrl":"https://stripe.com/docs/keys"}] -->`',
      '用户填了 key 后下一轮发 `{"op":"update","service":"stripe","type":"api_key","status":"provided"}`。',
      '',
      '## 新手 / 老手模式',
      '',
      '**默认 NOVICE。** NOVICE 下每个选项 = 短名 + 一句 ≤ 40 字的白话解释。例：',
      '`Stripe — 美国支付公司，国际卡好但国内主体要求高，月费 0、每笔 2.9%`',
      '',
      '**首轮末尾恒发模式开关卡**：',
      '```',
      '```json:user-choice',
      '{"question":"回答风格","options":["新手模式：每个选项都解释（默认）","老手模式：只列短名"]}',
      '```',
      '```',
      '用户选了之后整个会话粘住，`mode` 写进 progress 注释。',
      '',
      '**首条用户消息 TONE 校准（仅用于猜首轮默认）**：',
      '- EXPERT 线索：主动出现具体技术名（Postgres / Qdrant / OAuth2）、缩写、企业黑话',
      '- NOVICE 线索：白话描述目标、零技术词、问句',
      '最终以用户点开关为准。',
      '',
      '## 收敛格式（第 4 轮专用，必须严格遵守）',
      '',
      '- 回复全文 ≤ 150 字，禁止发 `json:user-choice` 卡。',
      '- 首行写一句确认（如"信息已足够，下面是本次收敛方案"）。',
      '- 3-5 个 bullet，每条 ≤ 10 字给架构要点（例："前端 Next.js"、"数据层 Postgres + Qdrant"、"支付 Stripe"）。',
      '- 如有 externalDeps，追加一行 A/B/C 摘要，如"依赖：A 类 2 项（Stripe、OpenAI key）/ B 类 1 项（GitHub OAuth）"。',
      '- 末尾一句请用户点击**「确认方案」**按钮。',
      '- 禁止给代码、schema 细节、分层说明 —— 那些留到设计阶段。',
      '- 仍必须附 `<!-- progress: batch=3/3 round=4/4 mode=... -->`；若本轮无新决策就不发 `decisions`，有就继续按规则发。',
      '',
      '## 边界',
      '',
      '- brainstorm 阶段禁止写代码、贴 schema、画分层架构。',
      '- 同批的卡互相独立；有依赖关系就拆到下一批。',
      '- 禁止输出 `json:canvas-action` 块（那是设计阶段的输出）。',
      '- 如果系统消息里注入了 `## 本次 brainstorm 已知状态`，里面的 `已决策` / `外部依赖` 字段代表前面轮次已经定过的内容。**不要重新发卡问已定过的东西**；继续推进下一批，并在 `decisions` 控制注释里维持数组字段的完整最终集合。',
    ].join('\n')

    const bodyEn = [
      '# Brainstorm Phase (v2 Protocol)',
      '',
      '## Overview',
      '',
      'Drive requirement discovery through 3 batches across up to 4 rounds: WHAT (goal / users / features) → HOW (domain-specific choices) → DEPS (external-dependency clarification) → Convergence. Cards within the same batch are independent and ALL emitted in one turn. Each reply = 0..N `json:user-choice` cards + mandatory trailing control comments.',
      '',
      '## This Round',
      '',
      roundGuidanceEn,
      '',
      '## Batch Structure',
      '',
      '**Batch 1 · WHAT (round 1, always emit)**',
      '- Card 1: System goal (single choice)',
      '- Card 2: Target users & scale (single choice)',
      '- Card 3: Core features (multi-select 3-5, `multi:true, min:3, max:5`)',
      '- Plus: mode-switch card at the end of the turn (see Novice/Expert below)',
      '',
      '**Batch 2 · HOW (round 2, domain-specific)**',
      'Card content MUST be derived from batch-1 answers:',
      '- e-commerce → payments / inventory / fulfillment / marketing',
      '- personal knowledge base → LLM / embeddings / vector store / data sources',
      '- SaaS → multi-tenancy / billing / SSO / audit',
      '- fallback → tech stack / data model / integrations',
      '',
      '**Batch 3 · DEPS (round 3, only if needed)**',
      'Only ask about external dependencies that batch 2 surfaced (keys, domains, OAuth apps, procurement). If none, skip to convergence.',
      '',
      '## Option-Card Format (`json:user-choice`)',
      '',
      'Each card is one \\`\\`\\`json:user-choice fenced block. **Use EXACTLY these field names** (the client parser ignores unknown keys):',
      '',
      '```',
      '```json:user-choice',
      '{',
      '  "question": "What problem should the system solve?",',
      '  "options": ["Personal productivity", "Team collaboration SaaS", "E-commerce", "Content community", "Not sure — explain, please"]',
      '}',
      '```',
      '```',
      '',
      '**Default: `multi: true, ordered: true`** — most requirement-gathering questions are "rank by importance/relevance and pick several"; the ordering itself is a signal. Preference, feature, integration, library, and stack-composition questions should stay multi-select even if one option may become primary later. Use single-select (`multi: false`) only for genuinely mutually exclusive questions (yes/no, true either/or, strictly exclusive modes).',
      '',
      'Optional fields (use as needed):',
      '- `"multi": true` — multi-select (checkbox + submit button, **default**)',
      '- `"ordered": true` — multi-select with rank badges (①②③); the order signals priority; **enable for almost all multi-select cards**; implies `multi:true`',
      '- `"min": N` — soft hint for minimum picks',
      '- `"max": N` — hard cap; further picks disabled',
      '- `"allowCustom": true` — free-text input option',
      '- `"allowIndifferent": true` — append an "it doesn\'t matter" option, mutually exclusive',
      '- If the card is about features, preferences, integrations, libraries, or tech stack pieces, prefer `multi:true` instead of collapsing it into a single winner.',
      '',
      '**Forbidden**: nesting questions inside `options`; replacing cards with numbered markdown lists; leaving `question` outside the JSON. Every card must include at least one safety-net option — either an explicit "not sure — explain" entry, or `"allowIndifferent": true`.',
      '',
      '## Control Comments (appended to every reply)',
      '',
      '**Every turn emits `progress`:**',
      '`<!-- progress: batch=N/3 round=N/4 mode=novice|expert -->`',
      '(Use numeric `batch` 1/2/3. Convergence round still writes `batch=3/3`. `mode` reflects the current mode.)',
      '',
      '**First turn also emits `title`:**',
      '`<!-- title: Project Title -->` (≤ 15 chars)',
      '',
      '**`decisions` — only when new decisions occur this turn; follow the merge contract (hard rule — violations silently wipe user data):**',
      '- `features` (array): re-emit the **FULL final set** every turn. Client does last-write-wins replacement. Partial lists = data loss.',
      '- Any other array field (future: `integrations`, `data_sources`, etc.) is treated identically: **re-emit full set**.',
      '- `domain` / `scale` (strings): plain last-write-wins.',
      '- `tech_preferences` (object / RECORD): shallow per-key merge. Only include keys you are changing this turn; absent keys keep prior values. To explicitly clear a key, emit `{"thatKey": null}`.',
      '- If a `tech_preferences.someKey` value is itself an array (e.g. `databases: [...]`), that inner value IS replaced wholesale — re-emit the full inner array.',
      '',
      'Example: `<!-- decisions: {"domain":"ecommerce","scale":"10k MAU","features":["Browse","Cart","Checkout"],"tech_preferences":{"frontend":"Next.js"}} -->`',
      '',
      '**`externalDeps` — append-only event stream (NOT overwrite):**',
      'After each user reply, self-check "did this introduce a new external service / credential / account requirement?" If yes, append an events array this turn. The client dedupes by `service+type+envVar`.',
      '',
      'Three groups:',
      '- **A · data-input** — API keys, config values, OAuth secrets (`type:"api_key"`; user writes them into `.env`)',
      '- **B · human-action** — OAuth app registration, account signup, domain DNS (`type:"oauth_app"` etc.; user must go somewhere and act)',
      '- **C · approval** — legal / compliance / procurement (`type:"compliance"`; advisory only, does not block build)',
      '',
      'Event fields: `op` (`add` | `update` | `remove`), `service`, `type`, `status` (`needed` | `provided` | `skipped`), optional `group`, `envVar`, `action`, `docsUrl`, `notes`. Example:',
      '`<!-- externalDeps: [{"op":"add","service":"stripe","type":"api_key","status":"needed","group":"A","envVar":"STRIPE_SECRET_KEY","docsUrl":"https://stripe.com/docs/keys"}] -->`',
      'When the user later provides a key, emit `{"op":"update","service":"stripe","type":"api_key","status":"provided"}` next turn.',
      '',
      '## Novice / Expert Mode',
      '',
      '**Default: NOVICE.** In NOVICE, each option = short name + one plain-language sentence ≤ 40 chars. Example:',
      '`Stripe — US payments; great for international cards, strict entity requirements for mainland China, 0 monthly + 2.9% per txn`',
      '',
      '**Always emit a mode-switch card at the end of round 1:**',
      '```',
      '```json:user-choice',
      '{"question":"Answer style","options":["Novice mode: explain every option (default)","Expert mode: short names only"]}',
      '```',
      '```',
      'Once the user picks, the choice sticks for the whole session and is reflected in `mode=` inside progress.',
      '',
      '**TONE calibration from the user\'s first message (used only to seed the round-1 default):**',
      '- EXPERT signals: spontaneous technical names (Postgres / Qdrant / OAuth2), acronyms, enterprise jargon',
      '- NOVICE signals: plain-language goals, no tech terms, question marks',
      'The user\'s mode-switch click is the final authority.',
      '',
      '## Convergence Format (round 4 only — strict)',
      '',
      '- ≤ 150 words total. Do NOT emit any `json:user-choice` cards.',
      '- Line 1: a single confirmation sentence (e.g. "Enough info — here is the converged plan").',
      '- 3-5 bullets, each ≤ 10 words, capturing architecture highlights (e.g. "Frontend: Next.js", "Data: Postgres + Qdrant", "Payments: Stripe").',
      '- If `externalDeps` exist, add one summary line: "Deps: A×2 (Stripe, OpenAI key) / B×1 (GitHub OAuth)".',
      '- Closing sentence asks the user to click **"Start Designing"**.',
      '- No code, no schema details, no layered explanations — those belong to the design phase.',
      '- Still must emit `<!-- progress: batch=3/3 round=4/4 mode=... -->`. Skip `decisions` if nothing new; emit per-rules if something did change.',
      '',
      '## Boundaries',
      '',
      '- Brainstorm phase: no code, no schema, no layered architecture. Those belong to the design phase.',
      '- Cards in the same batch must be independent; if one depends on another, split across batches.',
      '- Do NOT emit `json:canvas-action` blocks — those are design-phase output only.',
      '- If the system message already contains a section titled `## 本次 brainstorm 已知状态` (prior-state digest), its `已决策` / `外部依赖` fields are the authoritative record of earlier rounds. **Do NOT re-ask already-decided things**; move on to the next batch, and keep array fields in `decisions` re-emitted in full.',
    ].join('\n')

    // Backend-specific prompt shape. Codex and Gemini CLIs don't accept a
    // system role — the whole stack lands in stdin as "initial instructions"
    // and competes with the CLI's own default persona. A long protocol dump
    // makes those CLIs paraphrase the protocol instead of executing it, so
    // they get a compact, task-framed variant. Custom-api and direct-api
    // (VIBE_LLM_*) deliver the stack as a real system message, so they
    // handle the detailed protocol fine.
    const useCompact = backend === 'codex' || backend === 'gemini'
    const compactBody = zh
      ? brainstormCompactZh(currentRound, isConverging, roundGuidanceZh)
      : brainstormCompactEn(currentRound, isConverging, roundGuidanceEn)
    return [
      '# Output Format',
      '',
      'Respond in Markdown. Do NOT emit any ```json:canvas-action blocks in this phase.',
      '',
      useCompact ? compactBody : (zh ? bodyZh : bodyEn),
    ].join('\n')
  }

  // canvas agent: discuss, discuss-node, analyze — all support canvas actions
  return CANVAS_ACTION_INSTRUCTIONS
}

// ---------------------------------------------------------------------------
// Brainstorm — compact variants for codex / gemini CLIs
// ---------------------------------------------------------------------------
// These CLIs eat our prompt as their "initial user instructions" and have
// their own built-in coding-agent persona. A 200-line protocol dump triggers
// a paraphrase response ("I'll help you do X, Y, Z...") instead of execution.
// The compact variant is framed as a functional task with a concrete first
// action, so the CLI's natural task-completion drive produces the cards
// directly. No identity-replacement language (avoid "you are X agent").

function brainstormCompactZh(round: number, isConverging: boolean, roundGuidance: string): string {
  if (isConverging) {
    return [
      '## 本轮任务',
      '',
      '在帮用户梳理新项目的架构需求。这是收敛轮（第 4 轮）。',
      '',
      roundGuidance,
      '',
      '## 收敛回复格式（≤150 字，禁发卡片）',
      '',
      '- 首行：一句确认（"信息已足够，下面是收敛方案"）',
      '- 3-5 条 bullet，每条 ≤ 10 字给架构要点（例："前端 Next.js"、"数据层 Postgres + Qdrant"）',
      '- 若有 externalDeps，加一行 A/B/C 摘要',
      '- 末尾一句请用户点「确认方案」',
      '- 禁止输出代码、schema、分层架构',
      '',
      '## 尾部控制注释（必附）',
      '',
      '`<!-- progress: batch=3/3 round=4/4 mode=novice|expert -->`',
      '',
      '若本轮无新决策，不发 `decisions`；有就按规则发。',
    ].join('\n')
  }

  return [
    '## 本轮任务',
    '',
    '在帮用户梳理新项目的架构需求。思维原则：第一性原理、奥卡姆剃刀、YAGNI、Conway 定律、Brooks 的本质复杂度。',
    '',
    '按 3 个批次推进：WHAT（第 1 轮）→ HOW（第 2 轮）→ DEPS（第 3 轮）→ 收敛（第 4 轮）。',
    '',
    roundGuidance,
    '',
    '本轮回复直接输出选项卡，不要写"好的，让我帮你..."这类开场白——开场白不会被前端渲染成卡片。',
    '',
    '## 选项卡格式（`json:user-choice`）',
    '',
    '每个问题 = 一个独立的 ```json:user-choice 代码块。前端只解析这种代码块，markdown 标题/编号列表不渲染成卡。',
    '',
    '示例：',
    '',
    '```',
    '```json:user-choice',
    '{',
    '  "question": "要解决什么问题？",',
    '  "options": ["个人效率工具", "团队协作", "电商平台", "不懂，请解释"]',
    '}',
    '```',
    '```',
    '',
    '**默认 `multi: true, ordered: true`** — 大多数需求梳理题都是"按重要度/相关度排序选几个"，排序本身就是信号。单选（`multi: false`）仅用于真正互斥的题（是/否、二选一的技术栈、严格互斥的模式）。',
    '',
    '可选字段：`multi: true`（多选/checkbox，**默认**）、`ordered: true`（带排序 ①②③，**默认**，隐含 multi）、`min`/`max`（多选上下限）、`allowCustom: true`（追加"其他（自己填）"输入框）、`allowIndifferent: true`（追加"无所谓"选项）。',
    '',
    '每张卡至少含一个兜底项——要么一个"不懂，请解释"/"其他"选项，要么 `allowIndifferent: true`。',
    '',
    '## 首轮附加：模式开关卡（仅第 1 轮末尾）',
    '',
    round === 1
      ? '本轮（第 1 轮）末尾加一张模式开关卡：'
      : '（已过首轮，不必再发。）',
    ...(round === 1 ? [
      '',
      '```',
      '```json:user-choice',
      '{"question":"回答风格","options":["新手模式：每个选项都解释（默认）","老手模式：只列短名"]}',
      '```',
      '```',
    ] : []),
    '',
    '## 尾部控制注释（必附）',
    '',
    '每轮末尾必附：`<!-- progress: batch=N/3 round=N/4 mode=novice|expert -->`',
    '',
    round === 1 ? '第 1 轮额外附：`<!-- title: ≤15字项目标题 -->`' : '',
    '',
    '若本轮产生新决策，追加：`<!-- decisions: {...} -->`',
    '- `features` 数组每轮必须重发完整最终集合（客户端做覆盖合并；部分列表 = 丢数据）',
    '- `tech_preferences` 按 key 浅合并；要清除某 key 显式发 `{"key": null}`',
    '- `domain` / `scale` 字符串正常覆写',
    '',
    '若本轮引入新外部依赖，追加：`<!-- externalDeps: [{"op":"add","service":"...","type":"...","status":"needed","group":"A|B|C",...}] -->`（追加不覆盖；客户端按 service+type+envVar 去重）。',
    '',
    '## 边界',
    '',
    '- 禁止在本阶段写代码、贴 schema、画分层架构——那是设计阶段。',
    '- 禁止输出 `json:canvas-action` 块。',
    '- 若 system 消息里已注入「## 本次 brainstorm 已知状态」，里面的已决策内容**不要再发卡重问**，继续推进下一批。数组字段在 `decisions` 里维持完整最终集合。',
  ].filter(Boolean).join('\n')
}

function brainstormCompactEn(round: number, isConverging: boolean, roundGuidance: string): string {
  if (isConverging) {
    return [
      '## This Round',
      '',
      'Helping the user scope a new project\'s architecture. This is the convergence round (round 4).',
      '',
      roundGuidance,
      '',
      '## Convergence Reply (≤ 150 words, NO cards)',
      '',
      '- Line 1: one confirming sentence ("Enough info — here is the converged plan")',
      '- 3-5 short bullets (≤ 10 words each) with architecture highlights (e.g. "Frontend: Next.js", "Data: Postgres + Qdrant")',
      '- If externalDeps exist, add one line: "Deps: A×2 / B×1 / C×0"',
      '- Close with a sentence asking the user to click "Start Designing"',
      '- No code, no schema details, no layered architecture',
      '',
      '## Trailing Control Comment (required)',
      '',
      '`<!-- progress: batch=3/3 round=4/4 mode=novice|expert -->`',
      '',
      'If no new decisions this turn, skip `decisions`; emit per the rules if something changed.',
    ].join('\n')
  }

  return [
    '## This Round',
    '',
    'Helping the user scope a new project\'s architecture. Guiding principles: first principles, Occam\'s razor, YAGNI, Conway\'s law, Brooks\'s essential complexity.',
    '',
    'Progress through 3 batches: WHAT (round 1) → HOW (round 2) → DEPS (round 3) → Convergence (round 4).',
    '',
    roundGuidance,
    '',
    'This turn must directly emit the cards. Do NOT write "Sure, let me help you..." — preamble is not rendered as cards by the UI.',
    '',
    '## Option-Card Format (`json:user-choice`)',
    '',
    'Each question = one independent ```json:user-choice fenced block. The UI only parses these blocks; markdown headings / numbered lists are NOT rendered as cards.',
    '',
    'Example:',
    '',
    '```',
    '```json:user-choice',
    '{',
    '  "question": "What problem should the system solve?",',
    '  "options": ["Personal productivity", "Team collaboration", "E-commerce", "Not sure — explain, please"]',
    '}',
    '```',
    '```',
    '',
    '**Default: `multi: true, ordered: true`** — most requirement-gathering questions are "rank by importance/relevance and pick several"; the ordering itself is a signal. Preference, feature, integration, library, and stack-composition questions should stay multi-select even if one option may become primary later. Use single-select (`multi: false`) only for genuinely mutually exclusive questions (yes/no, true either/or, strictly exclusive modes).',
    '',
    'Optional fields: `multi: true` (checkbox, **default**), `ordered: true` (ranked ①②③, **default**, implies multi), `min`/`max` (picks bounds), `allowCustom: true` (append a free-text input), `allowIndifferent: true` (append a "doesn\'t matter" option).',
    'If the card is about features, preferences, integrations, libraries, or tech stack pieces, prefer `multi:true` instead of collapsing it into a single winner.',
    '',
    'Each card must include at least one safety-net option — either an explicit "not sure / explain" entry, or `allowIndifferent: true`.',
    '',
    '## Round-1 Extra: Mode-Switch Card',
    '',
    round === 1
      ? 'At the end of this round (round 1), also emit a mode-switch card:'
      : '(Already past round 1; do not emit again.)',
    ...(round === 1 ? [
      '',
      '```',
      '```json:user-choice',
      '{"question":"Answer style","options":["Novice mode: explain every option (default)","Expert mode: short names only"]}',
      '```',
      '```',
    ] : []),
    '',
    '## Trailing Control Comments (required)',
    '',
    'Every turn must end with: `<!-- progress: batch=N/3 round=N/4 mode=novice|expert -->`',
    '',
    round === 1 ? 'Round 1 additionally emits: `<!-- title: ≤15-char project title -->`' : '',
    '',
    'When new decisions occur this turn, append: `<!-- decisions: {...} -->`',
    '- `features` array must be re-emitted as the FULL current set every turn (client does last-write-wins replacement; partial list = data loss)',
    '- `tech_preferences` is shallow per-key merge; to clear a key emit `{"key": null}`',
    '- `domain` / `scale` are plain strings, last-write-wins',
    '',
    'When new external deps are introduced, append: `<!-- externalDeps: [{"op":"add","service":"...","type":"...","status":"needed","group":"A|B|C",...}] -->` (append-only; client dedupes by service+type+envVar).',
    '',
    '## Boundaries',
    '',
    '- No code, no schema, no layered architecture in this phase — that\'s the design phase.',
    '- Do NOT emit `json:canvas-action` blocks.',
    '- If the system message already contains a "## 本次 brainstorm 已知状态" digest, already-decided items there MUST NOT be re-asked — advance to the next batch. Keep array fields re-emitted in full in `decisions`.',
  ].filter(Boolean).join('\n')
}

// ---------------------------------------------------------------------------
// Lean canvas prompt — used for the Claude Code backend.
//
// Assembled from composable per-turn sections driven by session state, NOT a
// hard-coded template. CC caches its CLAUDE.md + skills across turns, so the
// stable invariants (thinking principles, output discipline, skill routing)
// live there. This prompt carries only what changes turn-to-turn:
// phase+round marker, canvas YAML, focused node, code context, build summary,
// conversation history, and a phase-specific closing instruction.
//
// Future hooks: pass extra `leanPromptToggles` keys (e.g. `forceSkillThisTurn`,
// `brainstormConcluded`) to flip sections on/off as UI state evolves — the
// composer already iterates opt-in sections, so adding one is adding a key.
// ---------------------------------------------------------------------------

interface LeanCanvasPromptOpts {
  locale: Locale
  canvasYaml?: string
  selectedNodeContext?: string
  conversationHistory?: string
  codeContext?: string
  buildSummaryContext?: string
  sessionPhase?: SessionPhase
  /** Turn number within brainstorm phase (1-based). Used to vary the opener: round 1 forces skill invocation; subsequent rounds assume CC is already on track. */
  brainstormRound?: number
}

function buildLeanCanvasPrompt(opts: LeanCanvasPromptOpts): string {
  const {
    locale,
    canvasYaml,
    selectedNodeContext,
    conversationHistory,
    codeContext,
    buildSummaryContext,
    sessionPhase,
    brainstormRound,
  } = opts
  const zh = locale === 'zh'

  const sections: Array<string | null> = [
    leanPhaseMarker(sessionPhase, brainstormRound, zh),
    labeledSection(zh ? '当前架构' : 'Current architecture', canvasYaml ? '```yaml\n' + canvasYaml + '\n```' : undefined),
    labeledSection(zh ? '当前聚焦节点' : 'Focused node', selectedNodeContext),
    labeledSection(zh ? '相关代码' : 'Related code', codeContext),
    labeledSection(zh ? '最近的构建摘要' : 'Recent build summary', buildSummaryContext),
    labeledSection(zh ? '之前的讨论' : 'Earlier conversation', conversationHistory),
    leanClosingInstruction(sessionPhase, zh),
  ]

  return sections.filter((s): s is string => typeof s === 'string' && s.length > 0).join('\n\n')
}

/** One-line phase + turn label. CC's CLAUDE.md routes on this. */
function leanPhaseMarker(phase: SessionPhase | undefined, round: number | undefined, zh: boolean): string {
  if (phase === 'brainstorm') {
    const r = round ?? 1
    if (zh) {
      return r === 1
        ? 'Phase: brainstorm / 第 1 轮。按 archviber-brainstorm 技能的 v2 协议走，立刻发 Batch 1 的选项卡。'
        : `Phase: brainstorm / 第 ${r} 轮。继续用 archviber-brainstorm 技能流程，按 state 里的 currentBatch 推进。`
    }
    return r === 1
      ? 'Phase: brainstorm / round 1. Follow the archviber-brainstorm skill (v2 protocol). Emit the Batch 1 option cards right away.'
      : `Phase: brainstorm / round ${r}. Continue the archviber-brainstorm skill flow; advance per the currentBatch in the injected state.`
  }
  if (phase === 'design') {
    return zh
      ? 'Phase: design / 设计阶段。现在需要把 brainstorm 收敛的方案画成架构图，用 archviber-canvas 技能输出 json:canvas-action 块。'
      : 'Phase: design. Turn the converged brainstorm plan into a diagram via the archviber-canvas skill (json:canvas-action blocks).'
  }
  if (phase === 'iterate') {
    return zh
      ? 'Phase: iterate / 迭代阶段。基于当前架构做局部修改；涉及改图时用 archviber-canvas 技能。'
      : 'Phase: iterate. Make targeted changes to the current architecture; use the archviber-canvas skill when editing the diagram.'
  }
  return zh
    ? '讨论架构与上下文。'
    : 'Discuss the architecture and context.'
}

function leanClosingInstruction(phase: SessionPhase | undefined, zh: boolean): string {
  if (phase === 'brainstorm') {
    // Brainstorm closes with the skill's own convergence rules — no extra
    // instruction needed here; adding one risks contradicting the skill.
    return ''
  }
  return zh
    ? '用自然语言回答。要改架构（加/删/改节点、连边）就用 archviber-canvas 技能按它的格式输出 json:canvas-action 块；只是讨论和分析不要输出 JSON。'
    : "Answer in natural prose. For diagram edits (add / remove / modify blocks or edges), use the archviber-canvas skill and emit json:canvas-action blocks per its spec. For pure discussion, don't emit JSON."
}

/** Emit "## Header\n\nbody" only when body is a non-empty string. */
function labeledSection(header: string, body?: string): string | null {
  if (!body || body.length === 0) return null
  return `## ${header}\n\n${body}`
}

// ---------------------------------------------------------------------------
// Main assembler
// ---------------------------------------------------------------------------

export function buildSystemContext(options: ContextOptions): string {
  const {
    agentType,
    task,
    locale,
    skillContent,
    canvasYaml,
    selectedNodeContext,
    conversationHistory,
    taskParams = {},
    codeContext,
    buildSummaryContext,
    sessionPhase,
    brainstormRound,
    backend,
    ir,
  } = options

  // Resolve IR → YAML string, with Zod re-validation as a safety net.
  // Failures warn and fall back to canvasYaml so behavior is unchanged.
  let irYaml: string | undefined
  if (ir != null) {
    try {
      const validated = irSchema.parse(ir)
      irYaml = serializeIr(validated)
    } catch (err) {
      console.warn('[context-engine] IR validation failed, falling back to canvasYaml:', err)
    }
  }

  // Lean mode: when sending to Claude Code as a canvas-chat companion, emit
  // a prompt that reads like something a human user would naturally paste
  // into a terminal — no layer markers, no output-format contract. The
  // trade-off is that CC in this mode won't emit canvas-action JSON blocks;
  // it becomes a prose-only advisor. Users who want in-canvas edits should
  // pick a backend that runs with full context (Codex / Gemini / custom-api).
  if (!shouldUseFullContext(backend, agentType)) {
    return buildLeanCanvasPrompt({
      locale,
      canvasYaml: irYaml ?? canvasYaml,
      selectedNodeContext,
      conversationHistory,
      codeContext,
      buildSummaryContext,
      sessionPhase,
      brainstormRound,
    })
  }

  // Canvas agent: no skills. Skills are a build agent feature.
  // Canvas uses flat prompts (brainstorm) or canvas-action format (design/iterate).
  const resolvedSkill = agentType === 'build'
    ? (skillContent ?? resolveSkillContent(agentType, task, taskParams.techStack, sessionPhase))
    : undefined

  // Brainstorm phase: use full layer stack but with brainstorm-specific L7.
  // This matches the original "silky" version that worked well.

  const layers: Array<string | null> = [
    layerLanguage(locale),                                                          // L0
    layerIdentity(),                                                                // L1
    task === 'discuss' || task === 'discuss-node'                                  // L2
      ? layerHistory(conversationHistory)
      : null,
    layerCanvasState(canvasYaml, selectedNodeContext, buildSummaryContext, codeContext, irYaml), // L3
    layerTask(task, taskParams),                                                    // L4
    layerSkills(resolvedSkill),                                                       // L5
    layerConstraints(agentType, taskParams),                                        // L6
    layerOutputFormat(agentType, task, locale, sessionPhase, brainstormRound, backend),               // L7
  ]

  return layers.filter(Boolean).join('\n\n')
}

/**
 * Resolve and merge skills for the given agent context.
 * Maps agent type + task to scope, then delegates to skill-loader.
 * Only works server-side (skill-loader uses fs).
 */
export function resolveSkillContent(
  agentType: AgentType,
  task?: TaskType,
  techStack?: string,
  _phase?: SessionPhase
): string | undefined {
  // Skills are only for build agents. Canvas agent uses flat prompts.
  if (agentType === 'canvas') return undefined

  // skill-loader uses 'fs' — only available server-side
  if (typeof window !== 'undefined') return undefined

  const scope: 'global' | 'node' =
    task === 'discuss' || task === 'import' || task === 'import-enhance' || task === 'analyze'
      ? 'global'
      : 'node'

  try {
    // Use eval('require') to prevent the bundler from analyzing this import
    // and pulling 'fs' into the client bundle
    // eslint-disable-next-line no-eval
    const loader = eval("require('./skill-loader')") as {
      resolveSkillContent: (agentType: 'canvas' | 'build', scope: 'global' | 'node', techStack?: string) => string | undefined
    }
    return loader.resolveSkillContent(agentType, scope, techStack)
  } catch {
    return undefined
  }
}
