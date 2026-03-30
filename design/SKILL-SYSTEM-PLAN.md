# Skill System Architecture Plan

> Vibe Pencil 的 Skill 库不是一个文件夹，是一个有来源、有分层、有加载策略、有前端管理界面的完整系统。

---

## 一、核心概念

### 1.1 什么是 Skill

Skill = 一段 Markdown 指令，注入到 Agent 的 system prompt（CLAUDE.md / AGENTS.md / GEMINI.md）里，指导 Agent 的行为。

当前状态：`skills/` 下 8 个 .md 文件，按 category 分文件夹，skill-loader.ts 读取合并。**没有来源管理、没有分层加载、没有前端控制。**

### 1.2 Skill 的元数据格式

每个 Skill 文件加 frontmatter：

```yaml
---
name: react-patterns
description: React 组件开发模式和最佳实践
category: frontend
source: local                    # local | github | team
source_url: ""                   # GitHub 来源时填 repo URL
tags: [react, components, hooks]
level: [module]                  # 适用 agent 层级: project | module | build
priority: 100                    # 数字越大越优先加载，冲突时高优先覆盖
---

# React Patterns
...skill 正文...
```

---

## 二、Skill 来源

### 2.1 三种来源

| 来源 | 标识 | 存储位置 | 说明 |
|------|------|----------|------|
| **Local** | `local` | `skills/local/` | 项目内建，随 git 提交 |
| **GitHub** | `github` | `skills/github/` | 从 GitHub 高星仓库拉取，gitignore |
| **Team** | `team` | `skills/team/` | 团队成员共享的私有技能，gitignore |

### 2.2 GitHub Skill Registry

```
skills/github/
├── registry.json          # 已安装的 skill 清单
├── claude-code-skills/    # 来自 github.com/xxx/claude-code-skills
│   ├── typescript.md
│   └── testing.md
└── cursor-rules/          # 来自 github.com/xxx/cursor-rules
    └── nextjs.md
```

**registry.json 结构：**
```json
{
  "sources": [
    {
      "repo": "PatrickJS/awesome-cursorrules",
      "branch": "main",
      "path": "rules/",
      "installed": "2026-03-30",
      "skills": ["nextjs.md", "react.md"]
    }
  ]
}
```

**拉取机制：**
- API 路由 `POST /api/skills/install` 接收 repo URL
- 后端用 `git clone --depth 1 --sparse` 只拉 skill 目录
- 解析 .md 文件，自动补全 frontmatter（推断 category/tags）
- 写入 `skills/github/` + 更新 registry.json

### 2.3 Team Skills

团队成员通过 UI 上传或粘贴 .md 文件，存入 `skills/team/`。未来可以接团队共享后端（S3 / Git repo / 内部 API），当前 MVP 就是本地文件夹。

---

## 三、Agent 层级与 Skill 分配

### 3.1 三个 Agent 层级

| 层级 | 角色 | 触发场景 | 当前代码对应 |
|------|------|----------|-------------|
| **Project（项目管家）** | 全局架构师 | Chat 全局模式、Import 代码库 | `level: 'project'` |
| **Module（模块助手）** | 单组件专家 | Chat 节点模式、Build 单节点 | `level: 'module'` |
| **Build（构建子 Agent）** | 纯执行者 | Build All 波次里的每个子进程 | buildAll 里的 spawnAgent |

### 3.2 各层级默认 Skill 装载策略

```
┌─────────────────────────────────────────────┐
│  Project Agent（项目管家）                    │
│  ─────────────────────────────               │
│  必装: core/*                                │
│  必装: architect/*                           │
│  可选: 用户在 UI 中勾选的额外 skill           │
│  禁止: 具体实现细节的 skill（避免越权）        │
├─────────────────────────────────────────────┤
│  Module Agent（模块助手）                     │
│  ─────────────────────────────               │
│  必装: core/*                                │
│  自动: 根据节点 techStack 匹配               │
│       (React → frontend/*, API → backend/*) │
│  继承: Container 上配置的 skill               │
│  可选: 节点级手动覆盖                         │
├─────────────────────────────────────────────┤
│  Build Agent（构建子 Agent）                  │
│  ─────────────────────────────               │
│  必装: core/*                                │
│  必装: testing/*（生成代码必须可测试）          │
│  自动: 同 Module，按节点 techStack 匹配       │
│  额外: 构建专用 skill（输出格式、文件结构）     │
│  禁止: architect/* （不该做架构决策）          │
└─────────────────────────────────────────────┘
```

### 3.3 Skill 匹配规则

