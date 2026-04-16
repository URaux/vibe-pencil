/**
 * Retrying fetch for the chat endpoint with fine-grained error classification.
 *
 * Design goals:
 *   - Retry transient failures (5xx, network blips) but cap aggressively so
 *     recovering networks don't burst requests and get the account flagged.
 *   - Translate every failure into a plain-language message that tells a
 *     non-technical user exactly what to do next — distinguish VPN from
 *     network from quota from model errors.
 *   - Honor AbortSignal so cancel-chat still works immediately.
 *
 * Retry policy: default maxAttempts=2 (= 1 initial + 1 retry). Only retry on
 * network/DNS failures and 5xx. Do NOT retry 429 (rate limit) or 401/403
 * (auth) — retrying those makes things worse.
 */

export type ChatFetchErrorKind =
  // Transport / network layer
  | 'offline'           // browser navigator.onLine === false
  | 'dns'               // DNS resolution failed
  | 'tls'               // TLS/cert error
  | 'refused'           // connection refused
  | 'timeout'           // request timed out
  | 'vpn-block'         // proxy/VPN interference suspected
  | 'network'           // generic network failure (catch-all)
  // Auth / account
  | 'auth-missing'      // 401 without creds
  | 'auth-invalid'      // 401/403 with bad creds
  | 'account-banned'    // account disabled / blocked
  | 'payment-required' // 402 / insufficient balance
  | 'quota-exhausted'  // out of quota/credits but account ok
  // Rate / concurrency
  | 'rate-limit'        // 429 "too many requests per minute"
  | 'concurrent-limit'  // 429 "too many concurrent"
  // Model / request shape
  | 'model-not-found'   // upstream says model doesn't exist
  | 'model-unavailable' // upstream says model temporarily unavailable
  | 'context-too-long'  // exceeded model context window
  | 'content-filter'    // upstream refused content on policy grounds
  // Server-side
  | 'server'            // 5xx after retry exhausted
  | 'subprocess'        // CC/codex child process exited non-zero
  | 'api-key-missing'   // backend didn't have a key configured
  // Client-side
  | 'client'            // other 4xx
  // Flow control
  | 'aborted'           // user cancelled
  | 'unknown'

export interface ChatFetchError extends Error {
  kind: ChatFetchErrorKind
  status?: number
  attempts: number
  serverMessage?: string
}

function makeError(
  kind: ChatFetchErrorKind,
  message: string,
  extras: Partial<ChatFetchError> = {},
): ChatFetchError {
  const err = new Error(message) as ChatFetchError
  err.kind = kind
  err.attempts = extras.attempts ?? 1
  if (extras.status !== undefined) err.status = extras.status
  if (extras.serverMessage !== undefined) err.serverMessage = extras.serverMessage
  return err
}

export interface ChatFetchOptions {
  /** Total attempts including first. Default 2 (= 1 retry). Keep small — bursty
   *  retries on network recovery have triggered rate-limit lockouts in practice. */
  maxAttempts?: number
  /** Base backoff in ms; doubles each retry. Default 800ms. */
  baseDelayMs?: number
  onRetry?: (attempt: number, reason: string) => void
  /** Called when we enter a long cool-down wait (rate-limit / concurrent-limit).
   *  `seconds` is the planned wait. `remaining` ticks once per second so the UI
   *  can render a countdown. Set false to disable cool-down retry entirely. */
  onCooldown?: (seconds: number, reason: 'rate-limit' | 'concurrent-limit') => void
  onCooldownTick?: (remaining: number) => void
  /** If true, after normal retries are exhausted for rate-limit / concurrent-limit,
   *  wait the server's Retry-After (or a sensible default) and try ONCE more.
   *  This is not a fast retry — it's a deliberate slow cooldown, so it doesn't
   *  contribute to the burst pattern that triggers account flags. Default true. */
  autoCooldown?: boolean
  /** Deterministic auto-remediation hook. Called with the classified error
   *  just before it would be thrown. Return a new RequestInit to retry ONCE
   *  with adjusted params (e.g. swapped model, waited for online), or null to
   *  let the error propagate. Only invoked once per fetch. */
  remediate?: (err: ChatFetchError) => Promise<{ init: RequestInit; note?: string } | null>
  /** Called when remediation kicks in — `note` is a human-readable one-liner
   *  describing the fix (e.g. "已切到 Sonnet 重试"). */
  onRemediate?: (err: ChatFetchError, note: string | undefined) => void
  signal?: AbortSignal
}

