import { readRecentPersistedTurns } from '@/lib/orchestrator/log'
import type { TurnRecord } from '@/lib/orchestrator/log'
import { filterTurnsByDate } from '@/app/api/telemetry/route'

export const dynamic = 'force-dynamic'

function TelemetryRow({ turn }: { turn: TurnRecord }) {
  const ts = new Date(turn.timestamp).toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const statusColors: Record<string, string> = {
    ok: 'text-emerald-600',
    not_implemented: 'text-amber-600',
    error: 'text-red-600',
  }
  const statusColor = turn.dispatchStatus ? (statusColors[turn.dispatchStatus] ?? '') : 'text-slate-400'

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      <td className="px-2 py-1 font-mono text-[11px] text-slate-500 whitespace-nowrap">{ts}</td>
      <td className="px-2 py-1 font-mono text-[11px] text-slate-600 whitespace-nowrap">
        {turn.userPromptHash}
      </td>
      <td className="px-2 py-1 text-xs text-slate-700">{turn.intent ?? '—'}</td>
      <td className="px-2 py-1 text-xs text-slate-700 text-right tabular-nums">
        {turn.confidence !== undefined ? (turn.confidence * 100).toFixed(0) + '%' : '—'}
      </td>
      <td className="px-2 py-1 text-xs text-center">
        {turn.fallback === true ? (
          <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700">yes</span>
        ) : turn.fallback === false ? (
          <span className="text-slate-400">no</span>
        ) : (
          '—'
        )}
      </td>
      <td className={`px-2 py-1 text-xs font-medium ${statusColor}`}>
        {turn.dispatchStatus ?? '—'}
      </td>
      <td className="px-2 py-1 text-[11px] text-red-500 max-w-xs truncate" title={turn.error}>
        {turn.error ?? ''}
      </td>
    </tr>
  )
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function TelemetryPage({ searchParams }: PageProps) {
  const params = await searchParams
  const sinceParam = Array.isArray(params.since) ? params.since[0] : (params.since ?? null)
  const untilParam = Array.isArray(params.until) ? params.until[0] : (params.until ?? null)

  const allTurns = await readRecentPersistedTurns(100)
  const turns = filterTurnsByDate(allTurns, { since: sinceParam, until: untilParam })

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white shadow">
          <h1 className="text-2xl font-bold">Orchestrator telemetry</h1>
          <p className="mt-1 text-sm opacity-80">
            Showing {turns.length} of {allTurns.length} turn{allTurns.length !== 1 ? 's' : ''} from{' '}
            <code className="rounded bg-white/10 px-1 text-xs">
              .archviber/cache/orchestrator-log.jsonl
            </code>
          </p>
        </div>

        <form method="GET" className="flex flex-wrap gap-4 items-end rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <label htmlFor="since" className="text-xs font-medium text-slate-600">Since</label>
            <input
              type="datetime-local"
              id="since"
              name="since"
              defaultValue={sinceParam ?? ''}
              className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="until" className="text-xs font-medium text-slate-600">Until</label>
            <input
              type="datetime-local"
              id="until"
              name="until"
              defaultValue={untilParam ?? ''}
              className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <button
            type="submit"
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Filter
          </button>
          <a
            href="/dev/telemetry"
            className="rounded border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Reset
          </a>
        </form>

        {turns.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
            No telemetry in this date range
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-2 py-2 text-xs font-semibold text-slate-600">Timestamp</th>
                  <th className="px-2 py-2 text-xs font-semibold text-slate-600">Prompt hash</th>
                  <th className="px-2 py-2 text-xs font-semibold text-slate-600">Intent</th>
                  <th className="px-2 py-2 text-xs font-semibold text-slate-600 text-right">Confidence</th>
                  <th className="px-2 py-2 text-xs font-semibold text-slate-600 text-center">Fallback</th>
                  <th className="px-2 py-2 text-xs font-semibold text-slate-600">Status</th>
                  <th className="px-2 py-2 text-xs font-semibold text-slate-600">Error</th>
                </tr>
              </thead>
              <tbody>
                {turns.map((turn, i) => (
                  <TelemetryRow key={i} turn={turn} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