```typescript
// 伪代码
function resolveSkillsForAgent(level: AgentLevel, node?: CanvasNode): Skill[] {
  const skills: Skill[] = []

  // 1. 必装 — 所有层级都要的
  skills.push(...getByCategory('core'))

  // 2. 层级专属
  if (level === 'project') {
    skills.push(...getByCategory('architect'))
  }
  if (level === 'build') {
    skills.push(...getByCategory('testing'))
    skills.push(...getByCategory('build'))  // 构建专用
  }

  // 3. 节点推断 — Module 和 Build 层级
  if (node && (level === 'module' || level === 'build')) {
    const inferred = inferFromTechStack(node.data.techStack)
    // "React" → frontend/react-patterns
    // "FastAPI" → backend/api-design
    // "PostgreSQL" → backend/database
    skills.push(...inferred)
  }

  // 4. 手动配置 — 节点或 Container 上用户显式勾选的
  if (node) {
    skills.push(...getManualSkills(node))
    // Block 继承 Container 的 skill
    if (node.type === 'block' && node.parentId) {
      skills.push(...getManualSkills(getParent(node)))
    }
  }

  // 5. 去重 + 按 priority 排序
  return dedupByPriority(skills)
}
```

---

## 四、冷加载与热加载

### 4.1 冷加载（Cold Load）

**时机：** 应用启动、页面刷新、首次 Build All

**过程：**
1. 扫描 `skills/` 全部子目录
2. 解析每个 .md 的 frontmatter → 构建 Skill Index（内存）
3. Skill Index 缓存在 Zustand store，前端可读

**成本：** ~50ms（几十个文件），可接受

### 4.2 热加载（Hot Load）

**时机：** 用户在 UI 中新增/修改/删除 Skill，不需要刷新

**机制：**
- API 路由 `POST /api/skills/reload` → 重新扫描目录、重建 Index
- 或更精确：`POST /api/skills/update` 传入变更的文件 → 增量更新 Index
- 前端通过 Zustand action `refreshSkillIndex()` 拉取最新 Index

**关键约束：** 已经在跑的 Agent 不受影响（prompt 已注入）。热加载只影响下一次 Agent 创建。

### 4.3 Build 时的 Skill 注入流程

```
Build All 点击
    ↓
拓扑排序 → Wave 0: [nodeA, nodeB]
    ↓
对每个 node:
  1. resolveSkillsForAgent('build', node)
  2. mergeSkills(resolvedCategories) → skillContent 字符串
  3. writeAgentConfig(workDir, skillContent, 'module', ...) → 写 CLAUDE.md
  4. spawnAgent(nodeId, prompt, backend, workDir)
    ↓
Agent 子进程启动，读取 CLAUDE.md 里的 skill 指令
```

---

## 五、前端 UI

### 5.1 Skill 管理面板（新增 Tab 在 Settings Dialog 里）

```
┌─────────────────────────────────────┐
│  ⚙️ Settings                        │
│  [General] [Skills] [Agent]         │
├─────────────────────────────────────┤
│                                     │
│  📦 Skill 库 (12 已装载)             │
│                                     │
│  ── Local (5) ──────────────────    │
│  ☑ core/code-style         必装     │
│  ☑ core/error-handling      必装     │
│  ☑ architect/architecture   项目管家 │
│  ☑ architect/planning       项目管家 │
│  ☐ testing/vitest           构建时   │
│                                     │
│  ── GitHub (4) ─────────────────    │
│  ☑ nextjs-rules             自动    │
│  ☑ react-patterns           自动    │
│  ☐ python-fastapi           手动    │
│  ☐ rust-patterns            手动    │
│  [+ 从 GitHub 安装...]              │
│                                     │
│  ── Team (3) ───────────────────    │
│  ☑ internal-api-guidelines   手动   │
│  ☐ deployment-checklist      手动   │
│  ☐ security-review           手动   │
│  [+ 添加团队技能...]                 │
│                                     │
│  ── 预览 ──────────────────────     │
│  [选中一个 skill 查看内容]           │
│                                     │
└─────────────────────────────────────┘
```

### 5.2 节点级 Skill 配置

在 BlockNode 或 ContainerNode 的编辑面板中（右键菜单或属性面板）：

```
┌───────────────────────────┐
│  节点: User Service       │
│  ─────────────────        │
│  Skills:                  │
│  ☑ core (必装)            │
│  ☑ backend/api-design     │  ← 自动推断（techStack: FastAPI）
│  ☐ testing/vitest         │
│  ☐ team/security-review   │
│  [+ 添加 skill]           │
└───────────────────────────┘
```

### 5.3 Build 时的 Skill 预览

Build All 点击后、确认执行前，弹出预览：

```
┌────────────────────────────────────────┐
│  🚀 Build All — Skill 装载预览          │
│                                        │
│  Wave 0:                               │
│  ├─ User Service                       │
│  │   Skills: core, backend, testing    │
│  └─ Frontend App                       │
│      Skills: core, frontend, testing   │
│                                        │
│  Wave 1:                               │
│  └─ API Gateway                        │
│      Skills: core, architect, backend  │
│                                        │
│  [调整] [确认执行]                       │
└────────────────────────────────────────┘
```

