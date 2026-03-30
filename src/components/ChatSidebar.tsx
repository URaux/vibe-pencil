'use client'

import { useAppStore } from '@/lib/store'
import { t } from '@/lib/i18n'

export function ChatSidebar() {
  const chatSessions = useAppStore((s) => s.chatSessions)
  const activeChatSessionId = useAppStore((s) => s.activeChatSessionId)
  const createChatSession = useAppStore((s) => s.createChatSession)
  const switchChatSession = useAppStore((s) => s.switchChatSession)
  const deleteChatSession = useAppStore((s) => s.deleteChatSession)

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t('recents')}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => createChatSession()}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            + {t('new_chat')}
          </button>
          <button
            type="button"
            onClick={() => useAppStore.getState().setChatSidebarOpen(false)}
            className="rounded p-1 text-slate-400 hover:text-slate-600"
            title="Collapse sidebar"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {chatSessions.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-400">
            {t('no_conversations')}
          </div>
        ) : (
          <ul className="py-1">
            {chatSessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => switchChatSession(session.id)}
                  className={`group flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                    session.id === activeChatSessionId
                      ? 'bg-slate-100 font-medium text-slate-900'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {session.title || t('untitled_chat')}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteChatSession(session.id)
                    }}
                    className="shrink-0 rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
