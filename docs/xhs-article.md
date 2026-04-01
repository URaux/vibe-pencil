# 小红书图文笔记：ADHD 给中大型项目 vibe 了一个外置前额叶

> 5 页轮播格式，每页 150-200 字

---

## Page 1: The Pain (Hook + Cliffhanger)

**我用 10 个 agent 写了个大型项目，然后我失控了。**

Agent A 刚改完的文件，Agent B 又覆盖了。三个 agent 同时写同一个模块，我连冲突都来不及解。

打开 Claude Code 想继续干活——**等等，我上次做到哪了？**

ADHD 的工作记忆大概撑 3 分钟。项目一大，脑子就像开了 200 个 tab：全在那，但我找不到任何一个。

我试过 Notion、试过 TODO 清单、试过给自己录语音备忘。

**全都失败了。**

直到我意识到：问题不是工具不够多，是我需要一个完全不一样的东西——

---

## Page 2: The AI Architect (Conversation-Driven)

**你不需要画任何东西。你只需要跟 AI 吵架。**

真实对话是这样的：

> 我：帮我做一个跨境电商系统
> AI：你的选品数据从哪来？
> 我：爬竞品数据
> AI：[自营独立站] [平台卖家] [SaaS服务商] -- 选一个
> 我：独立站
> AI：技术栈偏好？

**像跟一个资深架构师对线。** 你说不清楚？没关系，它会逼你说清楚。你想跳过细节？它不让。

三轮对话之后，架构图就在那了。容器、模块、连线自动排列在画布上。

但代码呢？

---

## Page 3: Build All + Context Engineering

**点一个按钮，AI 开始写整个系统。**

"Build All" 不是随便生成代码。AI 知道先建数据库再建 API 再建前端——**为什么它知道？**

因为我们做了 **Context Engineering**——7 层上下文精确控制 AI 在每个阶段看到什么。不是把信息一股脑塞给 AI，是像外科手术一样精准投喂。

更狠的是 **Harness Engineering**：每个 build agent 的 CLAUDE.md 根据节点的 techStack 自动装配。写 React 的 agent 收到 React 最佳实践，写 Node.js 的收到 API 设计规范。29 个 Skill 按需匹配。

构建失败了？直接在对话里问"为什么"——构建状态已经在上下文里了。

然后事情变得更有趣了——

---

## Page 4: ADHD Story (Narrative Mode)

**昨天晚上我在做电商系统的风控模块。**

做到一半，脑子里突然冒出一个支付的想法。

以前我会立刻切过去——然后 20 分钟后忘了风控做到哪。这就是 ADHD：不是不能做，是脑子不让你只做一件事。

现在？我直接在对话里说"加上支付功能"。画布自动更新。风控那边的进度？Session 自动保存了，切回来一切还在。

我甚至不需要记住"做到哪了"——进度条告诉我。节点构建中会发光，失败会抖动。**我的眼睛比我的记忆靠谱多了。**

这东西到底长什么样？

---

## Page 5: Tech + CTA (Punchy)

**13,000 行 TypeScript。不是玩具。**

开源，免费，现在就能用。

核心架构：2-Agent 分离（Canvas Agent 只读讨论 + Build Agent 可写构建）、7 层 Context Stack、拓扑排序波次调度、29 个内置 Skill。

支持 Claude Code / Codex / Gemini CLI 三种 AI 后端。9 种导出格式。断线重连。SSE 实时流。

**如果你也是注意力经常跑偏的人——这个工具就是你的外置工作记忆。**

GitHub: github.com/URaux/arch-viber

Star / Issue / PR 都欢迎。评论区聊，我在。加群一起 vibe。

---

**Tags**: #VibeCoding #ADHD #开源 #AI架构 #ClaudeCode #独立开发 #ContextEngineering #AIAgent #效率工具
