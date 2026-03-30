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

let lastIndex = -1

export function getRandomLoadingMessage(): string {
  const locale = getLocale()
  const pool = locale === 'zh' ? MESSAGES_ZH : MESSAGES_EN
  let index: number
  do {
    index = Math.floor(Math.random() * pool.length)
  } while (index === lastIndex && pool.length > 1)
  lastIndex = index
  return pool[index]
}
