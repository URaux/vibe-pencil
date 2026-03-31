'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'

interface Option {
  number: string
  text: string
}

interface OptionCardsProps {
  options: Option[]
  onSelect: (text: string) => void
  disabled?: boolean
}

export function OptionCards({ options, onSelect, disabled }: OptionCardsProps) {
  const [customText, setCustomText] = useState('')
  const locale = useAppStore((state) => state.locale)
  const placeholder = locale === 'zh' ? '其他想法...' : 'Something else...'

  return (
    <div className="mt-3 space-y-2">
      {options.map((opt) => (
        <button
          key={opt.number}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(opt.text)}
          className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm transition hover:border-orange-300 hover:bg-orange-50 disabled:opacity-50"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">
            {opt.number}
          </span>
          <span className="flex-1 text-slate-700" dangerouslySetInnerHTML={{
            __html: opt.text
              .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
              .replace(/\*(.+?)\*/g, '<em>$1</em>')
              .replace(/`(.+?)`/g, '<code class="rounded bg-slate-100 px-1 text-xs">$1</code>')
          }} />
          <span className="text-slate-300">→</span>
        </button>
      ))}
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2">
        <span className="text-slate-300 text-sm">✏️</span>
        <input
          type="text"
          placeholder={placeholder}
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customText.trim()) {
              onSelect(customText.trim())
              setCustomText('')
            }
          }}
          disabled={disabled}
          className="flex-1 bg-transparent text-sm text-slate-600 placeholder:text-slate-300 focus:outline-none"
        />
      </div>
    </div>
  )
}
