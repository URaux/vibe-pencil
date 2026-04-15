'use client'

import { Fragment, useState, type ReactNode } from 'react'
import { useAppStore } from '@/lib/store'

interface Option {
  number: string
  text: string
}

export interface MultiSubmission {
  selections: string[]
  ordered: boolean
}

interface OptionCardsProps {
  options: Option[]
  /** Single-select callback: emits a normal user chat message. */
  onSelect: (text: string) => void
  /** Multi-select callback: emits a structured form submission (no chat message). */
  onSubmitMulti?: (payload: MultiSubmission) => void
  disabled?: boolean
  /** Single-mode trace highlight (the option that was already selected). */
  selectedText?: string
  /** Multi-mode trace highlight (the options that were already selected, in order). */
  selectedTexts?: string[]
  // v2 fields
  multi?: boolean
  ordered?: boolean
  min?: number
  max?: number
  allowCustom?: boolean
  allowIndifferent?: boolean
}

const INDIFFERENT_LABEL_ZH = '无所谓'
const INDIFFERENT_LABEL_EN = "Don't care"
const CUSTOM_PLACEHOLDER_ZH = '其他（自己填）'
const CUSTOM_PLACEHOLDER_EN = 'Something else (type your own)'
const RANK_BADGES = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

function rankBadge(idx: number): string {
  return RANK_BADGES[idx] ?? `(${idx + 1})`
}

