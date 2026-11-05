# Memory Atlas

Shared, persistent context for coding agents through the Model Context Protocol
(MCP). Memory Atlas stores scoped memories in SQLite and combines memory retrieval,
indexed code, and dependency context within a token budget. Any compatible MCP
client uses the same tools and database contract.

## Getting started

Use **Node.js 24 or newer** and npm. Run these commands from the repository root:

```sh
npm ci
npm run check
```

`check` builds the workspaces in dependency order, checks server and UI types,
and runs the default tests. These tests use fixtures and temporary databases;
they do not need the local `data/brain.db` or optional reference repositories.
Installing dependencies requires network access. Model integration tests are
separate because they can download embedding weights.

## Run the MCP server

After building, run:

```sh
npm run mcp
```

This opens or creates `data/brain.db` and applies the database migrations. The
server uses stdio, so it normally runs as a subprocess of your MCP client. Use
absolute paths when configuring a client that may start outside this directory:

```json
{
  "mcpServers": {
    "ai-brain": {
      "command": "node",
      "args": [
        "/absolute/path/to/ai-brain/packages/mcp/dist/server.js",
        "/absolute/path/to/ai-brain/data/brain.db"
      ]
    }
  }
}
```

Point clients at the same database to share memories. Use project scopes to
isolate project-specific knowledge. Read the
[agent protocol](docs/agent-integration/AGENT_BRAIN_PROTOCOL.md) and
[workflow policy](docs/agent-integration/BRAIN_WORKFLOW_POLICY.md) before using
the `brain_*` tools.
The [client setup guide](docs/agent-integration/CLIENT_SETUP.md) covers Codex,
ChatGPT, Claude Code, and other MCP hosts.

## Open the Memory Atlas visualizer

Once the MCP server has initialized the database:

```sh
npm run dev
```

Vite prints the development URL. The visualizer opens the repository's
`data/brain.db` read-only. Set `BRAIN_DB_PATH` to inspect another database.
For a production build, run `npm run build`, then start it from the root:

```sh
node packages/visualizer/dist/server/server.js data/brain.db
```

The production server defaults to port 4173; `PORT` overrides it.

## Repository layout

```text
packages/
  core/             Contracts, memory, retrieval, ranking, context, token
                    budgeting, compression, learning, and test fixtures
  storage/          SQLite repositories, embeddings, and SQL migrations
  codebase/         File discovery, indexing, and dependency graph
  gateway/          Client-independent orchestration
  knowledge/        Seed validation, import, and query helpers
  evaluation/       Datasets, evaluation gates, and pilot harnesses
  mcp/              MCP stdio adapter and composition root
  visualizer/       Read-only HTTP API, shared types, and React UI
docs/
  architecture/     Architecture and package-boundary references
  agent-integration/ Shared agent protocol and workflow policy
  archive/          Historical audits, phase plans, and reports
data/               Local runtime databases (ignored by Git)
.github/workflows/  Continuous integration
```

Production code and its unit tests stay together under each package's `src/`.
Generated `dist/`, `dist-test/`, model caches, local configuration, and databases
are excluded from Git.

See the [documentation index](docs/README.md) for design references and
[CONTRIBUTING.md](CONTRIBUTING.md) for package rules, checks, and optional tests.

For a reproducible local storage/retrieval/workflow audit, run
`npm run validate:brain -- --db <absolute-db-path> --out <new-results-directory>`.
See the [validation runner](packages/evaluation/validation/README.md) and
[ranked direction and test plan](docs/architecture/BRAIN_EVIDENCE_PLAN.md).

## Install Brain on another device

Build an npm tarball with `npm run package:mcp`. Copy the resulting
`.release/brainded-mcp-0.1.0.tgz` to a device with Node.js 24 or newer.
To keep an existing artifact, pass a different output directory with
`npm run package:mcp -- <output-directory>`.

```sh
npm install --global ./brainded-mcp-0.1.0.tgz
brain-mcp --check
brain-mcp --config
```

Add the generated entry to your MCP client and reconnect. The CLI uses
`~/.brainded/brain.db` by default. Pass an absolute database path after
`--config` to use a different database. The tarball includes the server and
database migrations. npm resolves runtime dependencies for the device. The
first semantic operation can download the model to `~/.brainded/models`.