const DEFAULTS = { maxAttempts: 2, baseDelayMs: 800, autoCooldown: true }

/** Parse Retry-After header. Spec allows either seconds or HTTP-date. */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const trimmed = header.trim()
  const asInt = parseInt(trimmed, 10)
  if (Number.isFinite(asInt) && asInt >= 0 && asInt <= 300) return asInt
  const asDate = Date.parse(trimmed)
  if (Number.isFinite(asDate)) {
    const delta = Math.ceil((asDate - Date.now()) / 1000)
    if (delta > 0 && delta <= 300) return delta
  }
  return null
}

/** Parse a seconds hint embedded in the server error body, e.g. "retry in 20s". */
function parseRetryHintFromMessage(msg: string | undefined): number | null {
  if (!msg) return null
  const m = msg.match(/(?:retry\s*(?:after|in)|please\s*try\s*again\s*in|等\s*待?|请\s*(?:在|过)?)\s*(\d{1,3})\s*(?:秒|s|seconds?)/i)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n > 0 && n <= 300) return n
  }
  return null
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    if (signal) {
      const onAbort = () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/** True if worth retrying. We deliberately do NOT retry 429/4xx or auth. */
function shouldRetry(kind: ChatFetchErrorKind, status?: number): boolean {
  if (kind === 'offline' || kind === 'dns' || kind === 'refused' || kind === 'timeout' || kind === 'network') {
    return true
  }
  if (kind === 'server' && status && status >= 500) return true
  return false
}

/** Regex toolbox for matching upstream error text. Matches both English and
 *  Chinese DeepSeek / OpenAI / Anthropic / xiaocaseai / Gemini wordings. */
const PATTERNS: Array<{ kind: ChatFetchErrorKind; re: RegExp }> = [
  { kind: 'model-not-found', re: /model[_\s-]*(not[_\s-]*found|does\s*not\s*exist|unknown|invalid)/i },
  { kind: 'model-not-found', re: /模型\s*不存在|找不到\s*模型|模型\s*无效/ },
  { kind: 'model-unavailable', re: /model\s*(is\s*)?(currently\s*)?(unavailable|overloaded|down|offline)/i },
  { kind: 'model-unavailable', re: /模型\s*(暂时\s*)?(不可用|过载|下线)/ },
  { kind: 'context-too-long', re: /context[_\s-]*(length|window).*(exceed|too\s*long|overflow)/i },
  { kind: 'context-too-long', re: /上下文\s*(过长|超出|超过)/ },
  { kind: 'context-too-long', re: /maximum\s*(context|token).*exceed/i },
  { kind: 'content-filter', re: /content\s*(policy|filter|moderation)|safety\s*block|flagged/i },
  { kind: 'content-filter', re: /违反\s*(内容\s*)?(规则|政策)|被\s*过滤/ },
  { kind: 'concurrent-limit', re: /(too\s*many\s*)?concurrent\s*(request|connection)/i },
  { kind: 'concurrent-limit', re: /并发\s*(过高|超限|过多)/ },
  { kind: 'rate-limit', re: /rate\s*limit|too\s*many\s*requests|tpm|rpm|requests\s*per\s*(minute|second)/i },
  { kind: 'rate-limit', re: /速率\s*限制|请求\s*过于\s*频繁|触发\s*限流/ },
  { kind: 'account-banned', re: /account.*(banned|suspended|disabled|blocked|forbidden)/i },
  { kind: 'account-banned', re: /账号\s*(被封|被禁|已禁用|已封禁|被限制)/ },
  { kind: 'payment-required', re: /insufficient\s*(balance|credit|fund|quota)|payment\s*required|billing/i },
  { kind: 'payment-required', re: /余额\s*不足|账户\s*欠费|需要\s*付费/ },
  { kind: 'quota-exhausted', re: /quota\s*(exceeded|exhausted|out)|usage\s*limit\s*reached/i },
  { kind: 'quota-exhausted', re: /配额\s*(用尽|超限|已用完)/ },
  { kind: 'api-key-missing', re: /api[_\s-]*key[_\s-]*(missing|not\s*set|required|invalid)/i },
  { kind: 'api-key-missing', re: /(API\s*密钥|API\s*Key)\s*(未\s*配置|缺失|无效)/ },
  { kind: 'auth-invalid', re: /(invalid|incorrect|bad)\s*(api[_\s-]*key|token|credential)/i },
  { kind: 'auth-invalid', re: /(密钥|令牌|凭证)\s*(错误|无效|失效)/ },
  { kind: 'subprocess', re: /code\s*[1-9]\d*|exit(ed)?\s*(with)?\s*[1-9]|non-?zero\s*exit|spawn\s*e\w+|ENOENT/i },
  { kind: 'subprocess', re: /子进程\s*(异常|退出|失败)/ },
  { kind: 'tls', re: /ssl|tls|certificate|CERT_/i },
  { kind: 'dns', re: /ENOTFOUND|EAI_AGAIN|dns/i },
  { kind: 'refused', re: /ECONNREFUSED|connection\s*refused/i },
  { kind: 'timeout', re: /ETIMEDOUT|timed?\s*out|request\s*timeout/i },
]

function classifyByMessage(text: string): ChatFetchErrorKind | null {
  for (const { kind, re } of PATTERNS) {
    if (re.test(text)) return kind
  }
  return null
}

/** Classify an HTTP response error. */
function classifyServerError(
  status: number,
  serverMessage: string | undefined,
  attempts: number,
): ChatFetchError {
  const text = serverMessage ?? ''
  const matched = classifyByMessage(text)

  if (matched) {
    return makeError(matched, serverMessage || `HTTP ${status}`, {
      status,
      attempts,
      serverMessage,
    })
  }

  // Status-based fallback when message doesn't hit a pattern
  if (status === 401) {
    return makeError('auth-invalid', serverMessage || 'Unauthorized', {
      status, attempts, serverMessage,
    })
  }
  if (status === 402) {
    return makeError('payment-required', serverMessage || 'Payment required', {
      status, attempts, serverMessage,
    })
  }
  if (status === 403) {
    return makeError('auth-invalid', serverMessage || 'Forbidden', {
      status, attempts, serverMessage,
    })
  }
  if (status === 404) {
    // Many LLM providers return 404 when the model name is wrong
    return makeError('model-not-found', serverMessage || 'Not found', {
      status, attempts, serverMessage,
    })
  }
  if (status === 429) {
    return makeError('rate-limit', serverMessage || 'Too many requests', {
      status, attempts, serverMessage,
    })
  }
  if (status >= 500) {
    return makeError('server', serverMessage || `Server error ${status}`, {
      status, attempts, serverMessage,
    })
  }
  return makeError('client', serverMessage || `Request failed (${status})`, {
    status, attempts, serverMessage,
  })
}

/** Classify a thrown fetch error (network layer). */
function classifyFetchError(err: Error, attempts: number): ChatFetchError {
  // In the browser, a genuinely offline state has navigator.onLine === false.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return makeError('offline', err.message || 'Offline', { attempts })
  }
  const msg = err.message || ''
  const matched = classifyByMessage(msg)
  if (matched) {
    return makeError(matched, msg || 'Fetch error', { attempts })
  }
  // Chrome "Failed to fetch" is a generic stand-in for many transport errors.
  // When a VPN / proxy tunnel drops, fetch throws this with no extra detail.
  // We flag it as vpn-block so the user is nudged to check proxy settings,
  // which is the most common cause in the target audience's environment.
  if (/failed\s*to\s*fetch|networkerror|load\s*failed/i.test(msg)) {
    return makeError('vpn-block', msg, { attempts })
  }
  return makeError('network', msg || 'Network error', { attempts })
}

