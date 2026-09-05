# Agent Instructions

This project ships an MCP server, `@brain/mcp`, providing persistent
memory/context tools (`brain_*`) configured to be shared identically across
every agent that connects to it — Claude Code, Codex, and any other MCP
client.

Read `docs/agent-integration/AGENT_BRAIN_PROTOCOL.md` before using any
`brain_*` tool. It defines the client-independent usage contract: when to pull
context, when a memory is worth writing, and how to report feedback and
outcomes.

Do not implement Codex-specific (or any client-specific) Brain logic — the
protocol above applies identically regardless of which agent is connected.
