# Claude Code Instructions

This project's `@brain/mcp` server provides persistent memory/context tools
(`brain_*`), configured to be shared identically with every other MCP client
(including Codex) against the same database.

Read `docs/agent-integration/AGENT_BRAIN_PROTOCOL.md` before using any
`brain_*` tool — it defines the client-independent usage contract and applies
the same regardless of which agent is connected.