/**
 * POST to the chat endpoint with automatic retry on transient failures.
 * Returns the Response on success; throws a ChatFetchError on terminal failure.
 */
export async function fetchChatWithRetry(
  input: string,
  init: RequestInit,
  options: ChatFetchOptions = {},
): Promise<Response> {
  const { maxAttempts, baseDelayMs } = { ...DEFAULTS, ...options }
  const signal = options.signal ?? init.signal ?? undefined

  let currentInit = init
  let remediationUsed = false
  let lastError: ChatFetchError | null = null

  const tryRemediate = async (err: ChatFetchError): Promise<boolean> => {
    if (remediationUsed || !options.remediate) return false
    remediationUsed = true
    try {
      const result = await options.remediate(err)
      if (!result) return false
      currentInit = result.init
      options.onRemediate?.(err, result.note)
      return true
    } catch (remediationErr) {
      console.warn('[chat-fetch] remediation callback threw:', remediationErr)
      return false
    }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw makeError('aborted', 'Request aborted by user', { attempts: attempt })
    }

    try {
      const response = await fetch(input, { ...currentInit, signal })

      if (response.ok) {
        return response
      }

      let serverMessage: string | undefined
      try {
        const clone = response.clone()
        const data = (await clone.json()) as { error?: string }
        serverMessage = data.error
      } catch {
        // non-JSON body; leave undefined
      }

      const error = classifyServerError(response.status, serverMessage, attempt)

      // Cool-down retry for rate-limit / concurrent-limit: single slow retry after
      // the server-suggested wait. Separate from fast retries — this is a
      // deliberate "let the pool drain" pause, not a burst.
      if (
        (options.autoCooldown ?? DEFAULTS.autoCooldown) &&
        (error.kind === 'rate-limit' || error.kind === 'concurrent-limit') &&
        attempt === 1
      ) {
        const headerWait = parseRetryAfter(response.headers.get('retry-after'))
        const msgWait = parseRetryHintFromMessage(serverMessage)
        const waitSec = headerWait ?? msgWait ?? (error.kind === 'concurrent-limit' ? 15 : 20)
        options.onCooldown?.(waitSec, error.kind)
        for (let remaining = waitSec; remaining > 0; remaining--) {
          if (signal?.aborted) {
            throw makeError('aborted', 'Aborted during cool-down', { attempts: attempt })
          }
          options.onCooldownTick?.(remaining)
          await sleep(1000, signal)
        }
        continue // try one more time after the cool-down
      }

      if (shouldRetry(error.kind, response.status) && attempt < maxAttempts) {
        lastError = error
        const delay = baseDelayMs * Math.pow(2, attempt - 1)
        options.onRetry?.(attempt, `HTTP ${response.status}`)
        await sleep(delay, signal)
        continue
      }
      // Last chance: deterministic remediation (e.g. swap model, wait for online).
      // Give it a fresh attempt count by rewinding so the new init gets a full try.
      if (await tryRemediate(error)) { attempt = 0; continue }
      throw error
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') {
        throw makeError('aborted', 'Request aborted', { attempts: attempt })
      }
      if ((err as ChatFetchError).kind) {
        throw err
      }
      const error = classifyFetchError(err as Error, attempt)
      if (shouldRetry(error.kind) && attempt < maxAttempts) {
        lastError = error
        const delay = baseDelayMs * Math.pow(2, attempt - 1)
        options.onRetry?.(attempt, error.kind)
        await sleep(delay, signal)
        continue
      }
      if (await tryRemediate(error)) continue
      throw error
    }
  }

  throw lastError ?? makeError('unknown', 'Unknown chat fetch error')
}

