# Agent Integration V1 — Final Report

Executed via `docs/archive/superpowers/plans/2026-09-05-agent-integration-v1.md`
(implements `docs/agent-integration/AGENT_INTEGRATION_V1_SPEC.md`) using
subagent-driven development. Full task-by-task record, every ruling, and
both review rounds: `.superpowers/sdd/2026-09-05-agent-integration-v1/progress.md`
(deleted after this report was written — its content is git history now,
via the commits cited throughout this report).

## AGENT INTEGRATION STATUS

Complete, with fixes applied after final review. 11 of 13 plan tasks fully
verified end to end; one (Codex live connectivity) is configured but
unverified — `codex` is not installed on this machine, so its actual
connection could not be tested. No client-specific Brain logic was created;
the architectural rule (one Brain, one MCP server, multiple clients) holds
by construction — the entire production-code diff across this milestone is
2 lines in one file (a shebang).

## EXISTING MCP ENTRYPOINT

`packages/mcp/src/server.ts`, built to `packages/mcp/dist/server.js`.
Registers exactly 10 tools via `registerBrainTools(server, gateway)`
(`server.ts`, `server.registerTool(...)` x10): `brain_context`,
`brain_recall`, `brain_search`, `brain_remember`, `brain_update`,
`brain_forget`, `brain_feedback`, `brain_record_outcome`, `brain_status`,
`brain_project`. Mechanically enforced by an existing test
(`packages/mcp/src/boundaries.test.ts`: asserts `toolCount === 10` and that
every handler calls exactly one `gateway.*` method). DB path resolves from a
single positional CLI argument only (`process.argv[2] ?? "./brain.db"`); no
environment variable is read anywhere in `packages/mcp/src`.

## CLAUDE CONFIG

Global scope, `C:\Users\LENOVO V330\.claude.json`, top-level `mcpServers.brain`
(applies to every Claude Code project on this machine, not project-scoped):

```json
"brain": {
  "type": "stdio",
  "command": "node",
  "args": [
    "C:\\Users\\LENOVO V330\\OneDrive\\Desktop\\ai-brain\\packages\\mcp\\dist\\server.js",
    "C:\\Users\\LENOVO V330\\OneDrive\\Desktop\\ai-brain\\data\\brain.db"
  ],
  "env": {}
}
```

Pre-existing, not modified by this milestone — this is the canonical
launcher behavior Codex was made to reproduce.

## CODEX CONFIG

`C:\Users\LENOVO V330\.codex\config.toml` — confirmed (with you) to be
OpenAI's consumer Codex desktop app, not a bare coding CLI; `codex` is not
on this machine's PATH, so `codex mcp add` could not be run. Applied the
equivalent TOML directly instead, appended after the pre-existing guarded
`nogic` extension block (left byte-identical):

```toml
[mcp_servers.ai-brain]
command = "node"
args = [
  "C:\\Users\\LENOVO V330\\OneDrive\\Desktop\\ai-brain\\packages\\mcp\\dist\\server.js",
  "C:\\Users\\LENOVO V330\\OneDrive\\Desktop\\ai-brain\\data\\brain.db",
]
```

`command`/`args` are byte-for-byte identical to Claude's entry — same
server, same database file.

## CODEX CONNECTION TEST

**NOT RUN.** `codex` is not installed/reachable on this machine's PATH
(confirmed: `command not found`). This cannot be executed from a background
shell regardless of configuration — it requires the Codex app itself to be
opened/reloaded so it picks up the new config. A manual checklist is
recorded in the plan (Task 4) for whenever that's possible: reload Codex,
confirm the `ai-brain` server shows connected, call the read-only
`brain_status` and an empty-result `brain_recall`, confirm tool count = 10.
No pass is claimed here.

## SHARED AGENT PROTOCOL

`docs/agent-integration/AGENT_BRAIN_PROTOCOL.md` — client-independent:
covers the 10 tools, `brain_context` → `contextId` correlation (feed it back
into `brain_feedback`/`brain_record_outcome`), the exact `signal` shape
(`testsPassed`/`reviewScore`/`humanEdited`, `.strict()` — no other keys),
the correct scope literals (`{ kind: "project", id }` /
`{ kind: "global", id: null }`, plus a `"session"` kind), durable-memory
criteria with a pointer to the full 12-value `MEMORY_TYPES` enum, and — after
final review moved it here from `AGENTS.md` alone — the explicit rule that no
client-specific behavior belongs anywhere in this contract. Placed under
`docs/agent-integration/` rather than the spec's literal flat
`docs/AGENT_BRAIN_PROTOCOL.md`, to stay consistent with this session's prior
`docs/` reorganization (recorded as a deliberate deviation in the spec's own
addendum).

