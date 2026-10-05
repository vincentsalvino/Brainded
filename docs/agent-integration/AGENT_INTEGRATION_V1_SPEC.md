# Agent Integration V1 — Claude Code + Codex (Spec)

> Provenance: pasted directly into a Claude Code session on 2026-09-05, no prior
> written spec existed. Captured verbatim here so it travels with
> `docs/superpowers/plans/2026-09-05-agent-integration-v1.md` the way every other
> phase's spec travels with its plan. Not a new Blueprint phase — see the brief's
> own first line.

---

This is NOT a new official Brain phase.

The objective is to make the existing AI Brain usable by both:

- Claude Code
- OpenAI Codex

through the SAME existing MCP server.

Do not create a Codex-specific Brain adapter.

## CURRENT STATE

Brain Core complete through Phase 4.3.

Visualizer complete.

Existing:

- @brain/mcp
- MCP stdio server
- 10 brain_* tools
- Gateway/Core architecture
- SQLite local-first Brain

Current learning: implemented, default OFF.

Current redundancy: implemented, default OFF.

Current regression baseline: 808/808 or latest verified baseline if visualizer added tests.

## ARCHITECTURAL RULE

ONE BRAIN. ONE MCP SERVER. MULTIPLE MCP CLIENTS.

```
Brain Core
    |
Gateway
    |
@brain/mcp
   /    \
Claude  Codex
```

Do NOT create: `packages/codex`, `CodexGateway`, `CodexMemoryService`,
`ClaudeMemoryService`, client-specific storage, client-specific databases.

## TASK 1 — AUDIT CURRENT CLAUDE MCP CONFIG

Inspect how Claude Code currently launches @brain/mcp. Record exactly: command,
args, cwd, environment variables, database path behavior. Do not modify it yet.
This is the canonical launcher behavior Codex must reproduce.

## TASK 2 — VERIFY MCP ENTRYPOINT

Inspect `packages/mcp/package.json`, `packages/mcp/src/server.ts`,
`packages/mcp/src/bootstrap.ts`. Determine the canonical built MCP entrypoint.
Verify via `npm build` that the entrypoint exists. Verify via MCP protocol test:
`tools/list` → exactly 10 `brain_*` tools.

## TASK 3 — CODEX CONFIGURATION

Configure Codex to launch the SAME MCP server. Preferred mechanism:
`codex mcp add ai-brain -- <existing MCP command>` or equivalent config in
`~/.codex/config.toml`. Mirror the Claude launcher semantics: same server, same
working directory, same database, same required environment. Do NOT create a
second DB. Verify: `codex mcp list`, `codex mcp get ai-brain`.

## TASK 4 — CODEX SMOKE TEST

Using Codex: verify MCP connects. Verify availability of exactly: brain_context,
brain_recall, brain_search, brain_remember, brain_update, brain_forget,
brain_feedback, brain_record_outcome, brain_status, brain_project. Perform safe
smoke calls. Do not create artificial production memories merely to test
connectivity. Use read-only/status operations where possible.

## TASK 5 — SHARED AGENT PROTOCOL

Create `docs/AGENT_BRAIN_PROTOCOL.md`. Define client-independent Brain usage:
task start, retrieval, recall/search, durable-memory criteria, feedback,
outcome recording. Do not include Claude-specific or Codex-specific behavior in
this document.

## TASK 6 — CODEX INSTRUCTIONS

Add appropriate repository AGENTS.md guidance for Codex. Keep it thin. It
should point Codex toward `docs/AGENT_BRAIN_PROTOCOL.md`. Do not duplicate the
whole protocol. Preserve any existing AGENTS.md if present.

## TASK 7 — CLAUDE INSTRUCTIONS

Inspect current Claude project instructions. Add the same shared-protocol
reference if needed. Do not duplicate the complete protocol. Claude and Codex
should follow the same Brain semantics.

## TASK 8 — STABLE MCP LAUNCHER AUDIT

