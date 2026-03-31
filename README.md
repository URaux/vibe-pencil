# Vibe Pencil

**中文** | [English](README.en.md)

在画布上设计软件架构，与 AI 讨论方案，一键生成代码。

**目标用户**：有产品思维但不会写代码的人——PM、创始人、设计师——把系统架构图直接变成可运行的代码。

---

## 核心流程

```
设计画布 ──→ AI 讨论 ──→ Build All ──→ 生成代码
拖拽容器/模块    讨论方案/迭代    波次并行调度    本地 AI CLI 执行
```

1. **设计** — 在画布上拖拽 Container（服务组）和 Block（组件），用带类型的连线描述依赖关系。也可以从现有代码库反向导入，自动生成架构画布。
2. **讨论** — 打开聊天面板，与 AI 讨论架构方案。AI 可以提议画布修改（增删改节点和连线），用户一键应用。三阶段会话工作流：brainstorm（讨论需求）→ design（生成架构）→ iterate（迭代优化）。
3. **构建** — 点击 "Build All"，画布按拓扑排序分波次并行调度，序列化为 YAML 作为 prompt 发给本地 AI CLI 工具，实时流式输出构建进度。

---

## 系统架构

![系统架构](docs/arch-system.png)

## 构建流程

![构建流程](docs/arch-build-flow.png)

## 画布模型

![画布模型](docs/arch-canvas-model.png)

---

## 功能列表

### 画布与设计

| 功能 | 描述 |
|---|---|
| Container + Block 两层架构 | 容器分组 + 内部模块，elkjs 复合布局自动排列 |
| 容器可缩放 | 选中容器出现 resize handle，自由调整尺寸 |
| 8 方向智能连接点 | 位置感知边路由，自动选取最优连接点对 |
| 连线类型 | `sync`（同步调用）/ `async`（异步消息）/ `bidirectional`（双向通信） |
| Undo / Redo | 50 步快照，`Ctrl+Z` / `Ctrl+Shift+Z` |
| 会话-画布联动 | 切换聊天会话自动保存/恢复对应画布状态 |

### AI 对话与工作流

| 功能 | 描述 |
|---|---|
| AI 对话 | 与 AI 讨论架构方案，AI 可直接修改画布（canvas-action） |
| 三阶段会话工作流 | brainstorm → design → iterate 渐进式推进 |
| Context Engineering | 7 层 context stack，2-agent 架构（Canvas Agent + Build Agent） |
| Chat-Build 联动 | Chat agent 实时感知 build 状态，构建事件自动插入对话 |
| Markdown 渲染 | 代码高亮、GFM 表格、代码块语法着色 |
| 会话标题 AI 生成 | 对话后自动总结会话标题 |
| 项目名自动生成 | 从架构内容智能命名项目 |

### 构建系统

| 功能 | 描述 |
|---|---|
| 一键构建 Build All | 拓扑排序波次并行生成代码，最大化并发 |
| 三种 AI 后端 | Claude Code / Codex / Gemini CLI，按需切换 |
| Skill 系统 | 15+ 内置技能 + GitHub 导入 + 本地导入，techStack 自动匹配 |
| Post-build hooks | Skill 可定义构建后自动执行的命令（如 lint、测试） |
| Build 进度面板 | 实时波次进度、节点动画、趣味加载文字 |
| Build 断线重连 | 刷新页面后自动恢复 build 状态 |
| SSE 实时流 | Server-Sent Events 推送构建输出和状态变更 |

### 导入 / 导出

| 功能 | 描述 |
|---|---|
| 两阶段导入 | 秒速骨架扫描 + 后台 AI 增强，反向工程现有代码库 |
| 9 项导出 | YAML / JSON / PNG / Mermaid / Markdown / 会话备份 / 项目存档 / 剪贴板 |

### 其他

- **多语言** — 中英双语 i18n
- **进度组件** — StatusBar 内嵌自动进度计算
- **自动保存** — 本地工作区自动持久化

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 框架 | Next.js 16 (App Router) |
| 画布 | React Flow (`@xyflow/react` v12) |
| 布局引擎 | elkjs（复合布局） |
| 样式 | Tailwind CSS v4 |
| 状态管理 | Zustand v5 |
| 流式传输 | Server-Sent Events (SSE) |
| Agent 执行 | Node.js `child_process.spawn` |
| Markdown | react-markdown + rehype-highlight + remark-gfm |
| YAML 序列化 | `yaml` v2 |
| 测试 | Vitest v4 + Testing Library |
| 语言 | TypeScript |

---

## 快速开始

**前置条件**：Node.js 20+

```bash
git clone https://github.com/URaux/vibe-pencil.git
cd vibe-pencil
npm install
npm run dev        # http://localhost:3000
```

**测试**：
```bash
npm test           # 运行全部测试
npx vitest         # 监听模式
```

**安装 AI CLI 工具**（按需选择一种或多种）：
```bash
npm install -g @anthropic-ai/claude-code   # Claude Code
npm install -g @openai/codex               # Codex
npm install -g @google/gemini-cli          # Gemini CLI
```

---

## API 接口

| 方法 | 路由 | 描述 |
|---|---|---|
| `POST` | `/api/agent/spawn` | 启动单个 Agent 或完整 BuildAll 波次计划 |
| `GET` | `/api/agent/status` | 查询 Agent 状态 |
| `GET` | `/api/agent/stream` | SSE 事件流（状态变更、输出、波次） |
| `POST` | `/api/agent/stop` | 终止运行中的 Agent |
| `GET` | `/api/agent/build-state` | 获取持久化的构建状态（断线重连） |
| `POST` | `/api/chat` | SSE 流式 AI 对话 |
| `GET` | `/api/models` | 获取指定后端的模型列表 |
| `POST` | `/api/project/save` | 保存项目 |
| `POST` | `/api/project/load` | 加载项目 |
| `POST` | `/api/project/scan` | 两阶段导入：骨架扫描 |
| `POST` | `/api/project/import` | 两阶段导入：AI 增强 |
| `GET` | `/api/skills/list` | 列出所有可用 Skill |
| `POST` | `/api/skills/add` | 从 GitHub / 本地路径导入 Skill |
| `POST` | `/api/skills/resolve` | 根据 techStack 匹配最优 Skill |
| `POST` | `/api/build/read-files` | 读取构建产物文件（post-build hooks） |

---

## 架构简述

```
用户
 │
 ├─ 画布（Container + Block）─────────────────────────────┐
 │   └─ elkjs 自动布局                                     │
 │                                                         │
 ├─ AI 对话（ChatSidebar）                                 │
 │   ├─ Context Engine（7 层 stack）                       │
 │   ├─ 三阶段工作流（brainstorm / design / iterate）      │
 │   └─ canvas-action → 一键应用到画布 ───────────────────┤
 │                                                         │
 └─ Build All（AgentRunner）                               │
     ├─ 拓扑排序 → 波次调度                               │
     ├─ Skill 系统（techStack 匹配）                      │
     ├─ Claude Code / Codex / Gemini CLI                  │
     ├─ SSE 实时进度推送                                   │
     └─ BuildSummary → 反馈回 Canvas Agent ───────────────┘
```

---

## License

MIT
