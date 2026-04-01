# Dev Progress Dashboard — Design Spec

## Overview

An embedded dashboard page (`/dashboard`) in ArchViber for tracking development progress across canvas modules. Primary user: solo developer. Architecture keeps code clean for future team extension without premature abstractions.

## Data Model

### Hierarchy

```
Project (1)
  └── Module (N) — derived from canvas container nodes
        └── Task (N) — created by AI or manually
```

### Task Schema

```typescript
interface DashboardTask {
  id: string              // uuid
  nodeId: string          // canvas container node ID (foreign key)
  title: string           // e.g. "实现 Ctrl+Z 撤销重做"
  state: 'todo' | 'in-progress' | 'done'
  priority: 0 | 1 | 2 | 3  // P0 = critical, P3 = nice-to-have
  source: 'ai' | 'manual'  // who created it
  createdAt: string         // ISO timestamp
  updatedAt: string         // ISO timestamp
}
```

### Module Reference

Modules are NOT stored in dashboard data. They are derived at runtime from canvas `container` nodes via Zustand store. Block nodes are implementation details and do not appear as dashboard modules.

### Storage

- File: `dashboard.json` in the same directory as `arch-viber.json`
- Schema:

```json
{
  "version": 1,
  "updatedAt": "2026-03-29T00:00:00Z",
  "tasks": [
    {
      "id": "uuid",
      "nodeId": "container-1",
      "title": "实现深色模式",
      "state": "todo",
      "priority": 1,
      "source": "ai",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### Reconciliation

On every dashboard load, run `reconcileDashboard(canvasNodes, dashboardTasks)`:
1. Remove tasks whose `nodeId` no longer exists in canvas container nodes (orphan cleanup)
2. Log orphaned tasks to console for awareness
3. No auto-creation of empty entries for new containers (avoids noise)

## UI

### Route: `/dashboard`

### Layout

**Top section — Project Overview:**
- Project name (from Zustand store)
- Overall progress bar (% of done tasks / total tasks)
- Stat cards: total tasks, done, in-progress, todo

**Middle section — Module Cards Grid:**
- Responsive grid: 3 cols desktop, 2 tablet, 1 mobile
- Each card represents a canvas container node
- Card contents:
  - Module name + container color accent
  - Progress bar (done / total for this module)
  - Task count summary (e.g. "8/12")
  - Highest priority badge (P0-P3)
  - Expandable/collapsible task list

**Task list per module:**
- Each task shows: title, state badge, priority tag
- Inline state toggle (click to cycle: todo → in-progress → done)
- Delete button (with confirmation)
- Edit title inline (click to edit)

**Bottom section — AI Input:**
- Text input box: "描述你想做的功能..."
- Submit button → calls AI generate endpoint
- Shows preview of generated tasks before confirming
- User can edit/remove individual tasks before saving

### Style

- Unified with main app's claude.ai light theme
- Rounded corners (2rem cards), soft shadows
- Color: slate/gray base, blue accents, green done, amber in-progress
- Smooth expand/collapse animations
- i18n support (zh/en, same system as main app)

### Navigation

- Add dashboard icon/link to main app's top bar or sidebar
- Back button to return to canvas

## API Routes

### `POST /api/dashboard/load`
- Body: `{ dir: string }`
- Reads `<dir>/dashboard.json`
- Returns tasks array (or empty if file doesn't exist)
- Runs reconciliation against current canvas nodes

### `POST /api/dashboard/save`
- Body: `{ dir: string, tasks: DashboardTask[] }`
- Writes `dashboard.json` with version and updatedAt
- Optimistic: overwrites file (no locking for solo use)

### `POST /api/dashboard/generate`
- Body: `{ dir: string, prompt: string, backend: AgentBackend, modules: { id: string, name: string }[] }`
- Spawns agent with structured prompt including module list
- Agent returns JSON array of proposed tasks with moduleId mapping
- Returns proposed tasks for user preview (NOT auto-saved)
- Validates all nodeIds exist in provided modules list; rejects unknown references

## AI Task Generation

### Prompt Structure

```
You are a project management assistant for a software project.

The project has these modules:
- [container-1] Canvas Editor: 可视化画布与节点编辑
- [container-2] Chat Panel: AI 对话面板
...

The user says: "{user_input}"

Break this into concrete, actionable development tasks. For each task:
1. Assign it to the most relevant module by ID
2. Suggest a priority (0-3, where 0 = critical)
3. Write a clear, concise title in the user's language

Return JSON array:
[{ "nodeId": "container-1", "title": "...", "priority": 1 }]
```

### Confirmation Flow

1. User types natural language request
2. AI generates proposed tasks → displayed as editable preview cards
3. User can: edit titles, change priority, reassign modules, remove items
4. User clicks "Confirm" → tasks saved to dashboard.json

## Not Implementing (YAGNI)

- Drag-and-drop task reordering
- Gantt chart / timeline (data model has timestamps if needed later)
- Multi-project management
- Team collaboration features
- GitHub Issues sync (future consideration)
- Chat panel → dashboard auto-sync (future: via skill/command)

## Dependencies

- Zustand store (read canvas nodes)
- Existing i18n system (add dashboard keys)
- AgentRunner (for AI generate)
- Existing API patterns (project save/load)

## Testing

- Unit: reconcileDashboard logic, task CRUD operations
- Unit: AI generate prompt construction
- Integration: dashboard load/save API routes
- Manual: full flow — add tasks via AI, edit, mark done, verify persistence
