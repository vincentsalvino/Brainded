# Agent Integration Findings — Multi-Client Provenance

## Question

Can we currently determine whether a `FeedbackEvent` or `OutcomeEvent` came
from Claude, Codex, a human, or another agent?

## Answer: No — confirmed absent, not just undocumented

All four telemetry event schemas in `packages/core/contracts/src/events.ts`
were read in full:

- `RetrievalEventSchema` (lines 16-25): `id`, `timestamp`, `scope`,
  `queryText`, `candidateIds`, `taskId`. No actor field.
- `ContextEventSchema` (lines 52-75): `id`, `timestamp`, `retrievalEventId`,
  `scope`, `taskId`, `includedMemoryIds`, `omittedMemoryIds`, `tokenCount`,
  `memories`, plus timing/candidate-count fields. No actor field.
- `OutcomeEventSchema` (lines 122-137): `id`, `timestamp`, `taskId`,
  `sessionId`, `contextId`, `outcome`, `signal`, `notes`. No actor field.
- `FeedbackEventSchema` (lines 147-159): `id`, `timestamp`, `memoryId`,
  `taskId`, `contextId`, `useful`, `reason`, `notes`. No actor field.

All four are Zod `.strict()` — an extra field sent by a future client-aware
caller would be silently *rejected*, not silently accepted, so there's no
partial/undocumented support hiding here either.

The **one** precedent for this kind of field in the same file is a different,
unrelated event type: `MemoryMutationEventSchema` (lines 169-179) carries
`actor: ProvenanceSchema` — but that's the audit log for memory
create/update/archive mutations, not for retrieval/context/outcome/feedback
telemetry. It proves the pattern (a Zod sub-schema for "who did this") already
exists in this codebase; it doesn't cover the four schemas that actually
matter for multi-client attribution.

## Recommendation

Add an optional, nullable `actor` field (reusing or mirroring
`ProvenanceSchema`'s shape) to `FeedbackEventSchema` and `OutcomeEventSchema`
at minimum — these are the two callers most likely to want per-client
attribution first (e.g. "does Codex's feedback correlate with better outcomes
than Claude's"). Zod-level this is a `.nullable().default(null)` addition,
which is backwards compatible for schema validation — but it is **not**
backwards-compatible end-to-end without also:

1. A DB migration adding a nullable column to whichever table stores each
   event (this codebase's migration convention already covers additive
   nullable columns via plain `ALTER TABLE ADD COLUMN` — see
   `packages/storage/src/db.ts:100-101`'s documented note that later
   migrations "are NOT required to be self-idempotent... SQLite offers no
   `IF NOT EXISTS` for `ALTER TABLE ADD COLUMN`").
2. `EventStore` read/write path changes in `packages/storage` for both event
   types.
3. The `brain_feedback`/`brain_record_outcome` MCP tool input schemas
   (`packages/mcp/src/server.ts`) accepting an optional `actor` argument.
4. A decision about what value each client actually sends — a client-supplied
   free-text string (`"claude-code"`, `"codex"`) is the minimum viable shape;
   anything more structured (versioned client IDs, session correlation) is
   its own design question, out of scope for "add a field."

That is four coordinated changes across three packages, not one optional
field — squarely "expanding scope materially" per this milestone's explicit
instruction not to. Deferred.

## Next task recommendation

A follow-up milestone ("Agent Provenance V1" or similar): add `actor` to
`FeedbackEventSchema` and `OutcomeEventSchema`, thread it through
`packages/storage`'s event store, accept it as an optional MCP tool argument,
and have `docs/agent-integration/AGENT_BRAIN_PROTOCOL.md` instruct every client
to send its own name. Explicitly NOT bundled with any learning-behavior change
— provenance is observational until a later, separate decision chooses to use
it for ranking.
