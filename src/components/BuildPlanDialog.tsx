'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'

interface ResolvedSkillEntry {
  name: string
  reason: string
  category: string
  priority: number
}

interface BuildPlanDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (workDir?: string) => void
  waves: string[][]
  nodeNames: Map<string, string>
  nodeTechStacks: Map<string, string>
  mode: 'all' | 'selected'
}

function SkillBadge({ reason }: { reason: string }) {
  const isRequired = reason === 'required' || reason === 'build requirement' || reason === 'global scope'
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] ${
        isRequired
          ? 'bg-orange-100 text-orange-600'
          : 'bg-slate-100 text-slate-500'
      }`}
    >
      {reason}
    </span>
  )
}

interface NodeSkillsRowProps {
  nodeId: string
  nodeName: string
  techStack: string
  nodeSkills: ResolvedSkillEntry[] | null
  loadingSkills: boolean
}

function NodeSkillsRow({ nodeId: _nodeId, nodeName, techStack, nodeSkills, loadingSkills }: NodeSkillsRowProps) {
  const [expanded, setExpanded] = useState(false)

  const skillCount = nodeSkills?.length ?? 0

  return (
    <div className="rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm"
      >
        <span className="text-slate-400 text-xs">{expanded ? '▼' : '▶'}</span>
        <span className="flex-1 font-medium text-slate-700">{nodeName}</span>
        {techStack && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
            {techStack}
          </span>
        )}
        {loadingSkills ? (
          <span className="text-[10px] text-slate-400">{t('loading_skills')}</span>
        ) : (
          <span className="text-[10px] text-slate-400">
            {skillCount} {t('node_skills').toLowerCase()}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3">
          {loadingSkills ? (
            <p className="text-xs text-slate-400">{t('loading_skills')}</p>
          ) : nodeSkills && nodeSkills.length > 0 ? (
            <ul className="space-y-1.5">
              {nodeSkills.map((skill) => (
                <li key={`${skill.category}/${skill.name}`} className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-600">
                    {skill.category}/{skill.name}
                  </span>
                  <SkillBadge reason={skill.reason} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400">No skills resolved for this node.</p>
          )}
        </div>
      )}
    </div>
  )
}

export function BuildPlanDialog({
  open,
  onClose,
  onConfirm,
  waves,
  nodeNames,
  nodeTechStacks,
}: BuildPlanDialogProps) {
  const config = useAppStore((state) => state.config)
  const projectName = useAppStore((state) => state.projectName)
  useAppStore((state) => state.locale)

  const projectSlug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'untitled'
  const defaultWorkDir = `${config.workDir}/${projectSlug}`
  const [buildWorkDir, setBuildWorkDir] = useState(defaultWorkDir)

  // Reset workDir when dialog opens with new project
  useEffect(() => {
    if (open) setBuildWorkDir(defaultWorkDir)
  }, [open, defaultWorkDir])

  const totalNodes = waves.reduce((sum, wave) => sum + wave.length, 0)
  const allNodeIds = waves.flat()

  // Per-node skill data fetched from /api/skills/resolve
  const [nodeSkillsMap, setNodeSkillsMap] = useState<Record<string, ResolvedSkillEntry[]>>({})
  const [loadingSkills, setLoadingSkills] = useState(false)

  // Fetch skills when dialog opens
  useEffect(() => {
    if (!open || allNodeIds.length === 0) return

    setLoadingSkills(true)
    const nodes = allNodeIds.map((id) => ({
      id,
      techStack: nodeTechStacks.get(id) ?? undefined,
    }))

    fetch('/api/skills/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to resolve skills')
        return res.json() as Promise<{ nodeSkills: Record<string, ResolvedSkillEntry[]> }>
      })
      .then((data) => setNodeSkillsMap(data.nodeSkills))
      .catch(() => setNodeSkillsMap({}))
      .finally(() => setLoadingSkills(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Close on Escape key
  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) {
    return null
  }

  function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return createPortal(
    <div
      className="vp-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-6"
      onClick={handleBackdropClick}
    >
      <div className="vp-dialog-card w-full max-w-2xl rounded-[2rem] p-6">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {t('build_plan_title')}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {t('build_plan_subtitle', { count: totalNodes, waves: waves.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="vp-button-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em]"
          >
            {t('close')}
          </button>
        </div>

        {/* Config summary */}
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('config_summary')}
          </p>
          <div className="space-y-1 text-sm text-slate-700">
            <div className="flex gap-2">
              <span className="w-28 shrink-0 text-slate-500">{t('agent_backend')}</span>
              <span className="font-medium">{config.agent}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-28 shrink-0 text-slate-500">{t('model')}</span>
              <span className="font-medium">{config.model}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-28 shrink-0 text-slate-500">{t('work_directory')}</span>
              <input
                type="text"
                value={buildWorkDir}
                onChange={(e) => setBuildWorkDir(e.target.value)}
                className="flex-1 truncate rounded border border-slate-200 bg-white px-2 py-0.5 text-sm font-medium focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <span className="w-28 shrink-0 text-slate-500">{t('max_parallel')}</span>
              <span className="font-medium">{config.maxParallel}</span>
            </div>
          </div>
        </div>

        {/* Wave breakdown with per-node skill lists */}
        <div className="mb-6 max-h-96 space-y-4 overflow-y-auto">
          {waves.map((wave, waveIndex) => (
            <div key={waveIndex} className="rounded-2xl border border-slate-200 px-4 py-3">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t('build_plan_wave', { n: waveIndex + 1 })}
              </p>
              <div className="space-y-2">
                {wave.map((nodeId) => {
                  const nodeName = nodeNames.get(nodeId) ?? nodeId
                  const techStack = nodeTechStacks.get(nodeId) ?? ''
                  return (
                    <NodeSkillsRow
                      key={nodeId}
                      nodeId={nodeId}
                      nodeName={nodeName}
                      techStack={techStack}
                      nodeSkills={nodeSkillsMap[nodeId] ?? null}
                      loadingSkills={loadingSkills}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="vp-button-secondary rounded-full px-5 py-2 text-sm"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(buildWorkDir)}
            className="vp-button-primary rounded-full px-5 py-2 text-sm"
          >
            {t('start_build')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
