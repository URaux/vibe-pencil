'use client'

import { useEffect, useState } from 'react'
import type { Node } from '@xyflow/react'
import Link from 'next/link'
import { createTask, deleteTask, updateTask, type DashboardTask } from '@/lib/dashboard-store'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { CanvasNodeData, ContainerColor, ContainerNodeData } from '@/lib/types'

type PreviewTask = {
  nodeId: string
  title: string
  priority: 0 | 1 | 2 | 3
}

type BannerState =
  | { tone: 'error'; message: string }
  | { tone: 'success'; message: string }
  | null

const colorAccentClass: Record<ContainerColor, string> = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  purple: 'bg-purple-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  slate: 'bg-slate-500',
}

const colorSurfaceClass: Record<ContainerColor, string> = {
  blue: 'from-blue-50 to-white',
  green: 'from-green-50 to-white',
  purple: 'from-purple-50 to-white',
  amber: 'from-amber-50 to-white',
  rose: 'from-rose-50 to-white',
  slate: 'from-slate-100 to-white',
}

function getModuleMeta(node: Node<CanvasNodeData>) {
  const data = node.data as ContainerNodeData

  return {
    id: node.id,
    name: typeof data.name === 'string' && data.name.trim() ? data.name : node.id,
    color: data.color ?? 'blue',
  }
}

function cycleTaskState(state: DashboardTask['state']): DashboardTask['state'] {
  if (state === 'todo') return 'in-progress'
  if (state === 'in-progress') return 'done'
  return 'todo'
}

function getTaskStateLabel(state: DashboardTask['state']) {
  if (state === 'in-progress') return t('state_in_progress')
  if (state === 'done') return t('state_done')
  return t('state_todo')
}

function getTaskStateClasses(state: DashboardTask['state']) {
  if (state === 'in-progress') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }

  if (state === 'done') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function getPriorityLabel(priority: 0 | 1 | 2 | 3) {
  return t(`priority_p${priority}`)
}

