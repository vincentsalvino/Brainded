# Agent ↔ Brain Protocol

Client-independent contract for any MCP client talking to `@brain/mcp` — Claude
Code, Codex, or anything else that speaks MCP stdio. Nothing in this document
is specific to one agent. If it were, it would belong in that agent's own
instruction file (`AGENTS.md`, `CLAUDE.md`), not here.

## The 10 tools

`brain_context`, `brain_recall`, `brain_search`, `brain_remember`,
`brain_update`, `brain_forget`, `brain_feedback`, `brain_record_outcome`,
`brain_status`, `brain_project`.

## Task start

Call `brain_context` at the start of any task with:
- `task` — a short natural-language description of what you're about to do.
- `scope` — `{ kind: "project", id: <project-id> }` for project-specific work,
  or the global scope for cross-project knowledge.
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
on, and the `memoryId` of the specific memory. Feedback is used for future
ranking (currently OFF by default — `DEFAULT_LEARNING_CONFIG.enabled = false` —
see `docs/agent-integration/AGENT_INTEGRATION_FINDINGS.md` for why); recording
it accurately now costs nothing and matters once it's enabled.

## Outcome recording

Once the task itself concludes, call `brain_record_outcome` with the same
`taskId`, the `contextId` from the delivery this task actually used, and
`outcome`: `"success"`, `"failure"`, `"partial"`, or `"unknown"`. Include a
`signal` object with any structured detail you have (e.g. `{ testsPassed:
true }`) — free-form, but concrete signals are more useful than none.

## What this protocol deliberately does not cover

Which agent you are, how you decide what counts as "useful," or anything about
your own reasoning process — none of that belongs here. This document
describes the Brain's contract, not any agent's internal behavior.
