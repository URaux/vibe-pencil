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
  '',
  'CRITICAL RULES:',
  '- You MUST include add-edge actions to connect related blocks. An architecture without edges is incomplete.',
  '- Every block that communicates with another block MUST have an edge.',
  '- Only create edges between block nodes (not containers).',
  '- Put ALL ```json:canvas-action blocks FIRST, then explanation text AFTER.',
  '- Each code block contains exactly ONE JSON action.',
  '- Do NOT skip canvas-action blocks. If the user describes a system, ALWAYS generate them.',
].join('\n')

function layerOutputFormat(agentType: AgentType, task: TaskType, locale: Locale, sessionPhase?: SessionPhase, brainstormRound?: number): string {
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

  // canvas agent in brainstorm phase: structured dimensions + convergence
  if (sessionPhase === 'brainstorm') {
    // Round number passed from server (counted from structured history array)
    const currentRound = brainstormRound ?? 1
    const maxRounds = 8

    const dimensionsZh = [
      '1. 项目类型和核心目标 — 这个系统要解决什么问题？',
      '2. 目标用户和规模 — 谁在用？预期多大量级？',
      '3. 核心功能模块 — 最重要的 3-5 个功能是什么？',
      '4. 技术栈偏好 — 有没有必须用或不能用的技术？',
      '5. 数据模型/关键实体 — 核心数据长什么样？主要的表/实体有哪些？',
      '6. 集成和约束条件 — 要对接哪些外部系统？有什么硬性限制？',
    ].join('\n')

    const dimensionsEn = [
      '1. Project type & core goal — What problem does this system solve?',
      '2. Target users & scale — Who uses it? Expected scale?',
      '3. Core features / modules — Top 3-5 features?',
      '4. Tech stack preferences — Any must-use or must-avoid technologies?',
      '5. Data model / key entities — What does the core data look like?',
      '6. Integrations & constraints — External systems? Hard limitations?',
    ].join('\n')

    const convergenceZh = currentRound <= 6
      ? `当前是第 ${currentRound} 轮（共最多 ${maxRounds} 轮）。按维度顺序推进，每次只问 1 个问题。如果用户的回答已覆盖某个维度，直接跳到下一个。`
      : currentRound < maxRounds
        ? `当前是第 ${currentRound} 轮（共最多 ${maxRounds} 轮）。时间紧迫，总结你已了解的内容，只针对关键缺失信息追问。`
        : `已达第 ${maxRounds} 轮。不要再提问，也不要输出冗长的架构文档。严格按以下格式回复（全文 150 字以内）：第 1 行明确"信息已足够收敛"；然后用 3-5 个 bullet 列出架构要点（每条 ≤ 20 字，例如"前端 Next.js"、"数据层 Postgres + Qdrant"）；最后一句请用户点击"确认方案"按钮。禁止给出代码、schema 细节或展开说明。`

    const convergenceEn = currentRound <= 6
      ? `This is round ${currentRound} of ${maxRounds}. Progress through dimensions in order, 1 question per turn. If user's answer already covers a dimension, skip to the next.`
      : currentRound < maxRounds
        ? `This is round ${currentRound} of ${maxRounds}. Time is short — summarize what you know, only ask about CRITICAL gaps.`
        : `Round ${maxRounds} reached. Do NOT ask any more questions and do NOT dump a long architecture document. Reply in under ~150 words: line 1 state "Information gathered is sufficient"; then 3-5 bullets capturing the architecture outline (each ≤ 10 words, e.g. "Frontend: Next.js", "Data: Postgres + Qdrant"); close with one sentence asking the user to click "Start Designing". Do not include code, schema details, or expansions.`

    return [
      '# Output Format',
      '',
      'Respond in Markdown only. Do NOT generate any ```json:canvas-action blocks.',
      '',
      locale === 'zh' ? '# 需求讨论阶段' : '# Brainstorm Phase',
      '',
      locale === 'zh'
        ? '你需要覆盖以下 6 个维度来理解项目需求：'
        : 'You must cover these 6 dimensions to understand the project:',
      '',
      locale === 'zh' ? dimensionsZh : dimensionsEn,
      '',
      locale === 'zh' ? '## 进度与收敛规则' : '## Progress & Convergence Rules',
      '',
      locale === 'zh' ? convergenceZh : convergenceEn,
      '',
      locale === 'zh'
        ? [
            '严格每次只问 1 个问题。如果有明确选项，用编号列出 2-4 个选项供用户选择。选项中不要混入问题。',
            '',
            '在每次回复末尾，用 HTML 注释标记进度（对用户不可见）：',
            '<!-- progress: dimensions_covered=N/6 round=N/8 -->',
            '',
            '在你的第一次回复末尾，额外输出标题：<!-- title: 项目标题 -->（不超过15字）。',
            '',
            '当所有维度覆盖完毕或轮次用尽时，不要写长篇架构方案。严格按以下格式收敛（全文 ≤150 字）：首行写"信息已足够收敛"；中间 3-5 个 bullet 给架构要点（每条 ≤ 20 字）；末尾一句提示用户点击"确认方案"按钮。禁止展开代码、schema 细节或分层说明——那些留到设计阶段生成。',
          ].join('\n')
        : [
            'STRICTLY ask only 1 question per response. When there are clear options, list 2-4 numbered choices. Do NOT mix questions into option lists.',
            '',
            'At the end of every response, add an invisible HTML comment tracking progress:',
            '<!-- progress: dimensions_covered=N/6 round=N/8 -->',
            '',
            'At the end of your first response, also output: <!-- title: Project Title --> (max 15 chars).',
            '',
            'When all dimensions are covered or rounds are exhausted, do NOT write a long proposal. Reply in ≤150 words: line 1 = "Information gathered is sufficient", 3-5 short bullets with the architecture outline (≤10 words each), closing line asking the user to click "Start Designing". No code, no schema details, no layered explanations — those belong to the design phase.',
          ].join('\n'),
    ].filter(Boolean).join('\n')
  }

  // canvas agent: discuss, discuss-node, analyze — all support canvas actions
  return CANVAS_ACTION_INSTRUCTIONS
}

