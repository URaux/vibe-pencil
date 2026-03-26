'use client'

import { useEffect, useMemo, useState } from 'react'
import { clampMaxParallel } from '@/lib/config'
import { t, type Locale } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { ProjectConfig } from '@/lib/types'

const modelOptions: Record<ProjectConfig['agent'], { value: string; label: string }[]> = {
  'claude-code': [
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { value: 'claude-opus-4-6', label: 'Opus 4.6' },
    { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  ],
  codex: [
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
  ],
}

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const config = useAppStore((state) => state.config)
  const locale = useAppStore((state) => state.locale)
  const setStoreLocale = useAppStore((state) => state.setLocale)
  const setConfig = useAppStore((state) => state.setConfig)
  const [agent, setAgent] = useState(config.agent)
  const [model, setModel] = useState(config.model)
  const [workDir, setWorkDir] = useState(config.workDir)
  const [maxParallel, setMaxParallel] = useState(String(config.maxParallel))
  const [draftLocale, setDraftLocale] = useState<Locale>(locale)

  const availableModels = useMemo(() => modelOptions[agent], [agent])

  useEffect(() => {
    if (!open) {
      return
    }

    setAgent(config.agent)
    setModel(config.model)
    setWorkDir(config.workDir)
    setMaxParallel(String(config.maxParallel))
    setDraftLocale(locale)
  }, [config.agent, config.model, config.maxParallel, config.workDir, locale, open])

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedWorkDir = workDir.trim()

    if (!trimmedWorkDir) {
      return
    }

    setStoreLocale(draftLocale)
    setConfig({
      agent,
      model,
      workDir: trimmedWorkDir,
      maxParallel: clampMaxParallel(Number(maxParallel)),
    })
    onClose()
  }

  if (!open) {
    return null
  }

  return (
    <div className="vp-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="vp-dialog-card w-full max-w-lg rounded-[2rem] p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t('settings')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('settings_desc')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="vp-button-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em]"
          >
            {t('close')}
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('agent_backend')}
            </legend>
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input
                type="radio"
                name="agent-backend"
                value="claude-code"
                checked={agent === 'claude-code'}
                onChange={() => { setAgent('claude-code'); setModel(modelOptions['claude-code'][0].value) }}
                className="h-4 w-4 accent-orange-500"
              />
              <span>Claude Code</span>
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input
                type="radio"
                name="agent-backend"
                value="codex"
                checked={agent === 'codex'}
                onChange={() => { setAgent('codex'); setModel(modelOptions['codex'][0].value) }}
                className="h-4 w-4 accent-orange-500"
              />
              <span>Codex</span>
            </label>
          </fieldset>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('model')}
            </span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="vp-input rounded-2xl px-4 py-3 text-sm"
            >
              {availableModels.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('language')}
            </span>
            <select
              value={draftLocale}
              onChange={(event) => setDraftLocale(event.target.value as Locale)}
              className="vp-input rounded-2xl px-4 py-3 text-sm"
            >
              <option value="zh">{t('chinese')}</option>
              <option value="en">{t('english')}</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('work_directory')}
            </span>
            <input
              type="text"
              value={workDir}
              onChange={(event) => setWorkDir(event.target.value)}
              placeholder="E:\\projects\\my-app"
              className="vp-input rounded-2xl px-4 py-3 text-sm"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('max_parallel')}
            </span>
            <input
              type="number"
              min={1}
              max={5}
              inputMode="numeric"
              value={maxParallel}
              onChange={(event) => setMaxParallel(event.target.value)}
              className="vp-input rounded-2xl px-4 py-3 text-sm"
            />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="vp-button-secondary rounded-xl px-4 py-2 text-sm"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={!workDir.trim()}
              className="vp-button-primary rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