---

## 六、Agent 列表与层级管理

### 6.1 Agent Registry

新增 `src/lib/agent-registry.ts`，管理所有 Agent 实例：

```typescript
interface AgentInstance {
  id: string
  nodeId: string
  level: 'project' | 'module' | 'build'
  backend: AgentBackend
  skills: string[]           // 装载的 skill 列表
  status: AgentStatus
  spawnedAt: number
  parentAgentId?: string     // Build 子 Agent 的父级（Project Agent）
}

interface AgentRegistry {
  agents: Map<string, AgentInstance>
  getByLevel(level): AgentInstance[]
  getByNode(nodeId): AgentInstance[]
  getTree(): AgentTree          // 层级树
}
```

### 6.2 Agent 面板（新增 UI 组件）

在 StatusBar 旁或作为可展开侧栏：

```
┌──────────────────────────────────┐
│  🤖 Agents (3 running, 2 done)   │
├──────────────────────────────────┤
│                                  │
│  📋 Project Manager              │
│     Status: idle                 │
│     Skills: core, architect      │
│     Backend: claude-code         │
│                                  │
│  ├─ 🔨 User Service [building]  │
│  │   Skills: core, backend       │
│  │   Wave: 0/2                   │
│  │                               │
│  ├─ 🔨 Frontend App [building]  │
│  │   Skills: core, frontend      │
│  │   Wave: 0/2                   │
│  │                               │
│  └─ ⏳ API Gateway [queued]      │
│      Skills: core, backend       │
│      Wave: 1/2                   │
│                                  │
│  History:                        │
│  ✅ Auth Module [done 2min ago]  │
│  ❌ DB Service [error]           │
└──────────────────────────────────┘
```

### 6.3 层级关系

```
Project Agent（管全局）
  ├── Module Agent（Chat 节点模式产生）
  └── Build Wave
      ├── Build Agent: nodeA（Wave 0）
      ├── Build Agent: nodeB（Wave 0）
      └── Build Agent: nodeC（Wave 1，等 Wave 0 完成）
```

Project Agent 可以看到所有 Build Agent 的状态和产出。
Module Agent 是独立的，不参与 Build 流程。

---

## 七、实现优先级

### P0 — Skill 元数据 + 分层加载（核心机制）

1. Skill 文件加 frontmatter 格式
2. `SkillIndex` 解析器（读 frontmatter → 内存索引）
3. `resolveSkillsForAgent(level, node)` 分层装载逻辑
4. 改造 `writeAgentConfig` 使用新的 resolve 逻辑
5. 补充 `build` 专用 skill（输出格式、文件结构约束）

### P1 — 前端 Skill 管理

6. Settings Dialog 新增 Skills tab
7. Skill 列表展示（分来源、分 category）
8. Skill 内容预览
9. 节点级 Skill 配置（BlockNode 属性编辑）
10. Build All 前的 Skill 预览弹窗

### P2 — GitHub Skill 拉取

11. `POST /api/skills/install` 从 GitHub 拉取
12. registry.json 管理已安装来源
13. Skill 更新检查

### P3 — Agent 管理面板

14. AgentRegistry 数据结构
15. Agent 面板 UI（层级树、状态、skill 装载详情）
16. Agent 历史记录

### P4 — Team Skills + 热加载

17. Team skill 上传 UI
18. 热加载机制（文件变更 → 增量更新 Index）
19. Skill 冲突检测（同名不同来源 → 按 priority 解决）

---

## 八、与现有架构的关系

| 现有模块 | 改动 |
|----------|------|
| `skill-loader.ts` | 重构：加 frontmatter 解析、SkillIndex、resolveSkillsForAgent |
| `agent-runner.ts` | 小改：spawnAgent 接收 resolved skills 而非 raw categories |
| `useBuildActions.ts` | 改：buildAll 流程中加 skill resolve + 可选预览确认 |
| `SettingsDialog.tsx` | 加 tab |
| `store.ts` | 加 skillIndex 状态 |
| `types.ts` | 加 Skill、SkillSource、AgentLevel 类型 |

**不动的：** topo-sort、SSE streaming、chat API、canvas 核心逻辑。

---

## 九、面试叙事价值

> "Vibe Pencil 的 Skill 系统是一个三来源（本地/GitHub/团队）、三层级（项目管家/模块助手/构建子Agent）的 prompt 工程框架。核心思想是不同角色的 Agent 需要不同的指令集——架构师不该看实现细节，实现者不该做架构决策。支持冷加载和热加载，前端可视化管理，Build All 前可以预览每个节点装载了哪些 Skill。这不只是'给 Agent 加 prompt'，而是一套 Agent 能力管理系统。"