function getPriorityClasses(priority: 0 | 1 | 2 | 3) {
  if (priority === 0) return 'border-rose-200 bg-rose-50 text-rose-700'
  if (priority === 1) return 'border-amber-200 bg-amber-50 text-amber-700'
  if (priority === 2) return 'border-sky-200 bg-sky-50 text-sky-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="h-3 w-20 rounded bg-slate-200" />
            <div className="mt-4 h-8 w-12 rounded bg-slate-200" />
            <div className="mt-4 h-2 w-full rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="h-4 w-32 rounded bg-slate-200" />
            <div className="mt-4 h-2 w-full rounded bg-slate-100" />
            <div className="mt-5 space-y-3">
              <div className="h-14 rounded-xl bg-slate-50" />
              <div className="h-14 rounded-xl bg-slate-50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const projectName = useAppStore((state) => state.projectName)
  const config = useAppStore((state) => state.config)
  const nodes = useAppStore((state) => state.nodes)
  useAppStore((state) => state.locale)
  const workDir = config.workDir
  const containerNodes = nodes.filter((node) => node.type === 'container')
  const containerSignature = containerNodes.map((node) => node.id).join('|')

  const [tasks, setTasks] = useState<DashboardTask[]>([])
  const [previewTasks, setPreviewTasks] = useState<PreviewTask[]>([])
  const [aiPrompt, setAiPrompt] = useState('')
  const [banner, setBanner] = useState<BannerState>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!banner) {
      return
    }

    const timeout = window.setTimeout(() => setBanner(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [banner])

  useEffect(() => {
    setExpandedModules((current) => {
      const next = { ...current }
      let changed = false

      for (const node of containerNodes) {
        if (!(node.id in next)) {
          next[node.id] = true
          changed = true
        }
      }

      for (const key of Object.keys(next)) {
        if (!containerNodes.some((node) => node.id === key)) {
          delete next[key]
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [containerSignature, containerNodes])

  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      setIsLoading(true)

      try {
        const response = await fetch('/api/dashboard/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dir: workDir,
            containerNodeIds: containerNodes.map((node) => node.id),
          }),
        })

        if (!response.ok) {
          throw new Error('load failed')
        }

        const data = (await response.json()) as { tasks?: DashboardTask[] }

        if (!cancelled) {
          setTasks(Array.isArray(data.tasks) ? data.tasks : [])
        }
      } catch {
        if (!cancelled) {
          setBanner({ tone: 'error', message: t('load_failed') })
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadDashboard()

    return () => {
      cancelled = true
    }
  }, [containerSignature, workDir])

  async function saveTasksToServer(nextTasks: DashboardTask[]) {
    setIsSaving(true)

    try {
      const response = await fetch('/api/dashboard/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: workDir, tasks: nextTasks }),
      })

      if (!response.ok) {
        throw new Error('save failed')
      }
    } catch {
      setBanner({ tone: 'error', message: t('save_failed') })
    } finally {
      setIsSaving(false)
    }
  }

  async function commitTasks(nextTasks: DashboardTask[]) {
    setTasks(nextTasks)
    await saveTasksToServer(nextTasks)
  }

  function startEditing(task: DashboardTask) {
    setEditingTaskId(task.id)
    setEditingTitle(task.title)
  }

  async function finishEditing(task: DashboardTask) {
    const nextTitle = editingTitle.trim() || task.title
    setEditingTaskId(null)
    setEditingTitle('')

    if (nextTitle === task.title) {
      return
    }

    await commitTasks(updateTask(tasks, task.id, { title: nextTitle }))
  }

  async function handleCycleState(task: DashboardTask) {
    await commitTasks(updateTask(tasks, task.id, { state: cycleTaskState(task.state) }))
  }

  async function handleDeleteTask(task: DashboardTask) {
    if (!window.confirm(t('delete_task_confirm'))) {
      return
    }

    await commitTasks(deleteTask(tasks, task.id))
  }

  async function handlePriorityChange(task: DashboardTask, priority: 0 | 1 | 2 | 3) {
    await commitTasks(updateTask(tasks, task.id, { priority }))
  }

  async function handleGenerate() {
    if (!aiPrompt.trim() || containerNodes.length === 0) {
      return
    }

    setIsGenerating(true)

    try {
      const response = await fetch('/api/dashboard/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dir: workDir,
          prompt: aiPrompt,
          backend: config.agent,
          model: config.model,
          modules: containerNodes.map((node) => {
            const module = getModuleMeta(node)
            return { id: module.id, name: module.name }
          }),
        }),
      })

      if (!response.ok) {
        throw new Error('generate failed')
      }

      const data = (await response.json()) as { tasks?: PreviewTask[] }
      setPreviewTasks(Array.isArray(data.tasks) ? data.tasks : [])
    } catch {
      setBanner({ tone: 'error', message: t('generate_failed') })
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleConfirmPreview() {
    let nextTasks = tasks
    let addedCount = 0

    for (const preview of previewTasks) {
      if (!preview.title.trim()) {
        continue
      }

      nextTasks = createTask(nextTasks, {
        nodeId: preview.nodeId,
        title: preview.title.trim(),
        priority: preview.priority,
        source: 'ai',
        state: 'todo',
      })
      addedCount += 1
    }

    setPreviewTasks([])
    setAiPrompt('')
    setBanner({ tone: 'success', message: t('tasks_added', { count: addedCount }) })
    await commitTasks(nextTasks)
  }

  const moduleMeta = containerNodes.map(getModuleMeta)
  const totalTasks = tasks.length
  const doneTasks = tasks.filter((task) => task.state === 'done').length
  const inProgressTasks = tasks.filter((task) => task.state === 'in-progress').length
  const todoTasks = tasks.filter((task) => task.state === 'todo').length
  const overallProgress = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100)

  return (
    <main className="min-h-screen bg-[var(--background)] text-slate-800">
      {banner ? (
        <div className="sticky top-0 z-20 px-6 pt-4">
          <div
            className={`mx-auto max-w-7xl rounded-2xl border px-4 py-3 text-sm shadow-sm ${
              banner.tone === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {banner.message}
          </div>
        </div>
      ) : null}

      <header className="vp-panel sticky top-0 z-10 flex items-center justify-between border-b border-slate-200/80 px-6 py-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="vp-button-ghost rounded-full p-2" title={t('back_to_canvas')}>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{t('dashboard_title')}</h1>
            <p className="text-sm text-slate-500">{projectName}</p>
          </div>
        </div>
        <div className="text-xs text-slate-400">{isSaving ? t('saving') : ''}</div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        {isLoading ? (
          <DashboardSkeleton />
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">{t('total_tasks')}</p>
                <p className="mt-3 text-3xl font-semibold text-slate-900">{totalTasks}</p>
                <div className="mt-4 h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-slate-400" style={{ width: '100%' }} />
                </div>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">{t('done_tasks')}</p>
                <p className="mt-3 text-3xl font-semibold text-emerald-600">{doneTasks}</p>
                <div className="mt-4 h-2 rounded-full bg-emerald-100">
                  <div
                    className="h-2 rounded-full bg-emerald-500"
                    style={{ width: `${totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100)}%` }}
                  />
                </div>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">{t('in_progress_tasks')}</p>
                <p className="mt-3 text-3xl font-semibold text-amber-600">{inProgressTasks}</p>
                <div className="mt-4 h-2 rounded-full bg-amber-100">
                  <div
                    className="h-2 rounded-full bg-amber-500"
                    style={{ width: `${totalTasks === 0 ? 0 : Math.round((inProgressTasks / totalTasks) * 100)}%` }}
                  />
                </div>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-500">{t('overall_progress')}</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-900">{overallProgress}%</p>
                  </div>
                  <div className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
                    {t('todo_tasks')}: {todoTasks}
                  </div>
                </div>
                <div className="mt-4 h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-[var(--accent)]"
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>
              </article>
            </section>

            {moduleMeta.length === 0 ? (
              <section className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center shadow-sm">
                <p className="text-base font-medium text-slate-700">{t('no_modules')}</p>
              </section>
            ) : (
              <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {moduleMeta.map((module) => {
                  const moduleTasks = tasks.filter((task) => task.nodeId === module.id)
                  const moduleDone = moduleTasks.filter((task) => task.state === 'done').length
                  const moduleProgress =
                    moduleTasks.length === 0 ? 0 : Math.round((moduleDone / moduleTasks.length) * 100)

                  return (
                    <article
                      key={module.id}
                      className={`rounded-2xl border border-slate-200 bg-gradient-to-br ${colorSurfaceClass[module.color]} p-5 shadow-sm`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <span className={`h-3 w-3 rounded-full ${colorAccentClass[module.color]}`} />
                            <h2 className="truncate text-base font-semibold text-slate-900">{module.name}</h2>
                          </div>
                          <p className="mt-2 text-sm text-slate-500">
                            {moduleTasks.length} {t('total_tasks')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedModules((current) => ({
                              ...current,
                              [module.id]: !current[module.id],
                            }))
                          }
                          className="vp-button-ghost rounded-full p-2"
                          aria-label={expandedModules[module.id] ? t('collapse') : t('expand')}
                        >
                          <svg
                            className={`h-4 w-4 transition-transform ${
                              expandedModules[module.id] ? 'rotate-180' : ''
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>

                      <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                          <span>{moduleProgress}%</span>
                          <span>
                            {moduleDone}/{moduleTasks.length || 0}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white/80">
                          <div
                            className={`h-2 rounded-full ${colorAccentClass[module.color]}`}
                            style={{ width: `${moduleProgress}%` }}
                          />
                        </div>
                      </div>

                      {expandedModules[module.id] ? (
                        <div className="mt-5 space-y-3">
                          {moduleTasks.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-white/80 px-4 py-6 text-center text-sm text-slate-500">
                              <p>{t('no_tasks')}</p>
                              <p className="mt-1 text-xs text-slate-400">{t('add_tasks_hint')}</p>
                            </div>
                          ) : (
                            moduleTasks.map((task) => (
                              <div key={task.id} className="rounded-xl border border-white/80 bg-white/90 p-4 shadow-sm">
                                <div className="flex items-start gap-3">
                                  <div className="min-w-0 flex-1">
                                    {editingTaskId === task.id ? (
                                      <input
                                        autoFocus
                                        type="text"
                                        value={editingTitle}
                                        onChange={(event) => setEditingTitle(event.target.value)}
                                        onBlur={() => {
                                          void finishEditing(task)
                                        }}
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter') {
                                            event.preventDefault()
                                            void finishEditing(task)
                                          }

                                          if (event.key === 'Escape') {
                                            setEditingTaskId(null)
                                            setEditingTitle('')
                                          }
                                        }}
                                        className="vp-input rounded-xl px-3 py-2 text-sm"
                                      />
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => startEditing(task)}
                                        className="text-left text-sm font-medium text-slate-900 hover:text-[var(--accent-strong)]"
                                      >
                                        {task.title}
                                      </button>
                                    )}
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void handleCycleState(task)
                                        }}
                                        className={`rounded-full border px-3 py-1 text-xs font-medium ${getTaskStateClasses(task.state)}`}
                                      >
                                        {getTaskStateLabel(task.state)}
                                      </button>
                                      <select
                                        value={task.priority}
                                        onChange={(event) => {
                                          void handlePriorityChange(task, Number(event.target.value) as 0 | 1 | 2 | 3)
                                        }}
                                        className={`rounded-full border px-3 py-1 text-xs font-medium ${getPriorityClasses(task.priority)}`}
                                      >
                                        {[0, 1, 2, 3].map((priority) => (
                                          <option key={priority} value={priority}>
                                            {getPriorityLabel(priority as 0 | 1 | 2 | 3)}
                                          </option>
                                        ))}
                                      </select>
                                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">
                                        {task.source}
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleDeleteTask(task)
                                    }}
                                    className="vp-button-ghost rounded-full p-2 text-rose-500"
                                    aria-label={t('delete')}
                                  >
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </section>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('ai_task_generation')}</h2>
              <p className="mb-4 text-sm text-slate-500">{t('add_tasks_hint')}</p>
              <div className="flex flex-col gap-3 lg:flex-row">
                <textarea
                  className="vp-input flex-1 resize-none rounded-xl px-4 py-3 text-sm"
                  rows={3}
                  placeholder={t('ai_generate_placeholder')}
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    void handleGenerate()
                  }}
                  disabled={isGenerating || !aiPrompt.trim() || containerNodes.length === 0}
                  className="vp-button-primary self-start rounded-xl px-5 py-3 text-sm font-medium disabled:opacity-50"
                >
                  {isGenerating ? t('generating') : t('generate')}
                </button>
              </div>

              {previewTasks.length > 0 ? (
                <div className="mt-5">
                  <h3 className="mb-3 text-sm font-medium text-slate-600">
                    {t('preview_tasks')} ({previewTasks.length})
                  </h3>
                  <div className="space-y-2">
                    {previewTasks.map((task, index) => {
                      const module = moduleMeta.find((entry) => entry.id === task.nodeId)

                      return (
                        <div key={`${task.nodeId}-${index}`} className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 md:flex-row md:items-start">
                          <div className="min-w-36 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                            {module?.name ?? task.nodeId}
                          </div>
                          <input
                            type="text"
                            value={task.title}
                            onChange={(event) =>
                              setPreviewTasks((current) =>
                                current.map((entry, currentIndex) =>
                                  currentIndex === index ? { ...entry, title: event.target.value } : entry
                                )
                              )
                            }
                            className="vp-input flex-1 rounded-xl px-4 py-2 text-sm"
                          />
                          <select
                            value={task.priority}
                            onChange={(event) =>
                              setPreviewTasks((current) =>
                                current.map((entry, currentIndex) =>
                                  currentIndex === index
                                    ? { ...entry, priority: Number(event.target.value) as 0 | 1 | 2 | 3 }
                                    : entry
                                )
                              )
                            }
                            className="vp-input w-full rounded-xl px-3 py-2 text-sm md:w-28"
                          >
                            {[0, 1, 2, 3].map((priority) => (
                              <option key={priority} value={priority}>
                                {getPriorityLabel(priority as 0 | 1 | 2 | 3)}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewTasks((current) => current.filter((_, currentIndex) => currentIndex !== index))
                            }
                            className="vp-button-ghost rounded-xl px-3 py-2 text-sm text-rose-600"
                          >
                            {t('delete')}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={() => {
                        void handleConfirmPreview()
                      }}
                      className="vp-button-primary rounded-xl px-5 py-2 text-sm font-medium"
                      type="button"
                    >
                      {t('confirm_tasks')}
                    </button>
                    <button
                      onClick={() => setPreviewTasks([])}
                      className="vp-button-secondary rounded-xl px-5 py-2 text-sm font-medium"
                      type="button"
                    >
                      {t('discard_preview')}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
