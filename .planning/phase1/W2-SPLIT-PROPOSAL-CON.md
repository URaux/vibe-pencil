# W2 Split Proposal — CON (Devil's Advocate)

**Author**: devil's advocate agent  
**Date**: 2026-04-14  
**Position**: Do NOT split W2 into W2a/W2b. Retain single-week checkpoint. Fix overload by scoping down, not by fragmenting.

---

## Verdict

**Do not split.** Keep W2 as one checkpoint (D1–D10). Address Codex's overload concern through scope surgery within the week, not by inserting a mid-sprint gate.

---

## Rebuttal: Why Codex's "overload" Judgment Is Overcautious

### 1. The hour count is 37h, not 50h

Add up PLAN.md W2 estimates: D1=4, D2=5, D3=3, D4=3, D5=4, D6=2, D7=4, D8=5, D9=3, D10=4. Total = **37 hours**. A 5-day week at 7.4h/day is entirely within range for a focused solo dev. Codex flags "明显偏乐观" without citing a counter-estimate — this is opinion, not measurement.

### 2. Tree-sitter is optional, not blocking

The plan uses **tree-sitter only as a scaffold** (`ast-ts.ts` W2.D1). ts-morph already handles all the work that matters: fact extraction (W2.D2), the rename codemod (W2.D7), and symbol resolution in the Modify agent. Tree-sitter's pluggable-backend role is explicitly labeled "future Python/Go"; in Phase 1 TS/JS, ts-morph alone suffices. Drop tree-sitter from W2.D1 and the scaffold simplifies from dual-lib initialization to pure ts-morph `Project` setup — saving 1–1.5h.

### 3. W2's two halves are more coupled than Codex assumes

Codex says "ingest and modify are independently useful." In practice:

- `code_anchors` (W2.D4) is the input to `resolveSymbolRef` in the Modify planner (MODIFY-AGENT-DESIGN.md §3.2). Without anchors, the rename agent can't locate the target symbol — it falls back to full-text search, which is unreliable.
- ts-morph `Project` is initialized once in W2.D1 and **reused** in both W2.D2 (fact extraction) and W2.D7 (rename codemod). Splitting at the W2a/W2b boundary forces either (a) a second `Project` init in W2b — redundant and slow — or (b) passing the Project instance across the checkpoint boundary via an intermediate module that has to exist in both phases, which is exactly the kind of v0.1→v0.2 internal refactor we'd need to clean up.
- The `FactGraph` cache (W2.D2 `.archviber/cache/facts.json`) is read by `resolveSymbolRef` at rename time. If W2a ships without the rename consumer, there's no pressure test on the cache format — you'd discover mismatches only in W2b, which lands *after* a checkpoint review has already blessed the schema.

Splitting creates a seam where none naturally exists. You pay integration debt on the very boundary you tried to avoid.

### 4. A mid-sprint checkpoint for a solo dev adds 0 product value and costs real time

A checkpoint means: write checkpoint doc, run integration test suite, update PLAN.md, update OV memory, possibly a Telegram status meeting. For a team, checkpoints enforce cross-squad alignment. For a solo dev this overhead is pure friction — each context switch back into planning mode costs 30–60 minutes that could be spent coding. Two checkpoints in three weeks is right. Three checkpoints compresses W3 to feel rushed and makes the eval harness the thing that gets cut.

### 5. If W2 truly slips, the correct response is scope cut, not checkpoint split

The plan already documents the right fallback: if W2 overruns, *reduce scope* — e.g., skip JS support and do TS only, skip the LLM naming pass (W2.D5 is already marked optional with "Cluster A/B fallback"), skip PR push (keep local branch). None of these cuts require restructuring the checkpoint. A checkpoint split doesn't prevent a slip; it just means you have a slip *inside* W2a instead of W2.

---

## W2 Slim-Down Plan (No Split Required)

These five reductions bring W2 from 37h to approximately 29h without changing the checkpoint count or the exit criteria.

### Cut 1: Drop tree-sitter entirely from Phase 1 (save ~2h)

**What**: Remove `tree-sitter` and `tree-sitter-typescript` from W2.D1 deps. Use ts-morph for all AST work. The "pluggable backend" interface can be written as a TypeScript interface stub without an actual tree-sitter implementation.

