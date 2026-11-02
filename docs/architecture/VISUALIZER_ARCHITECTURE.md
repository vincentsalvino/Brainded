# Visualizer Architecture

`packages/visualizer` is an independent local developer/observability tool over
the Brain. It is **not** a Brain phase, does not close or advance Phase 4, and
carries no vote on any default-enable decision (learning, redundancy). See
`docs/archive/phase-4/PHASE_4_DECISIONS.md` / `docs/archive/phase-4/PHASE_4_READINESS.md` for the phase record.

## Why this exists

A prior, unrelated visualizer project (referenced only via a gitignored local
folder, `references/AEOS-brain/...`, never part of this repo's history) shipped
a real security hole: a Supabase **service-role key inlined into the browser
bundle**, giving any visitor direct, unrestricted database access. This
package's entire security model exists to make that specific failure
structurally impossible here, not just discouraged by convention.

## The read-only boundary

```
Browser (React UI)
   |  fetch() to /api/* only -- never imports @brain/storage or better-sqlite3
   v
Local HTTP API (src/server/router.ts, routes/)
   |  each route calls exactly one VisualizerQueryService method, no SQL
   v
VisualizerQueryService (src/server/query-service.ts)
   |  typed against @brain/contracts interfaces only (MemoryRepository, EventStore)
   v
bootstrap.ts -- the ONE file in this package allowed to import @brain/storage
   |
   v
SQLite connection -- opened via openDatabase(path, { readonly: true })
```

Three layers of defense, not one:

1. **Structural**: nothing under `src/ui/` can import `@brain/storage`,
   `better-sqlite3`, or `sqlite-vec` -- mechanically enforced by
   `src/server/boundaries.test.ts`, the same technique
   `packages/mcp/src/boundaries.test.ts` already used for the MCP adapter.
2. **Architectural**: only `src/server/bootstrap.ts` constructs concrete storage
   classes. Every other server file is typed against `@brain/contracts`
   interfaces, never a concrete implementation.
3. **Driver-level**: `packages/storage/src/db.ts`'s `openDatabase()` gained an
   additive `{ readonly: true }` mode -- `better-sqlite3`'s native readonly
   option. The connection itself rejects a write; it isn't a promise the code
   keeps, it's a promise SQLite enforces. Existing zero-arg call sites
   (`openDatabase(path)`, e.g. `packages/mcp/src/bootstrap.ts`) are unaffected --
   this mode never runs migrations and never creates the vec0 tables.

## Why a separate VisualizerQueryService, not Gateway

`@brain/gateway` exposes the Brain's 10 stable operations (`brain_context`,
`brain_recall`, etc.) and stays transport-independent. Observability reads --
"list the last 20 context deliveries," "count events by type" -- are a
different semantic category: unfiltered, aggregate, dashboard-shaped reads that
no Brain operation needs. Routing them through Gateway would turn it into a
dashboard backend (e.g. a hypothetical `Gateway.listContextEventsForDashboard()`).

Instead, `VisualizerQueryService` sits parallel to Gateway, on the same
`@brain/contracts` interfaces, calling a small set of additive read methods on
`EventStore`/`MemoryRepository` (row counts, "list recent N", and
`contextId`-scoped feedback/outcome lookups -- deliberately not `taskId`-scoped,
since `ContextEvent.taskId` is nullable and one task can have multiple context
deliveries). Gateway itself was not modified.

## Scope: V0.1

V0.1 shipped twice: first as an observability dashboard (Overview + a
separate Context Inspector page), then the product direction was corrected --
the centerpiece is a **global memory-relationship graph**, with context
inspection folded into it as a trace-mode overlay rather than a standalone
screen. What's actually in this milestone:

- **Foundation**: the package itself, the readonly API boundary, the design
  system, the app shell.
- **Brain Map** (`pages/BrainMapPage.tsx`): the global graph -- every active
  memory as a node, semantic-similarity and `supersedes` relationships as
  edges. Search, click-to-inspect, drag-to-pin.
- **Memory Inspector**: content, metadata, semantic neighbors, delivery/
  feedback summary, and a clearly separate DERIVED/EXPERIMENTAL performance
  block (never merged with `confidence`).
