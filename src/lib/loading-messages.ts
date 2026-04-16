import { getLocale } from './i18n'

const MESSAGES_EN = [
  "Gathering resources from the dependency tree...",
  "The code monsters are restless tonight...",
  "Attempting to appease the build gods...",
  "Science machine is processing...",
  "Teaching the AI to write semicolons...",
  "Convincing the compiler this is fine...",
  "Negotiating with the package manager...",
  "Resolving existential dependencies...",
  "Performing mass code synthesis...",
  "Turning coffee into code...",
  "Asking Stack Overflow for help...",
  "Reticulating splines...",
  "Compiling quantum entanglement...",
  "Summoning the mass demons...",
]

const MESSAGES_ZH = [
  "正在向代码之神献祭...",
  "AI 正在冥想最佳实现方案...",
  "节点们正在开会讨论架构...",
  "依赖树正在光合作用...",
  "正在翻译人类的需求为机器语言...",
]

const IMPORT_MESSAGES_EN = [
  "Scanning the project structure...",
  "Reading every file like a detective novel...",
  "Mapping the dependency labyrinth...",
  "Reverse-engineering your architecture...",
  "Cataloguing components and connections...",
  "Untangling the spaghetti...",
  "Decoding the developer's intent...",
  "Interviewing the source code...",
]

const IMPORT_MESSAGES_ZH = [
  "正在扫描项目结构...",
  "正在像侦探一样阅读每个文件...",
  "正在绘制依赖迷宫地图...",
  "正在逆向工程你的架构...",
  "正在审讯源代码...",
  "正在理清意大利面条式的代码...",
]

const CHAT_THINKING_EN = [
  "Sketching the architecture in my head...",
  "Considering your requirements...",
  "Analyzing the best approach...",
  "Thinking through the tradeoffs...",
  "Evaluating tech stack options...",
  "Designing the module boundaries...",
  "Planning the data flow...",
]

const CHAT_THINKING_ZH = [
  "正在构思架构方案...",
  "正在分析你的需求...",
  "正在权衡技术选型...",
  "正在设计模块边界...",
  "正在规划数据流向...",
  "正在评估最佳方案...",
  "正在思考系统拓扑...",
]

const SUBMISSION_FLAVOR_ZH = [
  '已提交这一轮的选择',
  '记录了你的偏好',
  '拿着这些答案继续往下想',
  '收到，下一轮接着聊',
  '这些信号已经收到了',
]

const SUBMISSION_FLAVOR_EN = [
  'Choices submitted for this round',
  'Preferences noted',
  'Taking your answers and thinking ahead',
  'Got it — continuing to the next round',
  'Signals received',
]

let lastIndex = -1
let lastImportIndex = -1
let lastChatThinkingIndex = -1
let lastSubmissionFlavorIndex = -1

function pickRandom(pool: string[], lastIdx: number): { index: number; message: string } {
  let index: number
  do {
    index = Math.floor(Math.random() * pool.length)
  } while (index === lastIdx && pool.length > 1)
  return { index, message: pool[index] }
}

export function getRandomLoadingMessage(): string {
  const locale = getLocale()
  const pool = locale === 'zh' ? MESSAGES_ZH : MESSAGES_EN
  const result = pickRandom(pool, lastIndex)
  lastIndex = result.index
  return result.message
}

export function getRandomImportMessage(): string {
  const locale = getLocale()
  const pool = locale === 'zh' ? IMPORT_MESSAGES_ZH : IMPORT_MESSAGES_EN
  const result = pickRandom(pool, lastImportIndex)
  lastImportIndex = result.index
  return result.message
}

export function getRandomChatThinkingMessage(): string {
  const locale = getLocale()
  const pool = locale === 'zh' ? CHAT_THINKING_ZH : CHAT_THINKING_EN
  const result = pickRandom(pool, lastChatThinkingIndex)
  lastChatThinkingIndex = result.index
  return result.message
}

export function pickSubmissionFlavor(locale: string): string {
  const pool = locale === 'zh' ? SUBMISSION_FLAVOR_ZH : SUBMISSION_FLAVOR_EN
  const result = pickRandom(pool, lastSubmissionFlavorIndex)
  lastSubmissionFlavorIndex = result.index
  return result.message
}