## AGENTS.MD

Repo root, 13 lines, thin — points to the protocol doc, does not duplicate
it. No prior `AGENTS.md` existed at the repo root (the only other one in the
tree is unrelated bundled reference material under `references/AEOS-brain/`,
untouched).

## CLAUDE INSTRUCTION INTEGRATION

Repo root `CLAUDE.md` created (9 lines, thin, same pointer pattern as
`AGENTS.md`) — distinct from your personal global `~/.claude/CLAUDE.md`,
which was not touched. No repo-root `CLAUDE.md` existed before this
milestone.

## STABLE MCP LAUNCHER

`packages/mcp/package.json` already declared `"bin": {"brain-mcp":
"./dist/server.js"}` before this milestone — nobody had used it. Added a
`#!/usr/bin/env node` shebang to `server.ts` (confirmed preserved through the
TypeScript build, first line of the compiled `dist/server.js`) and verified
the `brain-mcp.cmd` shim launches correctly on this Windows machine
(connected via the MCP SDK client, listed all 10 tools). **Correction to an
earlier, slightly overstated claim in this milestone's own working notes:**
the shebang makes the bin entry *structurally* correct for POSIX, but actual
POSIX bin execution (a real symlink/exec path, file permission bits, a
gitignored `dist/` needing a build before any bin-link has something to
chmod) was not and could not be verified on this Windows dev machine —
call it "shebang added, POSIX invocation unverified," not "portable."
Neither Claude's nor Codex's config was changed to use the bin — both still
launch `node dist/server.js <dbpath>` directly, per the plan's explicit
"make it available, don't force adoption" scope.

## SHARED DATABASE VERIFICATION

Both configs point at the identical absolute path,
`data\brain.db`, confirmed byte-for-byte identical in both config files
(see CLAUDE CONFIG / CODEX CONFIG above).

## CROSS-CLIENT MEMORY TEST

`packages/mcp/src/process-integration.test.ts` — new, real `child_process`
spawns (not in-process mocking) against a real file-based SQLite DB in a
temp directory. A memory written by one spawned process is confirmed
retrievable, with identical content, by a second independent spawned
process reading the same DB file. Both client connections are unconditionally
closed before any assertion can throw past them (a leak found and fixed
during final review). **Result: PASS.**

## CONCURRENCY TEST

Same file, second test: two independent processes issue 20 concurrent
`brain_remember` calls (10 each) plus, after final review widened the
original narrower version, one concurrent `brain_recall`, one
`brain_feedback`, and one `brain_record_outcome` against a memory seeded
just beforehand — all in the same `Promise.allSettled` batch, against the
same on-disk DB file. Hard requirements, always: zero transport-level
process crashes; SQLite `integrity_check` reports `ok`; every call reporting
success has a real, durable row (no false positives). Not pre-judged: how
many of the 20 memory writes succeed vs. hit a tool-level error under
contention — `packages/storage/src/db.ts` sets WAL mode but never a
`busy_timeout` (defaults to 0ms), so contention was a real possibility, not
assumed away.

**Result: PASS. Characterization — 20/20 remember calls succeeded, 0/20
tool-level errors; 3/3 read/feedback/outcome calls succeeded, 0/3 tool-level
errors.** No contention observed at this scale and on this machine; the test
would have reported it, not hidden it, if it had occurred.

## PROVENANCE GAP

Confirmed, not assumed: `docs/agent-integration/AGENT_INTEGRATION_FINDINGS.md`
reads all four telemetry event schemas
(`packages/core/contracts/src/events.ts`) directly —
`RetrievalEvent`/`ContextEvent`/`OutcomeEvent`/`FeedbackEvent` have no
actor/client field, and all four are `.strict()`, so an actor field sent
today would be rejected with a thrown `ZodError`, not silently accepted or
silently ignored. One precedent exists in the same file
(`MemoryMutationEvent.actor: ProvenanceSchema`, for the memory audit log, not
telemetry). **Not implemented in this milestone, deliberately** — adding it
properly needs three coordinated changes (event schema, a DB migration,
`EventStore` read/write in `packages/storage`) plus a design decision about
what value each client sends; the MCP tool surface itself would update
automatically (it derives its input shapes from the event schemas). Full
recommendation and next-step in the findings doc.

