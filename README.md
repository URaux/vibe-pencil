# Vibe Pencil

**中文** | [English](README.en.md)

可视化架构编辑器 —— 在画布上设计软件架构，与 AI 讨论方案，一键生成代码。

**目标用户**：有产品思维但不会写代码的人 —— PM、创始人、设计师 —— 把系统架构图直接变成可运行的代码。

---

## 它能做什么

```
  设计 ──→ 讨论 ──→ 自动构建架构
  自动编辑/手动拖拽    AI 对话    一键生成代码
```

1. **设计** — 拖拽容器和模块到画布，用连线描述依赖关系
2. **讨论** — 打开聊天面板，选择一个节点或全局模式，与 AI 讨论架构方案。AI 可以提议画布修改（增删改节点和连线），用户一键应用
3. **构建** — 点击 "Build All"，画布序列化为 YAML 作为 prompt 发给 AI CLI 工具。按拓扑排序的波次并行生成代码
4. **导入** — 反向工程现有代码库，自动生成架构画布

---

## 系统架构

![系统架构](docs/arch-system.png)

## 构建流程

![构建流程](docs/arch-build-flow.png)

---

## 画布模型

![画布模型](docs/arch-canvas-model.png)

**两层架构**：
- **Container（容器）** — 分组容器，可折叠，6 种颜色标签
- **Block（模块）** — 具体组件，绑定在容器内，含名称、描述、技术栈、构建状态

**连线类型**：
| 类型 | 描述 |
|---|---|
| `sync` | 同步调用（HTTP, gRPC 等） |
| `async` | 异步消息 |
| `bidirectional` | 双向通信（WebSocket） |

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 框架 | Next.js 16 (App Router) |
| 画布 | React Flow (`@xyflow/react` v12) |
| 布局 | elkjs（复合布局引擎） |
| 样式 | Tailwind CSS v4 |
| 状态 | Zustand v5 |
| 流式传输 | Server-Sent Events (SSE) |
| Agent 执行 | Node.js `child_process.spawn` |
| YAML 序列化 | `yaml` v2 |
| 测试 | Vitest v4 + Testing Library |

---

## 功能列表

- Container + Block 两层架构 + elkjs 复合布局
- 8 方向智能连接点 + 位置感知边路由
- 三种 AI 后端：Claude Code / Codex / Gemini CLI
- 图感知并行构建（拓扑排序 → 波次调度）
- SSE 实时流式构建进度
- AI 聊天 + "Apply to Canvas" 画布修改提议
- 聊天会话管理（Claude.ai 风格侧栏）
- 导入现有代码库 → 自动生成架构画布
- 导出 YAML / JSON
- Undo / Redo（50 步）
- 中英双语 i18n
- 项目名称可编辑
- 自动保存
- 开发进度 Dashboard

---

## API 接口

| 方法 | 路由 | 描述 |
|---|---|---|
| `POST` | `/api/agent/spawn` | 启动单个 Agent 或完整 BuildAll 波次计划 |
| `GET` | `/api/agent/status` | 查询 Agent 状态 |
| `GET` | `/api/agent/stream` | SSE 事件流（状态变更、输出、波次） |
| `POST` | `/api/agent/stop` | 终止运行中的 Agent |
| `POST` | `/api/chat` | SSE 流式 AI 对话 |
| `GET` | `/api/models` | 获取指定后端的模型列表 |
| `POST` | `/api/project/save` | 保存项目 |
| `POST` | `/api/project/load` | 加载项目 |
| `POST` | `/api/project/import` | 反向工程代码库生成画布 |

---

## 快速开始

```bash
git clone https://github.com/URaux/vibe-pencil.git
cd vibe-pencil
npm install
npm run dev        # http://localhost:3000
```

**测试**：
```bash
npx vitest run     # 运行全部测试
```

**需要安装的 AI CLI 工具**（按需选择）：
- Claude Code: `npm install -g @anthropic-ai/claude-code`
- Codex: `npm install -g @openai/codex`
- Gemini CLI: `npm install -g @google/gemini-cli`

---

## License

MIT