// ---------------------------------------------------------------------------
// Plain-language descriptions
// ---------------------------------------------------------------------------
//
// Every kind maps to a (title, hint) tuple. The title is the one-liner shown
// in the chat bubble; the hint is concrete actionable guidance the user can
// follow without technical knowledge. Both are surfaced via describeChatFetchError.
//
// Target reader: someone who only knows how to talk to the app by voice and
// has never seen a stack trace. Tell them what button to press, not what
// went wrong in the protocol.

interface ErrorExplanation {
  title: string
  hint: string
}

const ZH_EXPLAIN: Record<ChatFetchErrorKind, (err: ChatFetchError) => ErrorExplanation> = {
  offline: () => ({
    title: '电脑当前处于离线状态',
    hint: '右下角的网络图标显示断开了，请检查网线/WiFi 有没有连上。',
  }),
  dns: () => ({
    title: '域名解析失败（DNS 问题）',
    hint: '通常是 DNS 服务器没响应。试试切换网络（比如 WiFi 换手机热点），或重启路由器。',
  }),
  tls: () => ({
    title: '加密连接握手失败',
    hint: '可能是系统时间不对，或代理抓包证书没装。先检查电脑日期时间是不是准确。',
  }),
  refused: () => ({
    title: '服务器拒绝连接',
    hint: '后端服务可能没启动。如果你是本地跑的，确认终端里 dev server 还在跑（localhost:3000）。',
  }),
  timeout: () => ({
    title: '请求超时，服务器没在规定时间内回复',
    hint: '网络可能很慢或模型在排队。等几秒再发一次；如果一直超时，换个更快的模型或切换网络。',
  }),
  'vpn-block': () => ({
    title: '无法连接到 AI 服务（疑似 VPN/代理问题）',
    hint: '大概率是 VPN 掉线或代理走错了节点。请检查 VPN 是否已连接、能不能打开 google.com；如果用的是系统代理，换成全局模式再试。',
  }),
  network: (err) => ({
    title: '网络异常',
    hint: `已重试 ${err.attempts} 次仍失败。检查 WiFi 是否连上、路由器是否正常、是否开了防火墙拦截浏览器。`,
  }),
  'auth-missing': () => ({
    title: 'API 密钥没填',
    hint: '打开右上角设置 → Custom API，把 API Key 粘进去再发。',
  }),
  'auth-invalid': () => ({
    title: 'API 密钥错误',
    hint: '当前密钥被服务器拒绝了。请到设置 → Custom API 检查密钥是不是复制完整、有没有多余空格；或者去平台重新生成一个新 key。',
  }),
  'account-banned': () => ({
    title: '账号被平台封禁或限制',
    hint: '服务器返回账号被禁用。请登录 AI 平台控制台确认账号状态；如果是误封，联系平台客服申诉。',
  }),
  'payment-required': () => ({
    title: '账户余额不足',
    hint: '当前 AI 平台账户没钱了或欠费。请登录平台充值后再继续使用。',
  }),
  'quota-exhausted': () => ({
    title: '当月配额/额度已用完',
    hint: '这个 API Key 本月的免费/付费额度都用光了。请等下个月重置，或去平台加购额度，或换一个可用的 key。',
  }),
  'rate-limit': (err) => ({
    title: '发太快了，被平台限速',
    hint: `${err.serverMessage ? err.serverMessage.slice(0, 80) + '。' : ''}别点刷新疯狂重发——等 10-30 秒再发下一条消息，或去平台升级到更高档位。`,
  }),
  'concurrent-limit': () => ({
    title: '中转站卡池并发已打满',
    hint: '当前 API 供应商（中转站）的卡池同一时刻能跑的请求数到顶了，跟你这边没关系。等 10-20 秒让池子里的旧请求跑完再发；或者换一个别的中转站/供应商。',
  }),
  'model-not-found': (err) => ({
    title: '当前选的模型不存在或不可用',
    hint: `模型名可能拼错了${err.serverMessage ? `（服务器提示：${err.serverMessage.slice(0, 60)}）` : ''}。点设置 → 切换一个其他模型（比如 DeepSeek、Sonnet）再试。`,
  }),
  'model-unavailable': () => ({
    title: '当前模型暂时不可用',
    hint: '平台那边这个模型在过载或维护。先换一个备用模型（比如从 Opus 切到 Sonnet，或换供应商），等会儿再切回来。',
  }),
  'context-too-long': () => ({
    title: '上下文太长了，超出模型限制',
    hint: '当前对话历史超过模型一次能看的长度。开一个新会话，或者把早期的消息清理一下再继续。',
  }),
  'content-filter': () => ({
    title: '内容被平台安全策略拦截',
    hint: '模型拒绝回答当前问题（触发了安全过滤）。换个表述再试，或换一个更宽松的模型。',
  }),
  server: (err) => ({
    title: '服务器暂时故障',
    hint: `已自动重试 ${err.attempts} 次仍失败（HTTP ${err.status ?? '5xx'}）。等 1 分钟再试；如果一直不行，换一个模型或供应商。`,
  }),
  subprocess: (err) => ({
    title: 'AI agent 进程异常退出',
    hint: `${err.serverMessage ? err.serverMessage.slice(0, 80) + '。' : ''}这通常是 claude-code 或 codex 命令本地跑挂了。检查终端里有没有红色报错；重启一下 dev server 再试。`,
  }),
  'api-key-missing': () => ({
    title: '后端没有配置 API 密钥',
    hint: '当前选的后端（backend）没拿到 key。打开 .env 文件或设置页，补上对应的 API Key。',
  }),
  client: (err) => ({
    title: '请求被服务器拒绝',
    hint: `服务器返回错误${err.status ? `（${err.status}）` : ''}${err.serverMessage ? `：${err.serverMessage.slice(0, 100)}` : ''}。把当前消息换个说法再发一次。`,
  }),
  aborted: () => ({
    title: '已取消',
    hint: '本次请求被用户中止。',
  }),
  unknown: (err) => ({
    title: '未知错误',
    hint: `没能识别的错误${err.serverMessage ? `：${err.serverMessage.slice(0, 120)}` : ''}。把本条信息发给维护者帮忙排查。`,
  }),
}

