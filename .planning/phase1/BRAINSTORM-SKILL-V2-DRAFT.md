# Brainstorm Skill V2 — Draft

> 草案，待用户审阅后再合入 `src/lib/cc-native-scaffold.ts` 的 `CANVAS_BRAINSTORM_SKILL_MD` 常量。

## Changes vs v1

- **批量提问**：从「一轮一问，6 维度顺序走」改为「按 WHAT/HOW/DEPS 三层批量发卡」，每批一轮内并发多张选项卡。
- **外部依赖横切**：不再当第 7 维顺序追问，而是每答必内省、按需插卡，并在回复尾累积 `<!-- externalDeps: [...] -->`。
- **新手 / 老手分层**：默认 NOVICE，每张卡附白话解释；首轮末尾给一个会话级开关切到 EXPERT；任何模式都保留「不懂，请解释」兜底项。

## Proposed SKILL.md body

```markdown
---
name: archviber-brainstorm
description: Use when the user starts a new architecture discussion or has not yet confirmed a design. Batches requirement discovery into WHAT / HOW / DEPS layers, surfaces external-dependency needs as they emerge, and adapts vocabulary to the user's expertise level.
---

# 需求讨论协议 v2

按 3 个批次推进，最多 4 轮。每批是一条助手消息里多张 `json:user-choice` 卡。独立维度同批并发，依赖关系才串行。

## 批次结构

**Batch 1 · WHAT 层（首轮，恒发）**
3 张卡，互相独立：

1. 目标（系统要解决什么问题）
2. 用户与规模（谁用、量级）
3. 核心功能（3-5 个，多选）

**Batch 2 · HOW 层（第 2 轮，按 batch1 的领域定形）**
3-4 张卡，领域相关：

- 电商：支付 / 库存 / 物流 / 营销
- 个人知识库：LLM / Embedding / 向量库 / 数据源
- SaaS：多租户 / 计费 / SSO / 审计
- 通用兜底：技术栈 / 数据模型 / 集成
卡片同批并发，但内容必须由 batch1 的答案推导，不要发与领域无关的卡。

**Batch 3 · DEPS 澄清（第 3 轮，仅当需要）**
0-4 张卡，专问 batch2 暴露出来的外部依赖（key、域名、OAuth 应用、采购审批等）。没有就跳过。

**收敛轮（第 4 轮）**
≤ 150 字，3-5 条 bullet 给架构要点（每条 ≤ 10 字），并列出 `externalDeps` 摘要（A / B / C 各几项）。最后一句让用户点「确认方案」。

## 选项卡格式（json:user-choice）

每张卡是一个 \`\`\`json:user-choice 代码块。最小字段：

\`\`\`json
{
  "question": "选哪个支付方案？",
  "options": ["Stripe", "支付宝 + 微信", "Paddle", "不懂，请解释"]
}
\`\`\`

多选用 `"multi": true`，前端渲染为 checkbox：

\`\`\`json
{
  "question": "核心功能选 3-5 个",
  "multi": true,
  "min": 3,
  "max": 5,
  "options": ["浏览商品", "购物车", "下单支付", "订单跟踪", "评价", "推荐"]
}
\`\`\`

每张卡至少 1 个「不懂，请解释」兜底项（NOVICE 必带；EXPERT 也保留）。
选项里禁止再嵌问题；问题写在 `question` 字段。

## decisions 合并语义（硬约束）

每轮回复里承载的 `decisions` 字段由客户端做 **last-write-wins 合并**，不是增量补丁。LLM 必须遵守以下规则，否则用户已选内容会被清空：

- **`decisions.features`（数组，3-5 个核心功能的多选结果）**：每轮必须重发 **完整最终集合**。禁止只发本轮新增项或本轮改动项作为补丁 —— 客户端会整体覆盖上一轮的 `features`，部分列表等于丢数据。
- **其他数组型字段同理**：凡是数组（如 future 里可能新增的 `integrations`、`data_sources` 等多选结果）都按「每轮重发完整集合」处理，LLM 不得发部分列表。
- **`decisions.domain` / `decisions.scale`（字符串）**：字符串本身就是 last-write-wins，正常覆写即可，无特殊约束。
- **`decisions.tech_preferences`（RECORD / 对象）**：做 **浅合并**，即按 key 逐项 last-write-wins；未出现的 key 保留上一轮值，出现的 key 整体覆写其 value。因此：
  - 新增 / 修改某个偏好：只需在本轮 `tech_preferences` 里带上那一个 key。
  - 要清除某个偏好：显式发 `{"该key": null}`，不要靠「本轮不带就删」—— 不带 = 保留。
  - 单个 key 的 value 若本身是数组（如 `tech_preferences.databases: [...]`），该 value 内部仍是整组覆写，需重发完整集合。

一句话：**数组整组重发，对象按 key 覆写，想删就发 null。**

## 新手 / 老手模式

**默认 NOVICE。** 每个选项 = 短名 + 一句白话解释，长度 ≤ 40 字：
> `Stripe — 美国支付公司，国际卡好但国内主体要求高，月费 0、每笔 2.9%`

**首轮末尾恒发模式开关卡**：
\`\`\`json
{
  "question": "回答风格",
  "options": ["新手模式：每个选项都解释（默认）", "老手模式：只列短名"]
}
\`\`\`
用户选了之后整个会话粘住，记录到回复尾的 `<!-- mode: novice|expert -->`。

**校准信号（仅看用户首条消息的 TONE，不看后续选项命中的词）**：
- EXPERT 线索：主动出现具体技术名（Postgres / Qdrant / OAuth2）、缩写、企业黑话
- NOVICE 线索：白话描述目标、零技术词、问句

校准只用于猜首轮的默认值，最终以用户点开关为准。

## 外部依赖横切

每收到用户答复，内省一次：「这一步是否引入了外部服务 / 凭证 / 账号需求？」是 → 下一批补一张依赖澄清卡。

依赖三类：

- **A · data-input** — API key、配置值、OAuth secret（用户填进 .env 即可）
- **B · human-action** — OAuth 应用注册、账号开通、域名 / DNS、支付主体（要用户去某处操作）
- **C · approval** — 法务 / 合规 / 采购流程（不阻塞构建，提示即可）

每次回复尾累积一条 HTML 注释，**追加不覆盖**：

\`\`\`
<!-- externalDeps: [
  {"type":"api_key","group":"A","service":"stripe","status":"needed","envVar":"STRIPE_SECRET_KEY","docsUrl":"https://stripe.com/docs/keys"},
  {"type":"oauth_app","group":"B","service":"github","status":"needed","action":"在 github.com/settings/developers 注册 OAuth App","docsUrl":"..."},
  {"type":"compliance","group":"C","service":"icp_filing","status":"advisory","note":"国内主体上线前需 ICP 备案"}
] -->
\`\`\`

`status` 取值：`needed | provided | advisory`。用户在卡里给出值后改成 `provided`。

## 进度标记

每次回复尾固定附：
\`<!-- progress: batch=N/3 round=N/4 mode=novice|expert -->\`

首轮额外：
\`<!-- title: 项目标题 -->\`（≤ 15 字）

## 边界

- 禁止在 brainstorm 阶段写代码、贴 schema、画分层架构 —— 那些留给 design 阶段。
- 同批的卡互相独立；有依赖就拆到下一批。
- 第 4 轮必须收敛，不再发卡。
```