**Why safe**: Phase 1 exit test only requires TS/JS anchor coverage ≥ 80% on the golden repo and a tsc-green rename. ts-morph delivers both. Tree-sitter adds nothing unique to Phase 1.

**W2.D1 revised scope**: Add `ts-morph@^22`, `graphology`, `graphology-communities-louvain`. Create `ast-ts.ts` exposing `parseTsProject()` via ts-morph only. Add stub interface `AstBackend` for future polyglot. Estimated: 2.5h (was 4h).

### Cut 2: Skip JS support; TS-only for Phase 1 (save ~2h)

**What**: `ingest.ts` only processes `.ts` / `.tsx` files. Skip `.js` / `.jsx` / `.mjs` handling. ts-morph's `Project` already handles this with `allowJs: false`.

**Why safe**: The golden test fixture is FastAPI (Python) — it has no JS files. ArchViber itself is pure TS. Solo dev is unlikely to import a mixed-language repo during Phase 1 demo. JS support is a 2-line config change in Phase 2.

### Cut 3: Make LLM naming pass (W2.D5) a no-op stub (save ~3h)

**What**: W2.D5 is already explicitly marked optional with "Cluster A/B fallback is the whole fallback." Implement it as a 20-line stub: `nameClusters()` returns `{ A: 'Cluster A', B: 'Cluster B', ... }` immediately. Wire the real LLM call as a commented-out code block with a TODO. The Phase 1 checkpoint criteria ("Import ArchViber itself → no block named after React state vars") doesn't require LLM names — it just requires Louvain to group correctly.

**Saves**: ~3h of prompt engineering + 15s timeout plumbing that adds complexity to an already-long week.

### Cut 4: Skip `gh pr create` in W2.D9; local branch only (save ~1h)

**What**: In `pr.ts`, implement the branch+commit path but skip the `gh pr create` call. The W2 checkpoint says "PR branch created with tsc-green diff" — a local branch satisfies this. `gh` CLI availability check + PR body templating can be added in W3.D10 as part of the smoke/docs pass.

**Why safe**: Phase 1 acceptance criterion #4 says "produces a PR branch with tsc-green diff" — it doesn't say "creates a GitHub PR URL." The URL is nice-to-have; the branch is the proof.

### Cut 5: Front-load W2.D1 sandbox smoke test into W1 (save ~1h from W2.D8, reduce W2 risk)

**What**: During W1.D4 (disk persistence), add a one-line git worktree creation test in the Playwright e2e. This confirms `git worktree add` works on this Windows machine in the `.archviber/` path before W2.D8 needs it.

**Why it's not a "move"**: It's a single assertion added to an existing test, not a new task. W2.D8 still lives in W2 — the sandbox implementation doesn't move. Only the platform smoke check is front-loaded.

**Result**: If the worktree smoke test fails in W1, we know in advance and can code the in-place stash fallback before W2.D8 instead of discovering it there.

---

### Revised W2 hour estimate after all five cuts

| Task | Original | Revised |
|------|----------|---------|
| W2.D1 AST scaffold | 4h | 2.5h (ts-morph only, no tree-sitter) |
| W2.D2 Fact extraction | 5h | 4h (TS-only, no JS branch) |
| W2.D3 Clustering | 3h | 3h |
| W2.D4 Code anchors | 3h | 3h |
| W2.D5 LLM naming | 4h | 1h (stub + TODO) |
| W2.D6 Modify skeleton | 2h | 2h |
| W2.D7 ts-morph rename | 4h | 4h |
| W2.D8 Sandbox runner | 5h | 4h (worktree smoke pre-validated in W1) |
| W2.D9 PR generator | 3h | 2h (local branch only, no gh CLI) |
| W2.D10 Integration + chat wiring | 4h | 4h |
| **Total** | **37h** | **29.5h** |

29.5h over 5 days = 5.9h/day. Comfortable. 1-day buffer remains.

---

## Windows Validation — Keep W2.D8 in Place

Codex recommends front-moving Windows worktree validation to W2.D1. The slim-down plan above does something cheaper: a **smoke assertion in W1.D4** that costs ~15 minutes, not a full task reorder.

