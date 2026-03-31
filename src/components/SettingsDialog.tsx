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
  gemini: 'gemini-3-flash-preview',
}

interface SkillEntry {
  name: string
  description: string
  category: string
  source: 'local' | 'github' | 'team'
  tags: string[]
  scope: Array<'global' | 'node' | 'build'>
  priority: number
}

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

type SettingsTab = 'general' | 'skills'

function SkillsPanel() {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/skills/list', { method: 'POST' })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load skills')
        return res.json() as Promise<{ skills: SkillEntry[]; total: number }>
      })
      .then((data) => setSkills(data.skills))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load skills')
      )
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-slate-400">
        {t('loading_skills')}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
        {error}
      </div>
    )
  }

  if (skills.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-slate-400">
        No skills found in skills/ directory.
      </div>
    )
  }

  // Group by source
  const grouped: Record<string, SkillEntry[]> = {}
  for (const skill of skills) {
    if (!grouped[skill.source]) grouped[skill.source] = []
    grouped[skill.source].push(skill)
  }

  const sourceOrder: Array<'local' | 'github' | 'team'> = ['local', 'github', 'team']
  const sourceLabel = (src: string) => {
    if (src === 'local') return t('source_local')
    if (src === 'github') return t('source_github')
    if (src === 'team') return t('source_team')
    return src
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        {t('skills_loaded', { count: skills.length })}
      </p>
      {sourceOrder
        .filter((src) => grouped[src]?.length)
        .map((src) => (
          <div key={src}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {sourceLabel(src)} ({grouped[src].length})
            </p>
            <div className="space-y-1">
              {grouped[src].map((skill) => {
                const key = `${skill.category}/${skill.name}`
                const isExpanded = expandedSkill === key
                return (
                  <div
                    key={key}
                    className="rounded-2xl border border-slate-200 bg-slate-50"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedSkill(isExpanded ? null : key)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
                    >
                      <span className="text-slate-300">{isExpanded ? '▼' : '▶'}</span>
                      <input
                        type="checkbox"
                        checked
                        readOnly
                        className="h-3.5 w-3.5 cursor-default accent-orange-500"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="flex-1 font-mono text-xs text-slate-700">
                        {skill.category}/{skill.name}
                      </span>
                      <span className="flex gap-1">
                        {skill.scope.map((s) => (
                          <span
                            key={s}
                            className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-500"
                          >
                            {s}
                          </span>
                        ))}
                      </span>
                      <span className="ml-2 text-[10px] font-medium text-slate-400" title={`优先级 ${skill.priority}`}>
                        {skill.priority >= 100 ? '★★★' : skill.priority >= 80 ? '★★' : '★'}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
                        {skill.description && <p className="mb-2">{skill.description}</p>}
                        {skill.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {skill.tags.map((tag) => (
                              <span key={tag} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
    </div>
  )
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
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

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
    setActiveTab('general')
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

        {/* Tab bar */}
        <div className="mb-5 flex gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`flex-1 rounded-xl px-4 py-2 text-xs font-medium uppercase tracking-[0.15em] transition-colors ${
              activeTab === 'general'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t('settings')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('skills')}
            className={`flex-1 rounded-xl px-4 py-2 text-xs font-medium uppercase tracking-[0.15em] transition-colors ${
              activeTab === 'skills'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t('skills_tab')}
          </button>
        </div>

        {activeTab === 'skills' ? (
          <div className="max-h-[420px] overflow-y-auto">
            <SkillsPanel />
          </div>
        ) : (
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
        )}
      </div>
    </div>
  )
}
