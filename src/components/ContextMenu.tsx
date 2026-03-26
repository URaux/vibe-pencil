'use client'

interface ContextMenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  tone?: 'default' | 'danger'
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="关闭上下文菜单"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        className="absolute min-w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-2xl shadow-slate-300/30 backdrop-blur"
        style={{ left: x, top: y }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              item.onSelect()
              onClose()
            }}
            disabled={item.disabled}
            className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
              item.tone === 'danger'
                ? 'text-rose-600 hover:bg-rose-50'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
