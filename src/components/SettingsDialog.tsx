'use client'

import { useCallback, useEffect, useState } from 'react'
import { clampMaxParallel } from '@/lib/config'
import { t, type Locale } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { AgentBackendType } from '@/lib/types'

const BACKEND_OPTIONS: { value: AgentBackendType; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
]

const DEFAULT_MODELS: Record<AgentBackendType, string> = {
  'claude-code': 'claude-sonnet-4-6',
  codex: 'gpt-5.4',
  gemini: 'gemini-2.5-pro',
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
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)

  const fetchModels = useCallback(async (backend: AgentBackendType) => {
    setLoadingModels(true)
    try {
      const response = await fetch(`/api/models?backend=${backend}`)
      if (response.ok) {
        const data = (await response.json()) as { models: string[] }
        setModels(data.models)
      }
    } catch {
      setModels([])
    } finally {
      setLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }

    setAgent(config.agent)
    setModel(config.model)
    setWorkDir(config.workDir)
    setMaxParallel(String(config.maxParallel))
    setDraftLocale(locale)
    void fetchModels(config.agent)
  }, [config.agent, config.model, config.maxParallel, config.workDir, locale, open, fetchModels])

  function handleBackendChange(backend: AgentBackendType) {
    setAgent(backend)
    setModel(DEFAULT_MODELS[backend])
    void fetchModels(backend)
  }

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
            {BACKEND_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
              >
                <input
                  type="radio"
                  name="agent-backend"
                  value={opt.value}
                  checked={agent === opt.value}
                  onChange={() => handleBackendChange(opt.value)}
                  className="h-4 w-4 accent-orange-500"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </fieldset>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t('model')}
              {loadingModels && (
                <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                  {t('loading_models')}
                </span>
              )}
            </span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="vp-input rounded-2xl px-4 py-3 text-sm"
              disabled={loadingModels}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              {models.length > 0 && !models.includes(model) && (
                <option value={model}>{model}</option>
              )}
              {models.length === 0 && (
                <option value={model}>{model}</option>
              )}
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
