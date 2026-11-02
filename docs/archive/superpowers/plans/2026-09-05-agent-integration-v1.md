# Agent Integration V1 (Claude Code + Codex) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `@brain/mcp` server reachable from both Claude Code and the OpenAI Codex desktop app through the identical stdio process and the identical SQLite database, with zero client-specific Brain code.

**Architecture:** One MCP server (`packages/mcp`, stdio transport, already exposing exactly 10 `brain_*` tools) launched identically by two independent MCP clients — Claude Code's existing global `mcpServers.brain` entry, and a new `[mcp_servers.ai-brain]` table in Codex's `config.toml` — both pointed at the same `data/brain.db` file. No new packages, no per-client adapters, no per-client storage.

**Tech Stack:** TypeScript (Node >=24, `NodeNext`), `@modelcontextprotocol/sdk` ^1.30.0 (stdio client + server transports), better-sqlite3 + sqlite-vec (WAL mode), Node's built-in test runner (`node --test`), npm workspaces. Codex side is TOML config only, no code.

**Spec:** `docs/agent-integration/AGENT_INTEGRATION_V1_SPEC.md` (the user's original brief, captured verbatim, plus an addendum recording two decisions made during planning — read it first, this plan implements it task-by-task but does not repeat its rationale).

## Global Constraints

- Node `>=24` (root `package.json:6`, `engines.node`).
- Every package tests with `node --test` against `dist-test/**/*.test.js` (compiled by each package's `tsconfig.test.json`); `packages/visualizer` additionally runs `vitest run` for its React UI layer only — that's the one exception in the whole repo.
- `packages/visualizer` is not named in the root `workspaces` array but is already resolved as a workspace member via the `"packages/*"` glob (root `package.json:9`) and already appears in `package-lock.json`. It is currently untracked in git (pre-existing state, not something this plan changes).
- Root regression baseline going in: **808/808** (`docs/archive/phase-4/PHASE_4_3_REPORT.md:255`), **not yet including** `packages/visualizer`'s 10 test files (4 `node --test`, 6 `vitest`), which have never been counted in any baseline report.
- `DEFAULT_LEARNING_CONFIG.enabled = false` (`packages/core/contracts/src/learning.ts:52`). `bootstrap.ts` passes `DEFAULT_LEARNING_CONFIG` through unchanged (`packages/mcp/src/bootstrap.ts:57`) — do not flip this.
- Redundancy/near-duplicate policy defaults to `{ enabled: false, ...DEFAULT_NEAR_DUPLICATE_POLICY }` at two call sites: `packages/mcp/src/bootstrap.ts:51` and `packages/gateway/src/gateway.ts:85-88`. Do not flip this either.
- All four telemetry event schemas (`RetrievalEvent`, `ContextEvent`, `OutcomeEvent`, `FeedbackEvent` — `packages/core/contracts/src/events.ts`) are Zod `.strict()` — adding any field to them rejects unknown keys from every existing caller until every caller is updated. This is exactly why Task 10 defers the provenance field instead of adding it inline.
- Do NOT create `packages/codex`, `CodexGateway`, `CodexMemoryService`, `ClaudeMemoryService`, or any client-specific storage.
- Do NOT introduce Postgres or any cloud storage.
- Do NOT enable learning or redundancy in this milestone. Do NOT start Phase 4.4.
- The MCP server resolves its DB path from a single positional CLI argument only (`process.argv[2] ?? "./brain.db"`, `packages/mcp/src/server.ts:225`) — there is no environment variable today, and this plan does not add one (Task 3 mirrors Claude's exact command/args instead).

---

## File Structure

**Created:**
- `docs/agent-integration/AGENT_INTEGRATION_V1_SPEC.md` — the spec (already written, see above).
- `docs/agent-integration/AGENT_BRAIN_PROTOCOL.md` — Task 5: client-independent Brain usage contract.
- `docs/agent-integration/AGENT_INTEGRATION_FINDINGS.md` — Task 10: provenance gap analysis + recommendation.
- `AGENTS.md` (repo root) — Task 6: thin pointer for Codex.
- `CLAUDE.md` (repo root) — Task 7: thin pointer for Claude Code (repo-level; distinct from the user's global `~/.claude/CLAUDE.md`, which stays untouched).
- `packages/mcp/src/process-integration.test.ts` — Tasks 9 + 11: real child-process, real file-based-DB tests (the one thing the existing `integration.test.ts` — in-process `InMemoryTransport`, `:memory:` DB — deliberately doesn't cover).

**Modified:**
- `packages/mcp/src/server.ts` — Task 8: add a `#!/usr/bin/env node` shebang so the already-declared `bin.brain-mcp` entry (`packages/mcp/package.json:7-9`) is portable to POSIX, not just Windows' `.cmd` shim.
- `C:\Users\LENOVO V330\.codex\config.toml` — Task 3: append one new `[mcp_servers.ai-brain]` table. Does not touch the guarded `# === nogic-extension begin ... end ===` block or anything else in the file.

**Explicitly NOT modified by this plan** (documented, not silently skipped):
- `C:\Users\LENOVO V330\.claude.json` — Claude's existing global `mcpServers.brain` entry is the reference behavior this plan reproduces for Codex; changing it (e.g. to point at the new `brain-mcp` bin instead of raw `node dist/server.js`) is a separate, later decision, not part of this milestone.
- Any Zod schema in `packages/core/contracts/src/events.ts` — Task 10 is analysis-only.

---

### Task 1: Document Current Claude MCP Launcher Config

**Files:**
- None changed — this task's deliverable is the documented record below, consumed by Task 3 (must mirror it) and Task 5 (protocol doc references it).

**Interfaces:**
- Produces: the exact "canonical launcher" facts every later task treats as ground truth.

- [ ] **Step 1: Confirm the config verbatim**

Read `C:\Users\LENOVO V330\.claude.json`, the top-level `mcpServers` key (lines 1925-1935 as of this session — line numbers will drift as the file grows, search for `"mcpServers"` at the top level, not inside any `"projects"` entry). Confirm it still reads:

```json
"mcpServers": {
  "brain": {
    "type": "stdio",
    "command": "node",
    "args": [
      "C:\\Users\\LENOVO V330\\OneDrive\\Desktop\\ai-brain\\packages\\mcp\\dist\\server.js",
      "C:\\Users\\LENOVO V330\\OneDrive\\Desktop\\ai-brain\\data\\brain.db"
    ],
    "env": {}
  }
}
```

Also confirm every entry under `"projects"` still has `"mcpServers": {}` (empty) — i.e. this is a **global**-scope server, not project-scoped, so it is already available to every Claude Code project on this machine, not just this repo.

- [ ] **Step 2: Record the canonical facts**

Write these down verbatim (they feed Task 3 and Task 5 word for word):
- **command:** `node`
- **args:** `[<absolute path to packages/mcp/dist/server.js>, <absolute path to data/brain.db>]`
- **cwd:** not set by Claude Code's launcher — the server never reads `process.cwd()` for anything path-related (confirmed: `bootstrap.ts` and `server.ts` resolve nothing off `cwd`, only off the positional `dbPath` argument and `import.meta.url`-derived `__dirname`).
- **env:** `{}` — empty. No environment variable is read anywhere in `packages/mcp/src` (confirmed absent by grep).
- **database path behavior:** positional argv[2], defaulting to `./brain.db` (relative to `cwd`) only if omitted — Claude Code's config always supplies it explicitly, so the default path is never actually exercised in production.

- [ ] **Step 3: No commit needed**

This task produces no file changes — its output is consumed directly by Tasks 3 and 5below. Do not commit.

---

### Task 2: Verify MCP Entrypoint & Tool Count

**Files:**
- Read-only: `packages/mcp/package.json`, `packages/mcp/src/server.ts`, `packages/mcp/src/bootstrap.ts`, `packages/mcp/src/boundaries.test.ts`.

**Interfaces:**
- Consumes: nothing new.
- Produces: confirmation that `npm run build` produces a working `packages/mcp/dist/server.js`, and that the 10-tool boundary test already enforces the tool count mechanically.

- [ ] **Step 1: Build and confirm the entrypoint exists**

```bash
npm run build
test -f packages/mcp/dist/server.js && echo "entrypoint OK"
```

Expected: `entrypoint OK`, no build errors.

- [ ] **Step 2: Run the existing tool-count boundary test**

```bash
cd packages/mcp && npm run pretest && node --test "dist-test/boundaries.test.js"
```

Expected: PASS. This test (`packages/mcp/src/boundaries.test.ts:90-96`) already asserts `toolCount === 10` by counting `server.registerTool(` calls in the built `server.ts` source, and that `gatewayCallCount === toolCount` (no handler calls more or less than one gateway method). Nothing to add here — Task 2 is verification of an existing guarantee, not new code.

- [ ] **Step 3: Confirm the 10 tool names by hand once, for the final report**

```bash
grep -oE '"brain_[a-z_]+"' packages/mcp/src/server.ts | sort -u
```

Expected output (exactly 10 lines): `brain_context`, `brain_feedback`, `brain_forget`, `brain_project`, `brain_record_outcome`, `brain_recall`, `brain_remember`, `brain_search`, `brain_status`, `brain_update`.

- [ ] **Step 4: No commit needed**

Verification only.

---

### Task 3: Add Codex MCP Configuration

**Files:**
- Modify: `C:\Users\LENOVO V330\.codex\config.toml` (append only — do not touch the existing `# === nogic-extension begin ... end ===` block, the `[projects.*]` entries, or any `[plugins.*]` entries).

**Interfaces:**
- Consumes: Task 1's exact `command`/`args` facts.
- Produces: an `[mcp_servers.ai-brain]` table Codex will pick up on next launch.

**Context:** the user confirmed on 2026-09-05 that `~/.codex/config.toml` — despite belonging to OpenAI's consumer Codex desktop app (computer-use/browser/documents/pets/dictation-history plugins, not a narrow coding CLI) — is the correct integration target. `codex` is not on this machine's PATH, so the spec's preferred `codex mcp add ai-brain -- <command>` cannot be run here; this task edits the TOML directly, which is functionally identical to what `codex mcp add` would write.

- [ ] **Step 1: Append the new table**

Add this to the end of `C:\Users\LENOVO V330\.codex\config.toml` (after the `# === nogic-extension end ===` line, as a new top-level table — MCP server tables in TOML are order-independent, so appending at the end is safe and keeps the diff minimal):

```toml

[mcp_servers.ai-brain]
command = "node"
args = [
  "C:\\Users\\LENOVO V330\\OneDrive\\Desktop\\ai-brain\\packages\\mcp\\dist\\server.js",
  "C:\\Users\\LENOVO V330\\OneDrive\\Desktop\\ai-brain\\data\\brain.db",
]
```

Same `command`, same `args`, same absolute DB path as Claude's config from Task 1 — byte-for-byte the same two paths, so both clients provably point at the same server binary and the same database file.

- [ ] **Step 2: Validate the TOML parses**

```bash
node -e "const toml=require('node:fs').readFileSync(String.raw\`C:\Users\LENOVO V330\.codex\config.toml\`,'utf-8'); console.log(toml.includes('[mcp_servers.ai-brain]') ? 'present' : 'MISSING')"
```
(A full TOML-syntax validation would need a TOML parser dependency this repo doesn't have — `npm ls toml` confirms none is installed, and installing one just to validate a single hand-written table is exactly the kind of dependency this plan's Global Constraints forbid adding for no reason. A visual diff review plus confirming the nogic block's exact byte range is unchanged is the proportionate check here.)

Expected: `present`. Also re-read the file afterward and confirm the `# === nogic-extension begin (auto-managed; do not edit) ===` ... `# === nogic-extension end ===` block is byte-for-byte unchanged.

- [ ] **Step 3: No commit** — this file lives outside the repo (`C:\Users\LENOVO V330\.codex\`), git is not involved.

---

### Task 4: Codex Smoke Test — BLOCKED, manual follow-up

**Files:** none.

**Why this can't be executed as part of this plan:** `codex` is not installed/reachable on this machine's PATH (`command not found`). This task cannot be run by an agent in this session no matter how Task 3 is configured — it requires the actual Codex desktop app (or its CLI, if this OpenAI Codex product also exposes one) to be launched by the user, not by a background shell.

- [ ] **Step 1: Manual checklist for the user to run once Codex is open**

1. Restart/reload the Codex app (config.toml is read at startup — the new `ai-brain` entry will not appear in an already-running session).
2. Confirm the server is listed as connected (Codex's own MCP status UI, or equivalent of `codex mcp list` / `codex mcp get ai-brain` if this product exposes those subcommands).
3. Call `brain_status` (read-only) and confirm it returns `{ ok: true, vectorSearchAvailable: <boolean> }` — matches the shape asserted in `packages/mcp/src/integration.test.ts:298-308`.
4. Call `brain_recall` with a scope that has no matching memory (e.g. a scope Claude has never written to) and confirm a clean empty result, not an error — read-only, per the spec's explicit "do not create artificial production memories merely to test connectivity."
5. Report back tool count from Codex's own tool-listing UI — expect exactly 10, matching Task 2 Step 3's list.

- [ ] **Step 2: Do not mark this task complete in the final report without evidence**

Per `superpowers:verification-before-completion` — the final report's "CODEX CONNECTION TEST" section must say **NOT RUN (environment blocker: codex not on PATH)**, not a fabricated pass. This is the one task in the whole plan whose real-world verification is outside this session's reach.

---

### Task 5: Write the Shared Agent Protocol

**Files:**
- Create: `docs/agent-integration/AGENT_BRAIN_PROTOCOL.md`

**Interfaces:**
- Consumes: the 10 tool names (Task 2), the correlation shape proven end-to-end by `packages/mcp/src/integration.test.ts`'s `P2-005 ACCEPTANCE` test (`brain_context` → `contextId` → `brain_feedback`/`brain_record_outcome` naming that `contextId`).
- Produces: the one doc both `AGENTS.md` (Task 6) and repo-root `CLAUDE.md` (Task 7) point to.

- [ ] **Step 1: Write the protocol doc**

```markdown
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
```

- [ ] **Step 2: No test to run — this is documentation.** Re-read it once for internal consistency (tool names match Task 2's list, `contextId` correlation matches `integration.test.ts`'s `P2-005` test).

---

### Task 6: Create `AGENTS.md`

**Files:**
- Create: `AGENTS.md` (repo root — confirmed absent; the only `AGENTS.md` anywhere in this repo tree is unrelated bundled reference material under `references/AEOS-brain/...`).

**Interfaces:**
- Consumes: Task 5's doc path.

- [ ] **Step 1: Write the file**

```markdown
# Agent Instructions

This project ships an MCP server, `@brain/mcp`, providing persistent
memory/context tools (`brain_*`) shared identically across every agent that
connects to it — Claude Code, Codex, and any other MCP client.

Read `docs/agent-integration/AGENT_BRAIN_PROTOCOL.md` before using any
`brain_*` tool. It defines the client-independent usage contract: when to pull
context, when a memory is worth writing, and how to report feedback and
outcomes.

Do not implement Codex-specific (or any client-specific) Brain logic — the
protocol above applies identically regardless of which agent is connected.
```

- [ ] **Step 2: No test — documentation only.**

---

### Task 7: Repo-Root `CLAUDE.md`

**Files:**
- Create: `CLAUDE.md` (repo root — confirmed absent; distinct from the user's global `~/.claude/CLAUDE.md`, which already carries unrelated personal preferences and is not touched by this task).

**Interfaces:**
- Consumes: Task 5's doc path.

- [ ] **Step 1: Write the file**

```markdown
# Claude Code Instructions

This project's `@brain/mcp` server provides persistent memory/context tools
(`brain_*`), shared identically with every other MCP client (including Codex)
against the same database.

Read `docs/agent-integration/AGENT_BRAIN_PROTOCOL.md` before using any
`brain_*` tool — it defines the client-independent usage contract and applies
the same regardless of which agent is connected.
```

- [ ] **Step 2: No test — documentation only.**

---

### Task 8: Stable MCP Launcher

**Files:**
- Modify: `packages/mcp/src/server.ts:1`

**Interfaces:**
- Consumes: nothing new.
- Produces: a `dist/server.js` whose first line is `#!/usr/bin/env node`, making the already-declared `packages/mcp/package.json:7-9` `bin.brain-mcp` entry portable to POSIX (npm's Windows `.cmd` shim doesn't need this; a POSIX symlink-style bin invocation does).

**Finding this task starts from:** the bin field already exists (`"bin": { "brain-mcp": "./dist/server.js" }`) — nobody has used it yet (Claude's config launches `node dist/server.js <path>` directly, never the bin shim), and the target file has no shebang. That's the actual gap; there's no new launcher to design, just this one line plus verifying the existing bin wiring actually works.

- [ ] **Step 1: Add the shebang**

At the very top of `packages/mcp/src/server.ts`, before the existing first line (`import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";`), add:

```ts
#!/usr/bin/env node
```

- [ ] **Step 2: Build and confirm TypeScript preserved it**

```bash
npm run build --workspace=@brain/mcp
head -c 20 packages/mcp/dist/server.js
```

Expected: `#!/usr/bin/env node` as the literal first line of the compiled output. (TypeScript has special-cased shebang preservation since 3.x — this is a documented, stable behavior, not something that needs a fallback path if it fails; if `head` shows anything else, stop and investigate rather than working around it.)

- [ ] **Step 3: Verify the bin shim actually launches, on this Windows box**

```bash
npm install
ls node_modules/.bin/brain-mcp*
```

Then start it against a scratch DB and confirm it stays up long enough to answer a real MCP call, using the SDK's own client (this is the same pattern Task 9's test file formalizes — a quick manual proof first):

```bash
node --input-type=module -e "
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const t = new StdioClientTransport({ command: 'node_modules/.bin/brain-mcp.cmd', args: ['./_scratch_launcher_check.db'] });
const c = new Client({ name: 'launcher-check', version: '0.0.0' });
await c.connect(t);
const { tools } = await c.listTools();
console.log('tools:', tools.length);
await c.close();
"
rm -f _scratch_launcher_check.db*
```

(Plain `node -e` defaults to CommonJS, and `require()`-ing the SDK's ESM-only entry points throws `ERR_REQUIRE_ESM` — `--input-type=module` plus `import`/top-level `await` avoids that; Node has supported top-level await in ES modules since 14.8.)

Expected: `tools: 10`. This confirms the bin entry works end to end on Windows via its `.cmd` shim. (Direct POSIX shebang execution — no npm shim involved — can't be verified on this dev machine; the shebang line itself is still correct and portable, verified structurally in Step 2.)

- [ ] **Step 4: Do not change any existing client config**

Per the Global Constraints and the spec's own "eventually" framing (Task 8's brief: "so client configs can *eventually* use `brain-mcp`") — leave Claude's `~/.claude.json` entry and Codex's new `config.toml` entry (Task 3) exactly as they are, both still launching `node <path-to-dist/server.js> <dbpath>` directly. Switching either to the bin command is a separate, later, explicitly-requested change.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/server.ts
git commit -m "feat(mcp): add shebang to server.ts for POSIX bin portability"
```

---

### Task 9: Cross-Client Consistency Test

**Files:**
- Create: `packages/mcp/src/process-integration.test.ts`

**Interfaces:**
- Consumes: `Client`/`StdioClientTransport` from `@modelcontextprotocol/sdk` (already a dependency, `packages/mcp/package.json`), `globalScope` from `@brain/contracts`, the compiled `packages/mcp/dist/server.js` from Task 2/8.
- Produces: `connectViaProcess(dbPath: string): Promise<{ client: Client; close(): Promise<void> }>` and `parsed(result: CallToolResult): any` — both file-local, reused by Task 11's test in the same file.

**Why a new file instead of extending `integration.test.ts`:** that file's `connectCustomAgent()` deliberately uses `InMemoryTransport.createLinkedPair()` against `openDatabase(":memory:")` — in-process, proving the protocol is agent-agnostic. It cannot prove two independent OS processes sharing one on-disk database file behave correctly; that needs a real `child_process` spawn and a real file path, which is what this task and Task 11 are actually for.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { globalScope } from "@brain/contracts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(__dirname, "..", "dist", "server.js");

async function connectViaProcess(dbPath: string) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_JS, dbPath] });
  const client = new Client({ name: "process-integration-test", version: "0.0.0" });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

function parsed(result: CallToolResult): any {
  return JSON.parse((result.content[0] as { text: string }).text);
}

test("cross-client: a memory written by one process is retrievable by a second, independent process, same DB file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-cross-client-"));
  const dbPath = join(dir, "test.db");
  try {
    const clientA = await connectViaProcess(dbPath);
    const created = parsed(
      (await clientA.client.callTool({
        name: "brain_remember",
        arguments: { type: "fact", content: "cross-client fixture", scope: globalScope() },
      })) as CallToolResult,
    ) as { id: string };
    await clientA.close();

    const clientB = await connectViaProcess(dbPath);
    const recalled = parsed(
      (await clientB.client.callTool({
        name: "brain_recall",
        arguments: { scope: globalScope(), id: created.id },
      })) as CallToolResult,
    );
    assert.equal(recalled.id, created.id);
    assert.equal(recalled.content, "cross-client fixture");
    await clientB.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run it to verify it fails first (before Step 3's build) — confirms it's testing the real thing**

```bash
cd packages/mcp && npm run pretest && node --test "dist-test/process-integration.test.js"
```

Expected at this point: PASS is actually likely already (the server code needs no changes for this test — only Task 8's shebang touched `server.ts`, unrelated to this behavior). If it fails, the failure must be a real assertion mismatch or ENOENT on `SERVER_JS`, not a syntax error — if `SERVER_JS` path is wrong, `dist-test/` and `dist/` are confirmed siblings directly under `packages/mcp/` (both `tsconfig.json` and `tsconfig.test.json` set `rootDir: "./src"`, `outDir` as `./dist` and `./dist-test` respectively), so `../dist/server.js` from a compiled `dist-test/process-integration.test.js` is correct as written.

- [ ] **Step 3: Confirm pass**

Same command as Step 2. Expected: PASS, 1/1.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/src/process-integration.test.ts
git commit -m "test(mcp): prove cross-process memory consistency over real stdio + file DB"
```

---

### Task 10: Multi-Client Provenance Audit (Findings Doc)

**Files:**
- Create: `docs/agent-integration/AGENT_INTEGRATION_FINDINGS.md`
- Read-only: `packages/core/contracts/src/events.ts`

**Interfaces:**
- Consumes: nothing new (all facts already gathered during planning).
- Produces: a documented recommendation, deliberately not implemented this milestone.

- [ ] **Step 1: Write the findings doc**

```markdown
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
```

- [ ] **Step 2: No test — documentation only.** Re-read once to confirm the line numbers still match `packages/core/contracts/src/events.ts` at commit time (they were correct as of this planning session; if that file has changed since, re-quote it rather than trusting stale line numbers).

---

### Task 11: Concurrency Check

**Files:**
- Modify: `packages/mcp/src/process-integration.test.ts` (append a second test — same file as Task 9, same `connectViaProcess`/`parsed` helpers, no new file).

**Interfaces:**
- Consumes: `connectViaProcess`, `parsed` (Task 9, same file — no import needed, same module scope).
- Consumes: `openDatabase` from `@brain/storage` (already a `packages/mcp` dependency transitively; add a direct devDependency only if `npm run typecheck` complains — try without first, per the "no unrequested dependency" constraint).
- Produces: a characterization (not an assumption) of whether two concurrent writer processes against the same WAL-mode SQLite file ever hit lock contention, per the spec's explicit "characterize it before changing DB architecture."

**What this test asserts vs. what it only characterizes:** data corruption is never acceptable — that's a hard assertion. Whether every one of 20 concurrent writes succeeds on its first attempt with zero `SQLITE_BUSY`-style errors is an open question this codebase has never tested (`packages/storage/src/db.ts:45` sets `journal_mode = WAL` but never sets `busy_timeout`, which defaults to 0ms) — that part is reported, not pre-judged.

- [ ] **Step 1: Write the test**

Append to `packages/mcp/src/process-integration.test.ts`:

```ts
import { openDatabase } from "@brain/storage";

test("concurrency: two independent processes writing to the same DB file concurrently never corrupt it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-concurrency-"));
  const dbPath = join(dir, "test.db");
  try {
    const clientA = await connectViaProcess(dbPath);
    const clientB = await connectViaProcess(dbPath);

    const callsA = Array.from({ length: 10 }, (_, i) =>
      clientA.client.callTool({
        name: "brain_remember",
        arguments: { type: "fact", content: `concurrency-A-${i}`, scope: globalScope() },
      }) as Promise<CallToolResult>,
    );
    const callsB = Array.from({ length: 10 }, (_, i) =>
      clientB.client.callTool({
        name: "brain_remember",
        arguments: { type: "fact", content: `concurrency-B-${i}`, scope: globalScope() },
      }) as Promise<CallToolResult>,
    );

    const settled = await Promise.allSettled([...callsA, ...callsB]);
    await clientA.close();
    await clientB.close();

    const fulfilled = settled.filter((r): r is PromiseFulfilledResult<CallToolResult> => r.status === "fulfilled");
    const succeeded = fulfilled.filter((r) => r.value.isError !== true);
    const toolErrors = fulfilled.filter((r) => r.value.isError === true);
    const rejected = settled.filter((r) => r.status === "rejected");

    // Hard requirement: no unrecognized crash. A tool-level error (isError:
    // true, e.g. a clean SQLITE_BUSY surfaced through the gateway's error
    // model) is an acceptable, characterizable outcome; a transport-level
    // rejection (process crash, malformed response) is not.
    assert.equal(rejected.length, 0, `expected zero transport-level rejections, got ${rejected.length}: ${JSON.stringify(rejected.map((r) => (r as PromiseRejectedResult).reason?.message))}`);

    // Hard requirement: the database itself is never corrupted, regardless of
    // how many individual writes succeeded.
    const db = openDatabase(dbPath, { readonly: true });
    const integrity = db.raw.pragma("integrity_check") as { integrity_check: string }[];
    assert.deepEqual(integrity, [{ integrity_check: "ok" }]);

    // Hard requirement: every call that reported success actually landed —
    // no silent data loss behind a false-positive success response.
    const storedCount = (db.raw.prepare(`SELECT COUNT(*) as c FROM memories`).get() as { c: number }).c;
    db.close();
    assert.equal(storedCount, succeeded.length, "every call reporting success must have a durable row -- no false positives");

    // Characterization, not a pass/fail gate either way: report what happened.
    console.log(
      `concurrency characterization: ${succeeded.length}/20 succeeded, ${toolErrors.length}/20 returned a tool-level error` +
        (toolErrors.length > 0 ? ` (first: ${JSON.stringify(parsed(toolErrors[0]!.value))})` : ""),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run it**

```bash
cd packages/mcp && npm run pretest && node --test "dist-test/process-integration.test.js"
```

Expected: both tests PASS (this one plus Task 9's). Read the logged characterization line either way — if `toolErrors.length > 0`, that confirms real `busy_timeout`-related contention exists at this concurrency level and is the concrete evidence `docs/agent-integration/AGENT_INTEGRATION_FINDINGS.md` (Task 10) should be amended with one line noting it, plus recommending `db.pragma("busy_timeout = ...")` in `packages/storage/src/db.ts` as a follow-up — do not add that pragma in this task; the spec says characterize, not fix.

- [ ] **Step 3: If `toolErrors.length > 0`, amend the findings doc**

Add one paragraph to `docs/agent-integration/AGENT_INTEGRATION_FINDINGS.md` under a new `## Concurrency characterization` heading, quoting the actual observed count and the actual error shape from Step 2's log line. Do not speculate about what would happen at higher concurrency than what was actually tested.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/src/process-integration.test.ts docs/agent-integration/AGENT_INTEGRATION_FINDINGS.md
git commit -m "test(mcp): characterize concurrent multi-process writes against the same SQLite file"
```

(Omit the findings-doc path from `git add` if Step 3 wasn't needed.)

---

### Task 12: Regression

**Files:** none created/modified — verification only.

- [ ] **Step 1: Full suite**

```bash
npm run typecheck
npm run build
npm test
npm audit
```

Expected: all green. `npm test` now includes `packages/mcp`'s two new tests (Tasks 9, 11) and continues to include `packages/visualizer`'s 10 tests (already workspace-resolved per Global Constraints) — so the total will read **higher than 808**, not equal to it; report the exact new total rather than asserting it should still be 808.

- [ ] **Step 2: Confirm the three specific invariants the spec calls out**

```bash
grep -oE '"brain_[a-z_]+"' packages/mcp/src/server.ts | sort -u | wc -l   # expect 10
grep -A1 "DEFAULT_LEARNING_CONFIG" packages/core/contracts/src/learning.ts | grep enabled   # expect false
grep -B1 -A1 "DEFAULT_NEAR_DUPLICATE_POLICY" packages/mcp/src/bootstrap.ts | grep enabled   # expect false
```

- [ ] **Step 3: No commit** — verification only, nothing to stage beyond what Tasks 3-11 already committed.

---

### Task 13: Final Report

**Files:** none.

- [ ] **Step 1: Produce the report**

Using exactly the section headers the spec requested (## AGENT INTEGRATION STATUS through ## RECOMMENDED NEXT STEP), fill each from this plan's actual execution results — not from this plan's predictions. In particular:
- **CODEX CONNECTION TEST** must read "NOT RUN — `codex` not on PATH in this environment" (Task 4), never a fabricated pass.
- **TEST RESULT** must quote the actual `npm test` total from Task 12 Step 1, not the pre-existing 808 baseline.
- **CONCURRENCY TEST** must quote Task 11's actual characterization line, including whether any tool-level errors occurred.

- [ ] **Step 2: STOP**

Do not start Phase 4.4. Do not enable learning. Do not create client-specific Brain logic. This milestone ends here regardless of how much of Task 4 (Codex smoke test) remains unverified — that gap is reported, not chased further by starting new work.

---

## Self-Review

**Spec coverage:** all 12 of the spec's numbered tasks map onto Tasks 1-12 above 1:1 (this plan's Task 13 adds the Final Report as its own reviewable deliverable, since "write a report" and "implement task 12" are different things a reviewer could accept/reject independently). Two deviations from the spec's literal text, both recorded in the spec's own addendum: the two new doc files nest under `docs/agent-integration/` instead of flat in `docs/`, and Task 3 edits `config.toml` directly instead of shelling out to a `codex` binary that isn't on this machine.

**Placeholder scan:** every code step above has real, complete code (no `TBD`, no "add appropriate error handling" — the concurrency test's error handling *is* the point of the test, spelled out explicitly). Task 4 is the one task that cannot be completed in this environment; it is marked BLOCKED with a concrete manual checklist, not silently implemented as if it succeeded.

**Type consistency:** `connectViaProcess` and `parsed` are defined once in Task 9 and reused as-is (same file, same scope) in Task 11 — no renamed duplicate. `globalScope()` and `CallToolResult` match `packages/mcp/src/integration.test.ts`'s existing usage exactly.
