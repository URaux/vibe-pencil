# ArchViber Phase 1 — Codex Review

> Codex 在只读沙箱无法直接写此文件，内容由 Claude 根据 Codex 的 stdout 转录落盘。
> Task ID: task-mnyuuozk-0ur20n
> 完成时间: 2026-04-14T16:54:31Z

## Verdict

**NO-GO**。计划存在三处前提错误，必须先修后才能开工。

## Top Findings (severity-sorted)

### Critical

**1. IR 迁移设计自相矛盾**
`IR-SCHEMA.md` 里的 migrator/reverse 伪代码会改写 ID、丢掉 `ungrouped` orphan 语义，和 `PLAN.md` 要求的 "lossless round-trip / reopen byte-identical" 直接冲突。
Evidence: `PLAN.md:14,66,109`, `IR-SCHEMA.md:199-205,214,240,281-312`
如果先按这个方案做，后续 persistence 全建在错误语义上。

**2. 路由/持久会话现状判断错误**
计划把 persistent chat 说成"未来用一个 env flag 开关"，但现状代码里 `claude-code` 已经默认走 `handlePersistentChat()`，`src/app/api/chat/route.ts:441` 也不是计划声称的那个 TODO。
Evidence: `PLAN.md:285-288`, `ORCHESTRATOR-ROUTING.md:275-279`, `src/app/api/chat/route.ts:324-456`
Orchestrator/persistent 的接入顺序会被误导。

> 注：此 review 在 task-mnyu9dam-s63gde（session fix）完成后 ~9 分钟执行。Codex 观察到的"claude-code 已默认走 handlePersistentChat"可能是 session-fix 刚刚 re-enable 的结果——此时计划文档尚未 sync 到新现实。

### High

**3. Week 2 严重过载**
W2 把 tree-sitter、ts-morph、Louvain、code_anchors、rename、sandbox、PR 全压进一周。按现有代码面和验证面看明显偏乐观。

**4. Eval golden 单一 FastAPI repo 覆盖不足**
单个 FastAPI 不足以覆盖当前 Next.js/React 主路径与自举导入验收。
Evidence: `PLAN.md:232-245,265-270`, `src/lib/project-scanner.ts:293-361`, `src/lib/skeleton-generator.ts:266-309`

## 建议修改（至少 3 条）

### 1. 先重写 migrator/reverse 方案

**What**: 修正 IR ↔ SchemaDocument 的双向转换规则，明确 ID preservation 与 orphan block round-trip 语义。
**Why**: 当前伪代码会静默改写 ID 和丢失 ungrouped 节点，与 PLAN.md 声明的 lossless 要求冲突。
**Impact on plan**: W1.D1 前必须完成新方案的设计评审。可能需要延长 W1 半到一天。

### 2. 把 Week 2 拆成两个 checkpoint

**What**: W2 拆为 `W2a: ingest/code_anchors`（tree-sitter + ts-morph + Louvain + anchors）与 `W2b: modify rename`（ts-morph rename + sandbox + PR）。Windows worktree/junction 验证从 W2.D8 前移到 W2.D1。
**Why**: 两件事内部依赖紧但跨 checkpoint 独立，并行或延后一个都比混做可控。Windows 验证前移避免末尾爆雷。
**Impact on plan**: 保留 3 周总预算，但 W2→W3 之间插入 mid-sprint checkpoint；若 W2a 滑坡则 W2b 顺延为 W3 起点，W3 现有任务挤压。

### 3. deep_analyze 路线定死

**What**: 明确 deep_analyze 是用 `agentRunner` 还是 native CC Task。把 agent 文件位置（项目内 `.claude/agents/` 还是用户级 `~/.claude/agents/`）、Task output file 路径、限流策略一次性写清楚。
**Why**: PLAN.md 与 ORCHESTRATOR-ROUTING.md 的描述模糊，NATIVE-CC-RESEARCH.md 推荐用 Task 但未敲定集成位置。实施时歧义会扩散。
**Impact on plan**: W3.D1 前补足 deep_analyze 实施细节文档（1-2 小时），不影响整体时间线。

## 开工判断

**NO-GO**。开工前必须先修的动作：

1. IR migrator/reverse 方案重写，保证 ID 稳定与 orphan 语义
2. PLAN.md 的"persistent chat 是未来 env flag"描述 sync 到 session-fix 已 re-enable 的新现实
3. deep_analyze 实施细节敲定
4. Eval golden 集合扩展方案（至少给出 FastAPI + Next.js + 自举 ArchViber 三个最小集的增量计划）
5. W2 拆分 checkpoint

## 未写入的材料

Codex 当前会话为只读沙箱 + `apply_patch` 拒绝工作区外绝对路径，因此：
- 本 `CODEX-REVIEW.md` 由 Claude 转录落盘
- 按 8 维度展开的完整评估未写入（Codex 输出 summary 后终止），如需完整 review 需再跑一次 review 任务并授予写权限

## 参照文档

- 计划文档: `.planning/phase1/PLAN.md`, `IR-SCHEMA.md`, `ORCHESTRATOR-ROUTING.md`, `MODIFY-AGENT-DESIGN.md`
- 研究文档: `.planning/phase1/NATIVE-CC-RESEARCH.md`, `SKILL-PASSTHROUGH-RESEARCH.md`
- Session 修复报告: `.planning/persistent-session/FIX-REPORT.md`（Codex task-mnyu9dam-s63gde）