Determine whether current clients depend directly on
`packages/mcp/dist/server.js`. If yes, design the smallest stable launcher.
Preferred direction: `@brain/mcp` exposes a bin command, `brain-mcp`, so client
configs can eventually use `brain-mcp` instead of repository-internal dist
paths. Do not over-package or publish to npm yet. Implement locally only if it
is clean and testable.

## TASK 9 — TWO-CLIENT CONSISTENCY

Verify Claude and Codex point at: same Brain DB, same project scope
conventions, same MCP implementation, same 10 tools. Test that a memory written
through one client is retrievable through the other using a controlled
temporary/project test scope. Do NOT pollute real production project memories.
Use an isolated integration database if possible.

## TASK 10 — MULTI-CLIENT PROVENANCE AUDIT

Do NOT implement adaptive behavior. Inspect current event contracts and answer:
can we determine whether feedback/outcome came from Claude, Codex, human, other
agent? Known likely gap: FeedbackEvent has no actor/provenance field. Produce
`docs/AGENT_INTEGRATION_FINDINGS.md` with a concrete recommendation for adding
client/actor provenance later. Do not change learning behavior in this
milestone. Only implement provenance now if it can be added as a clearly
backwards-compatible observational field without expanding scope materially.
Otherwise defer it with an explicit next-task recommendation.

## TASK 11 — CONCURRENCY CHECK

Test two independent MCP server processes against the same temporary SQLite
Brain DB. Simulate Claude MCP process + Codex MCP process. Verify reads, memory
writes, feedback writes, outcome writes do not corrupt data. Do not claim
concurrency safety without testing it. If SQLite lock contention appears:
characterize it before changing DB architecture. Do NOT introduce
Postgres/cloud storage.

## TASK 12 — REGRESSION

Run `npm run typecheck`, `npm run build`, `npm test`, `npm audit`, plus
visualizer tests if now part of the workspace. Verify: MCP tool count = 10,
learning default = false, redundancy default = false.

## FINAL REPORT

Return: AGENT INTEGRATION STATUS, EXISTING MCP ENTRYPOINT, CLAUDE CONFIG, CODEX
CONFIG, CODEX CONNECTION TEST, SHARED AGENT PROTOCOL, AGENTS.MD, CLAUDE
INSTRUCTION INTEGRATION, STABLE MCP LAUNCHER, SHARED DATABASE VERIFICATION,
CROSS-CLIENT MEMORY TEST, CONCURRENCY TEST, PROVENANCE GAP, FILES CHANGED, TEST
RESULT, RISKS, REMAINING UNIVERSALIZATION WORK, RECOMMENDED NEXT STEP.

STOP. Do not start Phase 4.4. Do not enable learning. Do not create
client-specific Brain logic.

---

## Addendum — decisions made during planning (2026-09-05)

Two facts emerged during research that this spec couldn't have anticipated:

1. **`docs/AGENT_BRAIN_PROTOCOL.md` and `docs/AGENT_INTEGRATION_FINDINGS.md`
   land under `docs/agent-integration/` instead of flat in `docs/`.** The
   previous task in this same session grouped 44 previously-flat files under
   `docs/` into topic folders specifically to stop new files landing loose at
   the top level. Creating two new flat files one turn later would undo that.
   `AGENTS.md` and repo-root `CLAUDE.md` stay at the repo root per Task 6/7 —
   those two are read by convention from fixed root paths, not discovered by
   browsing `docs/`.
2. **Task 3's target, confirmed with the user:** `codex` is not on this
   machine's PATH, so `codex mcp add`/`list`/`get` cannot be run here
   regardless of which Codex this is. `~/.codex/config.toml` exists and
   belongs to OpenAI's consumer Codex desktop app (computer-use, browser,
   documents, pets, dictation-history, generated-images, per-project trust
   levels) rather than a narrow coding CLI — the user confirmed this is
   nonetheless the correct integration target, so Task 3 edits that file's
   `[mcp_servers.ai-brain]` table directly instead of shelling out to `codex`.
