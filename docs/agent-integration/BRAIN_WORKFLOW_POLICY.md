# Brain Workflow Policy

Companion to `AGENT_BRAIN_PROTOCOL.md` (the tool contract: what `brain_*`
calls do). This document is the process contract: when a task must use them.
Client-independent -- applies identically to Claude Code and Codex. Neither
file duplicates the other: tool mechanics stay in the protocol, task-level
process stays here.

## Task classification

Before starting work, classify it. No classifier, no scoring -- a judgment
call against two buckets:

**SUBSTANTIVE** -- architecture-sensitive work, multi-file implementation, a
bug investigation, a refactor, a schema/database change, an API change,
dependency-sensitive work, a project-sensitive decision, non-trivial testing
work.

**TRIVIAL** -- a typo, formatting, `git status`, a simple rename, a basic
explanation, an obvious one-line edit.

Only SUBSTANTIVE work requires the preflight below.

## Preflight (SUBSTANTIVE work only)

Before implementation, call `brain_context` with the task description, the
narrowest correct scope, and a token budget. Preserve the returned
`contextId` -- every `brain_feedback`/`brain_record_outcome` call for this
task names it. Do not retrieve the whole Brain; normal ranking/budgeting
applies.

The returned context is supporting evidence, never authority -- see
`AGENT_BRAIN_PROTOCOL.md`'s conflict order and stale-memory rule; nothing
here changes it.

## Completion gate (when a SUBSTANTIVE task used a Brain context)

Before declaring the task done:
1. Keep the exact `contextId` from preflight.
2. Record `brain_feedback` where usefulness is actually clear -- selective,
   not exhaustive. Skipping a memory whose usefulness is genuinely unclear is
   correct, not a gap.
3. Record `brain_record_outcome` with that `contextId` and the task's
   `taskId`. Required whenever a context was used.
4. Consider whether anything genuinely new and durable surfaced.
   `brain_remember` is NOT mandatory -- "nothing new to remember" is a valid,
   complete result.

## Bypass

Brain unavailability must never block development.

- **NORMAL** -- Brain available; SUBSTANTIVE work does the preflight above.
- **BYPASS** -- Brain genuinely unavailable (e.g. `brain_status` fails);
  continue the task and state the bypass reason in the task's own
  narration/commit context. Never bypass silently, and never bypass a
  TRIVIAL task -- it never needed the preflight to begin with.

## Adherence telemetry (read-only, observability only)

`packages/visualizer`'s Overview "Workflow" panel reports, over tasks that
left at least one trace (a `taskId` on a context or outcome event) --
**tasks that never contact Brain are not observable**, so this is a
lower-bound reading of adherence, never a total:

- **Observed Brain Tasks** -- distinct `taskId`s seen at all. Not a count of
  every substantive task that should have run preflight, only of the ones
  that left a trace.
- **With Context** -- share of Observed Brain Tasks that have a context
  delivery. An observed task with no context (an outcome recorded but no
  preceding `brain_context` call) is a real, visible adherence gap.
- **With Feedback** / **With Outcome** -- share of tasks *with context* that
  also have feedback / an outcome, since neither is expected before a
  context was delivered. Low feedback coverage is expected -- feedback is
  selective by design. Low outcome coverage on tasks that did pull a context
  is the real signal.

Source: `EventStore.getWorkflowAdherence()`
(`packages/storage/src/event-store.ts`).

This measures adherence only among tasks the Brain already knows about. It
structurally cannot see a SUBSTANTIVE task that skipped `brain_context`
entirely -- that task mints no `taskId` anywhere, so it leaves no row to
count. "Bypassed" has no counter for the same reason: nowhere records a
bypass reason today. Adding one is exactly the kind of new infrastructure
this policy defers until the pilot below shows it's needed.

These numbers must never feed `learning` or `redundancy` ranking -- both stay
OFF by default, unaffected by this document.

## Client provenance

Not implemented. Do not self-report a `clientId` on tool calls. If it matters
later, the MCP launcher/server stamps `claude-code` / `codex` as trusted
metadata -- observational only, no ranking effect.

## Possible future harness (not built)

A tiny `brain-agent claude` / `brain-agent codex` launcher could one day
establish client identity, ensure the Brain is reachable, run preflight,
carry the `contextId`, and do completion bookkeeping -- and nothing else: no
reasoning, no planning, no editing, no replacing the agent's own loop. Build
it only once the adherence pilot below shows instructions alone are
routinely ignored. Not evidenced yet, so not built now.

## Adherence pilot

Dogfood this policy on real work -- don't manufacture tasks to test it.
Watch whether SUBSTANTIVE tasks actually get a preflight, a preserved
`contextId`, selective feedback, and a recorded outcome. Consistently high
instruction-only adherence: stop here, build no more enforcement. Routine
skipping: that evidence is what justifies the harness above.

## Claude / Codex parity

Same policy, same wording, no client-specific variant. `CLAUDE.md` and
`AGENTS.md` each carry a short pointer here, not a copy of this document.
