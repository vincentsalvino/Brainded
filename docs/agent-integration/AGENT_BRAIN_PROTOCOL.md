# Agent ↔ Brain Protocol

Client-independent contract for any MCP client talking to `@brain/mcp` — Claude
Code, Codex, or anything else that speaks MCP stdio. Nothing in this document
is specific to one agent. If it were, it would belong in that agent's own
instruction file (`AGENTS.md`, `CLAUDE.md`), not here.

Whether a given task must call these tools at all is a separate question --
see `BRAIN_WORKFLOW_POLICY.md` in this folder for task classification and the
preflight/completion/bypass policy. Same split as above: that document is
process, this one is mechanics.

## The 10 tools

`brain_context`, `brain_recall`, `brain_search`, `brain_remember`,
`brain_update`, `brain_forget`, `brain_feedback`, `brain_record_outcome`,
`brain_status`, `brain_project`.

## Task start

Call `brain_context` at the start of substantive work with:
- `task` — a short natural-language description of what you're about to do.
- `scope` — `{ kind: "project", id: <project-id> }` for project-specific
  work, or `{ kind: "global", id: null }` for cross-project knowledge (`id`
  is a required field on this object, just always `null` for global scope).
  A third kind, `"session"` (`{ kind: "session", id: <session-id> }`),
  scopes a memory to a single session — see
  `packages/core/contracts/src/scope.ts` for the full definition.
- `taskId` — a stable identifier for this unit of work (mint one UUID per
  task, reuse it for every later call in this section).
- `maxTokens` — your context budget for this call.

The response includes a `contextId`. **Keep it.** Every `brain_feedback` and
`brain_record_outcome` call for this task must name it — that's what lets the
Brain correlate feedback/outcomes back to the exact set of memories it
delivered, instead of guessing.

## Retrieval outside a task-start context pull

Use `brain_recall` (fetch by id, or list within a scope) or `brain_search`
(free-text) when you need a specific memory or a lightweight lookup, without
paying for a full context-compilation pass. Both are read-only.

## Durable-memory criteria — when to call `brain_remember`

Write a memory when you learn something that will be true again next time,
not something true only for this run:
- A project convention, constraint, or decision (`type: "rule"`,
  `"constraint"`, `"decision"`) — e.g. "route handlers must never touch the
  database directly."
- A fact about the codebase or its environment (`type: "fact"`) that isn't
  obvious from reading the code once.
- A pattern worth repeating (`type: "pattern"`).

These are illustrative examples, not the exhaustive list — see
`MEMORY_TYPES` in `packages/core/contracts/src/memory.ts` for all twelve
valid values.

Do not write a memory for: information already fully derivable from the
current code/config (memory is for facts that decay or that took real
investigation to establish, not a cache of `grep` output), or anything true
only for the current in-progress task.

Always pass the narrowest correct `scope`. A project-specific constraint
belongs in that project's scope, not global — global memories apply
everywhere, including projects where the constraint is wrong or irrelevant.

## Feedback

After `brain_context` hands you memories, call `brain_feedback` once you know
whether each one actually helped: `useful: true` if it did, `useful: false`
with a `reason` (`"redundant"`, `"irrelevant"`, `"incorrect"`, or `"other"`) if
it didn't. Always include the `contextId` from the delivery you're reporting
on, the original `taskId`, and the `memoryId` of the specific memory. Review
all delivered items and leave uncertain items unlabeled. Feedback supports future
ranking (currently OFF by default — `DEFAULT_LEARNING_CONFIG.enabled = false` —
see `docs/agent-integration/AGENT_INTEGRATION_FINDINGS.md` for why).

## Outcome recording

Once the task itself concludes, call `brain_record_outcome` with the same
`taskId`, the `contextId` from the delivery this task actually used, and
`outcome`: `"success"`, `"failure"`, `"partial"`, or `"unknown"`. Optionally
include a `signal` object — it accepts exactly three optional fields and no
others: `testsPassed` (boolean), `reviewScore` (number, 0-1), `humanEdited`
(boolean). The schema is `.strict()`; any other key throws a validation
error instead of being accepted.

## Native memory coexistence

Memory Atlas (`@brain/mcp`) is the shared, cross-agent, durable memory layer —
not a replacement for Claude's or Codex's own native/session memory, and not
synchronized with either. Nothing here scrapes, imports, or mirrors
client-native memory, and nothing should.

Ownership stays split three ways:
- **Memory Atlas** — durable knowledge another agent, or a future session,
  should know: architecture decisions, constraints, validated conventions,
  failure modes, patterns. See "Durable-memory criteria" above.
- **Client-native memory** — client-local preferences and continuity (e.g.
  "prefer concise responses," "this session was investigating X"). Never
  required to mirror into Memory Atlas.
- **Session context** — scratch reasoning, in-progress hypotheses, temporary
  state. Never persisted automatically.

When sources conflict, higher wins: explicit user instruction > current
repository/code state > this protocol > scoped Memory Atlas memory > client-native
memory > session assumption. A stale Memory Atlas memory that contradicts the
current repository loses to the repository — fix or forget the memory once
the newer state is confirmed, rather than continuing to act on it.

Don't intentionally duplicate durable project knowledge into native memory
when Memory Atlas already holds it (project knowledge → Memory Atlas, client
preference → native memory, temporary state → session) — but a native system
independently remembering something Memory Atlas also knows is not a bug to fix.

## What this protocol deliberately does not cover

Which agent you are, how you decide what counts as "useful," or anything about
your own reasoning process — none of that belongs here. This document
describes the Brain's contract, not any agent's internal behavior.

Conversely: do not implement Codex-specific (or any client-specific) Brain
logic anywhere in your own integration — the protocol above applies
identically regardless of which agent is connected. A client-specific
instruction belongs in that client's own instruction file (`AGENTS.md`,
`CLAUDE.md`), not here.
