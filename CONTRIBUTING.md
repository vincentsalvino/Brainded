# Contributing

## Development commands

Run commands from the repository root after `npm ci`:

| Command | Purpose |
| --- | --- |
| `npm run check` | Build, typecheck all workspaces, and run default tests |
| `npm run build` | Build libraries before the MCP server and visualizer |
| `npm run typecheck` | Build dependency declarations and typecheck every workspace |
| `npm test` | Run default tests after a build |
| `npm run dev` | Start the visualizer against an initialized database |
| `npm run mcp` | Start the MCP stdio server with `data/brain.db` |

For a focused test after building dependencies:

```sh
npm test --workspace=@brain/retrieval
```

Use `npm run check` before committing. CI runs the same command on a clean
checkout, then audits dependencies. Update `package-lock.json` whenever changing
dependencies and install reproducibly with `npm ci`.

## Package boundaries

- Keep public types and repository interfaces in `packages/core/contracts`.
- Keep core services independent of concrete storage and MCP clients.
- Put SQLite implementations and numbered SQL migrations in `packages/storage`.
- Route MCP handlers through `@brain/gateway`. Wire concrete dependencies in
  `packages/mcp/src/bootstrap.ts`.
- Keep the visualizer read-only. Wire its storage dependencies in
  `packages/visualizer/src/server/bootstrap.ts`.
- Keep tests beside the code they exercise. Reuse `@brain/test-fixtures` for
  in-memory implementations and conformance helpers.

Boundary tests enforce these rules. Do not move source packages solely to match
a generic directory template; preserve the dependency layers.

## Optional integration tests

These suites are intentionally separate from `npm test`:

| Workspace | Extra requirement |
| --- | --- |
| `@brain/storage` | Embedding-model download or an existing model cache |
| `@brain/codebase` | Indexes this repository in an isolated database |
| `@brain/evaluation` | Model weights; the historical replay test copies an existing `data/brain.db` corpus |
| `@brain/knowledge` | AEOS's original seed corpus at `references/AEOS/packages/seed` |

Run one explicitly after a build:

```sh
npm run test:integration --workspace=@brain/storage
```

npm runs the matching `pretest:integration` compiler step automatically. Reference
repositories are local inputs and remain outside version control. Evaluation or
pilot code must take an explicit isolated database path; never use the live
shared database as a test fixture.

## Documentation and commits

Start at [docs/README.md](docs/README.md). Keep active architecture references in
`docs/architecture/`, shared agent rules in `docs/agent-integration/`, and completed
phase plans, audits, and reports in `docs/archive/`. Update path references when
moving a document.

Use small, coherent commits with a descriptive subject:

```text
docs(repo): organize project guides and historical reports
build(workspaces): build shared dependencies before applications
fix(ci): run repository checks from the checkout root
```

Commit source, tests, configuration, documentation, and the npm lockfile. Keep
credentials, `.env` files, runtime databases, generated output, and local agent
state out of commits.
