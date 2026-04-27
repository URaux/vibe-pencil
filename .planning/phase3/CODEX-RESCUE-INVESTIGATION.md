# Codex-Rescue Subagent Wrapper — Investigation (W3.D5)

## What the wrapper does

`codex-rescue.md` is a thin Claude subagent (model: sonnet) with a single
responsibility: rewrite the user's rescue request into a tighter prompt, then
call `codex-companion.mjs task ...` once and return its stdout verbatim.

Key forwarding rules it enforces:
- Always adds `--write` (write-capable run) unless user explicitly opts out.
- Strips routing tokens (`--background`, `--resume`, `--fresh`) from task text.
- Maps the alias `spark` → `--model gpt-5.3-codex-spark`.
- Leaves `--model` **unset by default** — only passes it if the user explicitly
  names a model.
- May call `gpt-5-4-prompting` skill to tighten the forwarded prompt; no other
  independent repo work is permitted.

Internally, `codex-companion.mjs handleTask()` calls `runAppServerTurn()` with
`model: null` when no `--model` flag is present.  The app server then picks its
own current default, which is separate from the `gpt-5.5` model the working
direct invocation targets.

## Where it diverges from the working direct invocation

Working invocation that succeeds:
```
node codex-companion.mjs task --model gpt-5.5 --write "<prompt>"
```

Rescue wrapper invocation (no explicit model):
```
node codex-companion.mjs task --write "<prompt>"
```

The divergence is in `runAppServerTurn` (`lib/codex.mjs:1008`):
```js
model: options.model ?? null,   // null when wrapper omits --model
```

`startThread` and `turn/start` both receive `model: null`, so the app server
falls back to its own **server-side default model**.  If that default is not
`gpt-5.5` (e.g. the server has rotated to a newer checkpoint or a cheaper
variant), capability and behavior differ from the direct invocation.

Additionally, the wrapper runs as Claude Sonnet while the companion itself is
invoked as a subprocess, so any Sonnet-level prompt-shaping that silently drops
context further widens the gap.

## Concrete fix proposal

Pin the model in the rescue wrapper unless the user overrides it:

**In `codex-rescue.md` forwarding rules**, replace:

> Leave model unset by default. Only add `--model` when the user explicitly
> asks for a specific model.

With:

> Default to `--model gpt-5.5` unless the user explicitly requests a different
> model or `--no-model` to let the server choose.

This makes the wrapper's behaviour identical to the working direct invocation,
eliminates server-side default drift, and preserves the existing override path
(`--model gpt-5.3-codex-spark` for spark, etc.).  No changes to
`codex-companion.mjs` are required.
