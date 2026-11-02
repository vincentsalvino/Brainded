# Local runtime data

This directory holds `brain.db` and any local backups. Databases and SQLite
sidecars are ignored by Git; do not commit shared memory or credentials.

After building, run `npm run mcp` from the repository root to create the database
and apply migrations. MCP clients should pass its absolute path. The visualizer
reads the same file without modifying it.

Tests use fixtures and temporary databases instead of this live database. See
[the contribution guide](../CONTRIBUTING.md) for optional corpus-based tests.
