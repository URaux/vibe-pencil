import { describe, expect, it } from 'vitest'
import { extractAgentText } from '@/lib/agent-output'

describe('extractAgentText', () => {
  it('extracts Codex JSON agent messages', () => {
    const output = [
      '{"type":"thread.started","thread_id":"1"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello world"}}',
      '{"type":"turn.completed"}',
    ].join('\n')

    expect(extractAgentText(output)).toBe('hello world')
  })

  it('ignores Codex shell snapshot warnings', () => {
    const output = [
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"final answer"}}',
      '2026-03-27T06:20:26.284579Z  WARN codex_core::shell_snapshot: Failed to create shell snapshot for powershell: Shell snapshot not supported yet for PowerShell',
    ].join('\n')

    expect(extractAgentText(output)).toBe('final answer')
  })

  it('ignores Codex app server warnings', () => {
    const output = [
      '2026-03-27T07:12:34.606449Z  WARN codex_app_server_client: dropping in-process app-server event because consumer queue is full',
      '2026-03-27T07:12:34.606772Z  WARN codex_app_server_client: in-process app-server event stream lagged; dropped 1 events',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"normal answer"}}',
    ].join('\n')

    expect(extractAgentText(output)).toBe('normal answer')
  })

  it('does not duplicate Codex intermediate item events', () => {
    const output = [
      '{"type":"item.started","item":{"id":"item_0","type":"agent_message","text":"normal answer"}}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"normal answer"}}',
    ].join('\n')

    expect(extractAgentText(output)).toBe('normal answer')
  })
})
