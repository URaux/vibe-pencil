'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import type { ArchitectProject } from '@/lib/types'

export function useAutoSave(dir: string | null) {
  const nodes = useAppStore((state) => state.nodes)
  const edges = useAppStore((state) => state.edges)
  const projectName = useAppStore((state) => state.projectName)
  const config = useAppStore((state) => state.config)
  const history = useAppStore((state) => state.history)
  const setSaveState = useAppStore((state) => state.setSaveState)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (!dir) {
      return
    }

    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    setSaveState('saving')

    const project: ArchitectProject = {
      name: projectName,
      version: '1.0',
      canvas: { nodes, edges },
      config,
      history,
    }

    let active = true
    const timeoutId = window.setTimeout(() => {
      fetch('/api/project/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dir, project }),
      })
        .then((res) => {
          if (!active) return
          if (res.ok) {
            setSaveState('saved')
          } else {
            setSaveState('error')
          }
        })
        .catch(() => {
          if (active) setSaveState('error')
        })
    }, 1000)

    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [config, dir, edges, history, nodes, projectName, setSaveState])
}