## json:user-choice schema 提案

当前前端 (`src/lib/chat-actions.ts:101-110`) 只读 `question` + `options`，多选字段需要前端配合扩展。建议形状：

```ts
interface UserChoice {
  question: string
  options: string[]
  multi?: boolean      // 默认 false → radio；true → checkbox
  min?: number         // multi=true 时最少选几个，默认 1
  max?: number         // multi=true 时最多选几个，默认 options.length
}
```

向后兼容：旧字段不变，新字段可选；`extractUserChoices` 透传 `multi/min/max`，`OptionCards` 收到 `multi=true` 时渲染 checkbox + 「提交」按钮，单击提交把选中项以 `、` 拼成一条 user 消息（或 JSON 列表，看回填策略）。

提交回填两种候选，待用户拍板：

- **A · 顿号拼接**：`"购物车、下单支付、订单跟踪"` —— 简单，模型读得懂
- **B · 编号列表**：`"1. 购物车\n2. 下单支付\n3. 订单跟踪"` —— 模型更易解析回 JSON

## Open questions for user

1. **Batch 2 是否永远一次发齐 3-4 张卡？** 如果 batch 1 答案显示用户极度新手（全选「不懂，请解释」），是否要把 batch 2 拆成 2a（先选技术大类）/ 2b（再选具体方案）？
2. **多选回填格式选 A 顿号 vs B 编号？** 影响下一轮 LLM 解析答案的稳定度。
3. **EXPERT 模式开关卡是否真的恒发？** 也可只在校准信号判断为 NOVICE 时才发，避免老手被打扰。
4. **`externalDeps` 注释是「每轮全量重写」还是「只追加增量」？** 草案里写的是追加；如果追加，前端解析时要合并去重，得约定唯一键（`service + type`?）。
5. **C 类（合规 / 采购）是否进卡片？** 草案里只写进 `externalDeps` 注释提示，不发卡问；用户是否希望也发卡确认（如「需要 ICP 备案吗？」）？
6. **`min/max` 字段前端是否要做硬校验？** 还是只给提示文案、允许越界提交？