## FILES CHANGED

Repo (9 commits on `feat/visualizer-v0.1`, on top of pre-existing unrelated
work from before this milestone):
- `docs/agent-integration/AGENT_INTEGRATION_V1_SPEC.md` (new)
- `docs/agent-integration/AGENT_BRAIN_PROTOCOL.md` (new, corrected post-review)
- `docs/agent-integration/AGENT_INTEGRATION_FINDINGS.md` (new, corrected post-review)
- `docs/agent-integration/AGENT_INTEGRATION_V1_REPORT.md` (this file)
- `AGENTS.md` (new, repo root)
- `CLAUDE.md` (new, repo root)
- `packages/mcp/src/server.ts` (+2: shebang)
- `packages/mcp/src/process-integration.test.ts` (new, then hardened + widened post-review)
- `packages/mcp/package.json` (1-line `pretest` fix, post-review)

Outside the repo (not in git, not part of any commit):
- `C:\Users\LENOVO V330\.codex\config.toml` (+7 lines, appended)

## TEST RESULT

`npm run typecheck`: clean. `npm run build`: clean. `npm test` (full repo,
after the post-review fix wave): **900/900 passing, 0 failures**, across
all 17 workspaces. Up from the pre-milestone 808 baseline — +92, all outside
production behavior: `packages/mcp`'s 2 new tests plus `packages/visualizer`'s
63 tests (29 `node --test` + 34 `vitest`), a package that already existed
but had never been counted in any baseline before this milestone. `npm
audit`: 2 pre-existing vulnerabilities (`fast-uri` high, `qs` moderate, both
third-party transitive deps, both pre-dating this milestone, both fixable
via `npm audit fix` — not touched, out of scope). Confirmed unchanged:
learning default `false`, redundancy/near-duplicate default `false`, MCP
tool count `10`.

## RISKS

- **Codex integration is configured but unverified.** The config is correct
  (byte-identical command/args to Claude's proven-working entry), but no
  live connection has ever been made. First real risk surface if/when Codex
  is available: confirm on a real run, don't assume from config alone.
- **SQLite concurrency was characterized at one scale, on one machine.**
  Zero contention was observed with 2 processes / 23 concurrent calls on
  this Windows dev box; that is evidence at this scale, not a proof it holds
  at higher concurrency or on other platforms. `busy_timeout` is still unset
  in `packages/storage/src/db.ts` — if contention is ever observed in
  practice, that pragma is the first thing to add, not a rethink of WAL mode.
- **No provenance tracking.** Feedback/outcomes cannot currently be
  attributed to Claude vs. Codex vs. any other client. Deliberate, deferred,
  documented — see PROVENANCE GAP above.
- **The `brain-mcp` bin entry's POSIX behavior is unverified** (see STABLE
  MCP LAUNCHER above) — low risk today, since no config actually uses it
  yet.

## REMAINING UNIVERSALIZATION WORK

1. Run the Task 4 manual checklist for real once Codex is available, and
   correct CODEX CONNECTION TEST from "not run" to an actual result.
2. Decide whether either client config should move to the `brain-mcp` bin
   entry instead of a raw `node dist/server.js` invocation — not required,
   available if wanted.
3. A follow-up milestone to add client/actor provenance (see the findings
   doc's next-step recommendation) — schema + migration + `EventStore`
   changes, MCP tool surface updates automatically.
4. If real-world concurrent usage ever surfaces `SQLITE_BUSY`-style errors,
   add a `busy_timeout` pragma in `packages/storage/src/db.ts` — characterized
   as a real possibility in this milestone, not yet observed, not yet needed.

## RECOMMENDED NEXT STEP

Get Codex actually open and reachable, run the Task 4 checklist for a real
pass/fail, and close out REMAINING UNIVERSALIZATION WORK item 1. Everything
else in this milestone is verified and merge-ready as-is.

---

STOP. Phase 4.4 was not started. Learning was not enabled. No
client-specific Brain logic was created.