- **Context Trace mode**: selecting a ContextEvent (from the "Contexts" nav)
  returns to the Brain Map with that delivery's included/omitted memories
  highlighted and faded, and adds an "In This Context" section to the
  inspector (rank, token cost, per-context feedback, outcome) when a memory is
  also selected.
- **Overview**: kept as a third nav item -- memory/event counts, system
  status, a merged recent-activity feed. No longer the primary screen, but
  fully working and still useful for a system-health glance.

Explicitly deferred, not started: Memory Explorer (a full filterable table),
Code Intelligence, Code Dependency Graph, Learning Lab (including the OFF/ON
ranking simulator), Experiments, System detail, and every mutation control
(remember/forget/enable learning/etc. -- V0.1 has none, by design).

## Memory graph: relationships, not duplicates

The graph's edges come from two sources, both already part of the Brain --
**no new relationship data is persisted**. The Brain's own Phase 1 spec
explicitly declined a general relationship-graph model
(`docs/archive/phase-1/PHASE_1_SPEC.md:158`, "insufficient evidence either predecessor needed
one"); this visualizes what already exists rather than reversing that:

- **Similarity edges** -- `RetrievalStore.findSimilarPairs(ids, minSimilarity)`,
  the same method built for redundancy detection, called here with a
  **visualization** threshold (0.60 by default) chosen from the corpus's real
  edge/isolated-node distribution, not reused from redundancy detection's
  `DEFAULT_NEAR_DUPLICATE_POLICY.candidateFloor` (0.75 cosine **plus** a
  separate lexical-containment check -- a different algorithm, answering "is
  this a duplicate?" rather than "is this related?"). **A similarity edge
  means two memories are semantically related. It does not mean they are
  duplicates** -- the Phase 2C redundancy false-positive findings do not carry
  over to this graph; a related-but-distinct pair is exactly what this
  visualization is for. UI copy and tooltips say this explicitly wherever a
  similarity score appears.
- **Supersedes edges** -- `MemoryRecord.supersedes`, the one narrow
  relationship Phase 1 did keep, directional (newer → older). No live write
  path sets this field yet, so real data renders zero supersedes edges today;
  it's real, schema-enforced, end-to-end-wired plumbing for whenever one
  exists.

Vectors never leave SQLite for this either: `findSimilarPairs` computes cosine
distance natively in `sqlite-vec` and only `{a, b, similarity}` triples cross
into JS, the same discipline already documented above for the readonly
boundary, applied to embeddings specifically.

## Stack

React + Vite + TypeScript for the UI (no prior precedent in this repo --
deliberately the smallest modern stack, no router, no state-management
library). `d3-force` (physics-only, ~3 transitive deps, no d3-selection/zoom/
drag/scale/shape -- not "the complete D3 stack") drives node positions for the
graph; React owns application/selection state, SVG owns rendering, d3-force
owns layout. Position updates are tick-driven (a default layout run is ~300
ticks) and bypass React entirely via direct DOM ref writes -- 300 full
re-renders of hundreds of SVG elements is the textbook React-in-a-loop
foot-gun. A hand-rolled `node:http` router for the API (five routes; no
Express/Fastify). `node --test` for the server/query layer, matching this
repo's universal convention; Vitest + Testing Library for the UI only -- the
first UI-specific test dependency, justified by React/JSX needing a DOM
environment `node --test` doesn't provide.

`npm run dev --workspace=@brain/visualizer` runs one process: a Vite plugin
(`vite.config.ts`) mounts the same API handler production uses
(`src/server/server.ts`) into Vite's dev middleware. The plugin no-ops under
`vitest run` (`process.env.VITEST`) -- UI tests run against deterministic
fixtures (`src/ui/fixtures/`), never a real database.

Default database path resolves relative to this package's own location on
disk (`../../data/brain.db` from the package root), not `process.cwd()` --
`npm run dev --workspace=...` runs with cwd already inside the package, so a
bare relative default would resolve to the wrong file. Override with
`BRAIN_DB_PATH` for a safe-copy validation run.