Here is why W2.D8 stays where it is rather than being pulled to W2.D1:

1. **The sandbox code doesn't exist until W2.D6–W2.D7.** You cannot validate a system that hasn't been written yet. Moving "Windows validation of the sandbox" to D1 means validating git worktree in isolation, then re-validating the full sandbox in W2.D8 anyway — you do the work twice.

2. **The real Windows risk is in the worktree path, not the API.** `git worktree add` with a path inside `.archviber/` (same drive, no junction crossing) is the documented safe pattern in MODIFY-AGENT-DESIGN.md §5. The risk is already mitigated by path choice, not by test ordering.

3. **The stash fallback is documented and cheap.** If worktree fails despite the safe path, the fallback is 15 lines of `git stash && apply && run && stash pop`. This fallback is robust enough that a late-W2 discovery doesn't threaten the checkpoint — it just means we use the fallback for the checkpoint demo.

4. **W2.D8 at day 8 gives the most realistic test.** A real diff from a real rename codemod (W2.D7) is a more meaningful Windows test than a synthetic worktree smoke. Testing with real inputs is worth the later placement.

The W1.D4 smoke (one `git worktree add` + `worktree remove` in the e2e) is the right pre-validation — cheap, early, doesn't require moving W2.D8.

---

## Risk Register + Fallback Paths

| Risk | Probability | Fallback |
|------|-------------|---------|
| ts-morph slow on ArchViber src (>60s first load) | Medium | Cache `Project` instance; skip `.d.ts` files; lower file limit to 200 files |
| Louvain non-determinism produces unstable cluster IDs across runs | Low | Seed RNG (PLAN.md already calls this out); cluster IDs derived from member-file set hash, not Louvain internal IDs |
| W2.D8 git worktree fails on Windows | Low-Medium | Stash fallback (MODIFY-AGENT-DESIGN.md §5); already coded in spec |
| W2 still overruns after slim-down | Low | Cut W2.D5 stub to zero (skip entirely); cut W2.D10 integration to API-only (no chat wiring); move chat wiring to W3.D5 as 1-line dispatcher addition |
| FactGraph cache format mismatch discovered in W2.D7 | Low | IR-SCHEMA.md §8 and PLAN.md already define strict Zod validation; cache invalidation is keyed by file mtimes + ingest version — a version bump busts all cache cleanly |
| LLM naming stub causes poor demo ("Cluster A/B") | Medium | Fallback names for demo are acceptable; if demo quality matters, spend the 3h on W2.D5 at the end of the week after D9 is green |

### Day-by-day emergency cut sequence (if W2 runs behind)

- **Day 5 end-of-day (W2.D5)**: LLM naming stub already done (Cut 3). No risk here.
- **Day 7 end-of-day (W2.D7)**: If rename codemod not passing vitest, cut scope to `kind='file'` only (file rename) — simpler, still satisfies "rename X" demo.
- **Day 8 end-of-day (W2.D8)**: If sandbox flaky, demo with stash-fallback path. tsc pass is the exit gate; vitest pass is bonus.
- **Day 9 end-of-day (W2.D9)**: If PR generator blocked, demo with `console.log(branchName)` — branch exists, exit criterion satisfied.
- **Day 10 (W2.D10)**: Chat wiring is the only piece that can slip to W3.D5 without breaking any W2 checkpoint criterion. It's wiring, not logic.

---

## Summary

Splitting W2 is solution-fitting-the-wrong-problem. The problem is 37h of work; the solution is cutting it to 29.5h, not adding a checkpoint. The split creates a structural seam in a naturally cohesive pipeline (ts-morph shared across ingest + modify), forces a v0.1→v0.2 intermediate refactor, adds checkpoint overhead for a solo dev, and still doesn't prevent a slip — it just relabels slippage as "W2b starts late."

The five scope cuts above are concrete and non-destructive: they preserve every Phase 1 acceptance criterion, reduce W2 by 7.5h, maintain a single clean checkpoint, and leave the full LLM naming + JS support + GitHub PR integration as well-scoped Phase 2 additions.

Do not split. Slim down instead.