// ---------------------------------------------------------------------------
// Lean canvas prompt — used for Claude Code to avoid harness fingerprinting.
// ---------------------------------------------------------------------------

function buildLeanCanvasPrompt(opts: {
  locale: Locale
  canvasYaml?: string
  selectedNodeContext?: string
  conversationHistory?: string
  codeContext?: string
  buildSummaryContext?: string
}): string {
  const { locale, canvasYaml, selectedNodeContext, conversationHistory, codeContext, buildSummaryContext } = opts
  const zh = locale === 'zh'

  const parts: string[] = []

  parts.push(
    zh
      ? '我在设计一个软件架构，下面是当前的结构和上下文。帮我一起讨论和迭代。'
      : "I'm designing a software architecture. Below is the current state and context — please help me reason through it.",
  )

  if (canvasYaml) {
    parts.push(zh ? '当前架构：' : 'Current architecture:')
    parts.push('```yaml\n' + canvasYaml + '\n```')
  }

  if (selectedNodeContext) {
    parts.push(zh ? '当前聚焦节点：' : 'Focused node:')
    parts.push(selectedNodeContext)
  }

  if (codeContext) {
    parts.push(zh ? '相关代码：' : 'Related code:')
    parts.push(codeContext)
  }

  if (buildSummaryContext) {
    parts.push(zh ? '最近的构建摘要：' : 'Recent build summary:')
    parts.push(buildSummaryContext)
  }

  if (conversationHistory) {
    parts.push(zh ? '之前的讨论：' : 'Earlier conversation:')
    parts.push(conversationHistory)
  }

  parts.push(
    zh
      ? '用自然语言回答。如果用户希望你"改架构 / 加节点 / 删节点 / 连边"，就调用 archviber-canvas 技能按它描述的格式输出 JSON 块；只是讨论和分析的话不要输出 JSON。请用中文回复。'
      : "Answer in natural prose. If the user asks to edit the diagram (add / remove / modify blocks or edges), use the archviber-canvas skill and emit JSON blocks exactly as the skill describes. For pure discussion, don't emit JSON.",
  )

  return parts.join('\n\n')
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
    layerOutputFormat(agentType, task, locale, sessionPhase, brainstormRound),                       // L7
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