function renderOptionInner(text: string): ReactNode {
  // Tokenize into plain / **bold** / *italic* / `code` segments.
  // Safe React elements only — never returns raw HTML, so LLM-authored
  // content like `**<img src=x onerror=alert(1)>**` cannot inject markup.
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const [, , bold, italic, code] = match
    if (bold !== undefined) {
      nodes.push(<strong key={`b-${key++}`}>{bold}</strong>)
    } else if (italic !== undefined) {
      nodes.push(<em key={`i-${key++}`}>{italic}</em>)
    } else if (code !== undefined) {
      nodes.push(
        <code key={`c-${key++}`} className="rounded bg-slate-100 px-1 text-xs">
          {code}
        </code>,
      )
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return <Fragment>{nodes}</Fragment>
}

export function OptionCards({
  options,
  onSelect,
  onSubmitMulti,
  disabled,
  selectedText,
  selectedTexts,
  multi: multiProp,
  ordered: orderedProp,
  min,
  max,
  allowCustom,
  allowIndifferent,
}: OptionCardsProps) {
  const locale = useAppStore((state) => state.locale)
  const isZh = locale === 'zh'
  const customPlaceholder = isZh ? CUSTOM_PLACEHOLDER_ZH : CUSTOM_PLACEHOLDER_EN
  const indifferentLabel = isZh ? INDIFFERENT_LABEL_ZH : INDIFFERENT_LABEL_EN

  // ordered implies multi
  const ordered = !!orderedProp
  const multi = !!multiProp || ordered
  const hardMax = max ?? options.length + (allowCustom ? 1 : 0) + (allowIndifferent ? 1 : 0)
  const softMin = min ?? 1

  // Single-mode loose custom input (preserves legacy behaviour)
  const [singleCustom, setSingleCustom] = useState('')

  // Multi-mode state
  const [picked, setPicked] = useState<string[]>([]) // selection order
  const [indifferentPicked, setIndifferentPicked] = useState(false)
  const [customDraft, setCustomDraft] = useState('')

  const isHistorical = disabled === true
  const historicalSet = new Set(selectedTexts ?? [])

  // ===== Single-select (legacy + indifferent + custom) =====
  if (!multi) {
    return (
      <div className="mt-3 space-y-2">
        {options.map((opt) => {
          const isSelected = selectedText !== undefined && opt.text === selectedText
          return (
            <button
              key={opt.number}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(opt.text)}
              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${
                isSelected
                  ? 'border-orange-300 bg-orange-50'
                  : 'border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50'
              } disabled:opacity-50`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                  isSelected ? 'bg-orange-200 text-orange-700' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {opt.number}
              </span>
              <span
                className={`flex-1 ${isSelected ? 'text-orange-700 font-medium' : 'text-slate-700'}`}
              >
                {renderOptionInner(opt.text)}
              </span>
              <span className={isSelected ? 'text-orange-400' : 'text-slate-300'}>→</span>
            </button>
          )
        })}
        {allowIndifferent ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(indifferentLabel)}
            className={`flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left text-sm transition ${
              selectedText === indifferentLabel
                ? 'border-orange-300 bg-orange-50 text-orange-700'
                : 'border-slate-300 bg-slate-50 text-slate-500 hover:border-orange-300 hover:bg-orange-50'
            } disabled:opacity-50`}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-xs font-semibold text-slate-500">
              ?
            </span>
            <span className="flex-1">{indifferentLabel}</span>
          </button>
        ) : null}
        {!disabled && allowCustom !== false ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2">
            <span className="text-slate-300 text-sm">✏️</span>
            <input
              type="text"
              placeholder={isZh ? '其他想法...' : 'Something else...'}
              value={singleCustom}
              onChange={(e) => setSingleCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && singleCustom.trim()) {
                  onSelect(singleCustom.trim())
                  setSingleCustom('')
                }
              }}
              disabled={disabled}
              className="flex-1 bg-transparent text-sm text-slate-600 placeholder:text-slate-300 focus:outline-none"
            />
          </div>
        ) : null}
      </div>
    )
  }

  // ===== Multi-select (ordered + unordered) =====
  const togglePick = (text: string) => {
    if (disabled) return
    setIndifferentPicked(false)
    setPicked((prev) => {
      if (prev.includes(text)) {
        return prev.filter((t) => t !== text)
      }
      // hard cap: ignore if at max
      if (prev.length >= hardMax) return prev
      return [...prev, text]
    })
  }

  const toggleIndifferent = () => {
    if (disabled) return
    setIndifferentPicked((prev) => {
      const next = !prev
      if (next) {
        setPicked([])
      }
      return next
    })
  }

  const customTrim = customDraft.trim()
  const effectiveSelections = indifferentPicked
    ? [indifferentLabel]
    : customTrim
      ? [...picked, customTrim]
      : picked

  const submitDisabled =
    disabled ||
    effectiveSelections.length === 0 ||
    effectiveSelections.length > hardMax ||
    (!indifferentPicked && effectiveSelections.length < softMin)

  const hintLabel = (() => {
    if (indifferentPicked) return isZh ? '已选「无所谓」' : `Selected: ${indifferentLabel}`
    const lo = softMin
    const hi = max ?? options.length
    if (lo === hi) {
      return isZh ? `请选 ${lo} 个` : `Pick ${lo}`
    }
    return isZh ? `建议选 ${lo}–${hi} 个` : `Pick ${lo}–${hi}`
  })()

  return (
    <div className="mt-3 space-y-2">
      {options.map((opt) => {
        const pickedIdx = picked.indexOf(opt.text)
        const isPicked = pickedIdx >= 0
        const isHistoricalPick = isHistorical && historicalSet.has(opt.text)
        const showSelected = isPicked || isHistoricalPick
        // Historical rank when ordered: position in selectedTexts array
        const historicalRank = isHistoricalPick ? (selectedTexts ?? []).indexOf(opt.text) : -1
        const displayRank = isPicked ? pickedIdx : historicalRank
        return (
          <button
            key={opt.number}
            type="button"
            disabled={disabled}
            onClick={() => togglePick(opt.text)}
            className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${
              showSelected
                ? 'border-orange-300 bg-orange-50'
                : 'border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50'
            } disabled:opacity-50`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${
                showSelected
                  ? 'border-orange-400 bg-orange-400 text-white'
                  : 'border-slate-300 bg-white text-transparent'
              }`}
              aria-hidden
            >
              ✓
            </span>
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                showSelected ? 'bg-orange-200 text-orange-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {opt.number}
            </span>
            <span
              className={`flex-1 ${showSelected ? 'text-orange-700 font-medium' : 'text-slate-700'}`}
            >
              {renderOptionInner(opt.text)}
            </span>
            {displayRank >= 0 ? (
              <span className="ml-2 text-orange-500 text-base font-bold tabular-nums">
                {rankBadge(displayRank)}
              </span>
            ) : null}
          </button>
        )
      })}

      {allowCustom ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2">
          <span className="text-slate-300 text-sm">✏️</span>
          <input
            type="text"
            placeholder={customPlaceholder}
            value={customDraft}
            onChange={(e) => {
              setCustomDraft(e.target.value)
              if (e.target.value.trim()) setIndifferentPicked(false)
            }}
            disabled={disabled}
            className="flex-1 bg-transparent text-sm text-slate-600 placeholder:text-slate-300 focus:outline-none"
          />
        </div>
      ) : null}

      {allowIndifferent ? (
        <button
          type="button"
          disabled={disabled}
          onClick={toggleIndifferent}
          className={`flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left text-sm transition ${
            indifferentPicked || (isHistorical && historicalSet.has(indifferentLabel))
              ? 'border-orange-300 bg-orange-50 text-orange-700'
              : 'border-slate-300 bg-slate-50 text-slate-500 hover:border-orange-300 hover:bg-orange-50'
          } disabled:opacity-50`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-xs font-semibold text-slate-500">
            ?
          </span>
          <span className="flex-1">{indifferentLabel}</span>
        </button>
      ) : null}

      {!disabled ? (
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-slate-400">{hintLabel}</span>
          <button
            type="button"
            disabled={submitDisabled}
            onClick={() => {
              if (!onSubmitMulti) return
              onSubmitMulti({ selections: effectiveSelections, ordered })
              // reset internal state after submission so re-renders don't double-submit
              setPicked([])
              setIndifferentPicked(false)
              setCustomDraft('')
            }}
            className="rounded-full bg-orange-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isZh ? '提交' : 'Submit'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
