'use client'

import { useEffect, useState } from 'react'
import { t } from '@/lib/i18n'

export type EnhanceStatus = 'idle' | 'enhancing' | 'done' | 'error'

interface EnhanceStatusBadgeProps {
  status: EnhanceStatus
  onDismiss?: () => void
}

export function EnhanceStatusBadge({ status, onDismiss }: EnhanceStatusBadgeProps) {
  const [visible, setVisible] = useState(true)

  // Auto-dismiss the 'done' and 'error' states after 3 seconds
  useEffect(() => {
    if (status === 'done' || status === 'error') {
      setVisible(true)
      const timer = setTimeout(() => {
        setVisible(false)
        onDismiss?.()
      }, 3000)
      return () => clearTimeout(timer)
    } else {
      setVisible(true)
    }
  }, [status, onDismiss])

  if (status === 'idle' || !visible) return null

  if (status === 'enhancing') {
    return (
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-orange-50 border border-orange-200 px-4 py-2 text-sm text-orange-700 shadow-lg animate-pulse">
        <span className="vp-spinner" />
        <span>{t('ai_reviewing')}</span>
      </div>
    )
  }

  if (status === 'done') {
    return (
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-700 shadow-lg transition-opacity duration-1000">
        <span>✓</span>
        <span>{t('enhance_complete')}</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-rose-50 border border-rose-200 px-4 py-2 text-sm text-rose-700 shadow-lg">
        <span>{t('enhance_failed')}</span>
        <button
          type="button"
          onClick={() => { setVisible(false); onDismiss?.() }}
          className="ml-1 text-rose-500 hover:text-rose-700 font-medium"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    )
  }

  return null
}
