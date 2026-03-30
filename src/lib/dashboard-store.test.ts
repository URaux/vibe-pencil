import { describe, expect, it, vi } from 'vitest'
import { createTask, deleteTask, reconcileDashboard, updateTask } from './dashboard-store'
import type { DashboardTask } from './dashboard-store'

describe('reconcileDashboard', () => {
  it('removes tasks whose nodeId is not present in container nodes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const tasks: DashboardTask[] = [
      {
        id: 'task-1',
        nodeId: 'container-1',
        title: 'Keep me',
        state: 'todo',
        priority: 1,
        source: 'manual',
        createdAt: '2026-03-29T00:00:00.000Z',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
      {
        id: 'task-2',
        nodeId: 'container-2',
        title: 'Remove me',
        state: 'done',
        priority: 2,
        source: 'ai',
        createdAt: '2026-03-29T00:00:00.000Z',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
    ]

    const result = reconcileDashboard(
      [{ id: 'container-1', type: 'container', position: { x: 0, y: 0 }, data: { name: '', color: 'blue', collapsed: false } }],
      tasks
    )

    expect(result).toEqual([tasks[0]])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('keeps tasks whose nodeId exists', () => {
    const tasks: DashboardTask[] = [
      {
        id: 'task-1',
        nodeId: 'container-1',
        title: 'Task',
        state: 'in-progress',
        priority: 0,
        source: 'manual',
        createdAt: '2026-03-29T00:00:00.000Z',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
    ]

    const result = reconcileDashboard(
      [{ id: 'container-1', type: 'container', position: { x: 0, y: 0 }, data: { name: '', color: 'blue', collapsed: false } }],
      tasks
    )

    expect(result).toEqual(tasks)
  })

  it('handles empty inputs', () => {
    expect(reconcileDashboard([], [])).toEqual([])
    expect(
      reconcileDashboard([], [
        {
          id: 'task-1',
          nodeId: 'missing',
          title: 'Task',
          state: 'todo',
          priority: 3,
          source: 'manual',
          createdAt: '2026-03-29T00:00:00.000Z',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
      ])
    ).toEqual([])
  })
})

describe('dashboard CRUD helpers', () => {
  it('createTask adds a task with generated id and timestamps', () => {
    const result = createTask([], {
      nodeId: 'container-1',
      title: 'New task',
      state: 'todo',
      priority: 2,
      source: 'ai',
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      nodeId: 'container-1',
      title: 'New task',
      state: 'todo',
      priority: 2,
      source: 'ai',
    })
    expect(result[0].id).toBeTruthy()
    expect(Date.parse(result[0].createdAt)).not.toBeNaN()
    expect(Date.parse(result[0].updatedAt)).not.toBeNaN()
  })

  it('updateTask changes only specified fields and refreshes updatedAt', async () => {
    const tasks: DashboardTask[] = [
      {
        id: 'task-1',
        nodeId: 'container-1',
        title: 'Old title',
        state: 'todo',
        priority: 3,
        source: 'manual',
        createdAt: '2026-03-29T00:00:00.000Z',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
    ]

    await new Promise((resolve) => setTimeout(resolve, 5))
    const result = updateTask(tasks, 'task-1', { title: 'New title', state: 'done' })

    expect(result[0]).toMatchObject({
      id: 'task-1',
      nodeId: 'container-1',
      title: 'New title',
      state: 'done',
      priority: 3,
      source: 'manual',
      createdAt: '2026-03-29T00:00:00.000Z',
    })
    expect(Date.parse(result[0].updatedAt)).toBeGreaterThan(Date.parse(tasks[0].updatedAt))
  })

  it('deleteTask removes the matching task and leaves others unchanged', () => {
    const tasks: DashboardTask[] = [
      {
        id: 'task-1',
        nodeId: 'container-1',
        title: 'Keep',
        state: 'todo',
        priority: 1,
        source: 'manual',
        createdAt: '2026-03-29T00:00:00.000Z',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
      {
        id: 'task-2',
        nodeId: 'container-2',
        title: 'Delete',
        state: 'done',
        priority: 0,
        source: 'ai',
        createdAt: '2026-03-29T00:00:00.000Z',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
    ]

    expect(deleteTask(tasks, 'task-2')).toEqual([tasks[0]])
  })
})