const EN_EXPLAIN: Record<ChatFetchErrorKind, (err: ChatFetchError) => ErrorExplanation> = {
  offline: () => ({
    title: 'Your computer is offline',
    hint: 'The OS reports no network connection. Check WiFi / cable first.',
  }),
  dns: () => ({
    title: 'DNS lookup failed',
    hint: 'DNS server did not respond. Try switching network or rebooting your router.',
  }),
  tls: () => ({
    title: 'TLS handshake failed',
    hint: 'Often caused by wrong system clock or a proxy certificate issue. Check your system date/time.',
  }),
  refused: () => ({
    title: 'Server refused the connection',
    hint: 'The backend may be down. If running locally, confirm dev server is alive at localhost:3000.',
  }),
  timeout: () => ({
    title: 'Request timed out',
    hint: 'Server took too long to reply. Wait a few seconds; if persistent, switch to a faster model.',
  }),
  'vpn-block': () => ({
    title: 'Could not reach the AI service (likely VPN/proxy issue)',
    hint: 'VPN probably dropped or picked a bad node. Verify VPN is connected, try opening google.com; switch to global mode if you use a split-tunnel proxy.',
  }),
  network: (err) => ({
    title: 'Network error',
    hint: `Retried ${err.attempts}× without success. Check WiFi, router, and browser firewall.`,
  }),
  'auth-missing': () => ({
    title: 'API key missing',
    hint: 'Open Settings → Custom API and paste your key.',
  }),
  'auth-invalid': () => ({
    title: 'Invalid API key',
    hint: 'Key rejected by server. Re-check Settings → Custom API; regenerate on the provider site if needed.',
  }),
  'account-banned': () => ({
    title: 'Account banned or restricted',
    hint: 'Log into the provider dashboard to check account status; contact support if this is a false positive.',
  }),
  'payment-required': () => ({
    title: 'Account out of balance',
    hint: 'Top up on the provider dashboard and retry.',
  }),
  'quota-exhausted': () => ({
    title: 'Monthly quota exhausted',
    hint: 'Wait for reset, upgrade plan, or switch to a different API key.',
  }),
  'rate-limit': (err) => ({
    title: 'Rate-limited by provider',
    hint: `${err.serverMessage ? err.serverMessage.slice(0, 80) + '. ' : ''}Wait 10-30 seconds before resending; do NOT hammer retry.`,
  }),
  'concurrent-limit': () => ({
    title: 'Relay key-pool concurrency saturated',
    hint: 'The upstream API relay has run out of concurrent slots across its key pool (not your build settings). Wait 10-20 seconds or switch to another relay/provider.',
  }),
  'model-not-found': (err) => ({
    title: 'Selected model does not exist',
    hint: `${err.serverMessage ? err.serverMessage.slice(0, 60) + '. ' : ''}Open Settings and pick a different model.`,
  }),
  'model-unavailable': () => ({
    title: 'Model temporarily unavailable',
    hint: 'Provider overloaded. Try a backup model (e.g. switch Opus → Sonnet) or retry later.',
  }),
  'context-too-long': () => ({
    title: 'Conversation too long for this model',
    hint: 'Start a new session or clear older messages.',
  }),
  'content-filter': () => ({
    title: 'Blocked by content policy',
    hint: 'Rephrase the request or switch to a more permissive model.',
  }),
  server: (err) => ({
    title: 'Server error',
    hint: `Auto-retried ${err.attempts}× (HTTP ${err.status ?? '5xx'}) without success. Wait a minute or switch provider.`,
  }),
  subprocess: (err) => ({
    title: 'AI agent subprocess crashed',
    hint: `${err.serverMessage ? err.serverMessage.slice(0, 80) + '. ' : ''}Check terminal for errors; restart dev server.`,
  }),
  'api-key-missing': () => ({
    title: 'Backend API key not configured',
    hint: 'Set the key in .env or Settings.',
  }),
  client: (err) => ({
    title: 'Request rejected by server',
    hint: `Server returned${err.status ? ` ${err.status}` : ''}${err.serverMessage ? `: ${err.serverMessage.slice(0, 100)}` : ''}. Try rephrasing.`,
  }),
  aborted: () => ({ title: 'Cancelled', hint: 'Request aborted by user.' }),
  unknown: (err) => ({
    title: 'Unknown error',
    hint: `Unrecognized error${err.serverMessage ? `: ${err.serverMessage.slice(0, 120)}` : ''}. Share this with the maintainer.`,
  }),
}

export function explainChatFetchError(
  err: ChatFetchError,
  locale: 'zh' | 'en' = 'zh',
): ErrorExplanation {
  const table = locale === 'zh' ? ZH_EXPLAIN : EN_EXPLAIN
  return table[err.kind](err)
}

/** Human-readable one-liner suitable for inline display in the chat bubble. */
export function describeChatFetchError(err: ChatFetchError, locale: 'zh' | 'en' = 'zh'): string {
  const { title, hint } = explainChatFetchError(err, locale)
  return `${title}。${hint}`
}
