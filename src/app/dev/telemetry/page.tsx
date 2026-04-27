'use client'

import { useEffect, useState } from 'react'
import type { HandlerMetrics } from '@/lib/orchestrator/metrics'

export default function TelemetryPage() {
  const [metrics, setMetrics] = useState<HandlerMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/telemetry/metrics')
      .then((r) => r.json())
      .then((data: { metrics?: HandlerMetrics; error?: string }) => {
        if (data.error) setError(data.error)
        else setMetrics(data.metrics ?? null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: 16 }}>Orchestrator Telemetry</h1>

      {loading && <p>Loading metrics…</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {metrics && (
        <section>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Per-intent dispatch metrics</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
                {['Intent', 'Calls', 'OK', 'Errors', 'Not impl', 'OK rate', 'Err rate', 'Avg conf', 'Avg ms'].map(
                  (h) => (
                    <th key={h} style={{ padding: '6px 10px', borderBottom: '2px solid #e5e7eb' }}>
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {Object.entries(metrics).map(([intent, m], idx) => (
                <tr key={intent} style={{ background: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={{ padding: '5px 10px', fontWeight: 600 }}>{intent}</td>
                  <td style={{ padding: '5px 10px' }}>{m.totalCalls}</td>
                  <td style={{ padding: '5px 10px', color: '#059669' }}>{m.okCount}</td>
                  <td style={{ padding: '5px 10px', color: '#dc2626' }}>{m.errorCount}</td>
                  <td style={{ padding: '5px 10px', color: '#92400e' }}>{m.notImplementedCount}</td>
                  <td style={{ padding: '5px 10px' }}>{(m.okRate * 100).toFixed(1)}%</td>
                  <td style={{ padding: '5px 10px' }}>{(m.errorRate * 100).toFixed(1)}%</td>
                  <td style={{ padding: '5px 10px' }}>{m.avgConfidence.toFixed(2)}</td>
                  <td style={{ padding: '5px 10px' }}>
                    {m.avgDurationMs !== null ? m.avgDurationMs.toFixed(0) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
