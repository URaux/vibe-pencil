import type { Node } from '@xyflow/react'
import type { CanvasNodeData } from '@/lib/types'

export interface DashboardTask {
  id: string
  nodeId: string
  title: string
  state: 'todo' | 'in-progress' | 'done'
  priority: 0 | 1 | 2 | 3
  source: 'ai' | 'manual'
  createdAt: string
  updatedAt: string
}

export interface DashboardFile {
  version: 1
  updatedAt: string
  tasks: DashboardTask[]
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return require('crypto').randomUUID() as string
}

export function reconcileDashboard(
  containerNodes: Node<CanvasNodeData>[],
  tasks: DashboardTask[]
): DashboardTask[] {
  const containerIds = new Set(
    containerNodes
      .filter((node) => node.type === 'container')
      .map((node) => node.id)
  )

  return tasks.filter((task) => {
    const exists = containerIds.has(task.nodeId)

    if (!exists) {
      console.warn('[dashboard] Removed orphaned task', task)
    }

    return exists
  })
}

export function createTask(
  tasks: DashboardTask[],
  partial: Omit<DashboardTask, 'id' | 'createdAt' | 'updatedAt'>
): DashboardTask[] {
  const now = new Date().toISOString()

  return [
    ...tasks,
    {
      ...partial,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    },
  ]
}

export function updateTask(
  tasks: DashboardTask[],
  id: string,
  changes: Partial<Pick<DashboardTask, 'title' | 'state' | 'priority'>>
): DashboardTask[] {
  const now = new Date().toISOString()

  return tasks.map((task) =>
    task.id === id
      ? {
          ...task,
          ...changes,
          updatedAt: now,
        }
      : task
  )
}

export function deleteTask(tasks: DashboardTask[], id: string): DashboardTask[] {
  return tasks.filter((task) => task.id !== id)
}
