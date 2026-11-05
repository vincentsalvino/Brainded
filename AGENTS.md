# Agent Instructions

This project ships an MCP server, `@brain/mcp`, providing persistent
memory/context tools (`brain_*`) configured to be shared identically across
every agent that connects to it — Claude Code, Codex, and any other MCP
client.

Read `docs/agent-integration/AGENT_BRAIN_PROTOCOL.md` before using any
`brain_*` tool. It defines the client-independent usage contract: when to pull
context, when a memory is worth writing, and how to report feedback and
outcomes.

`@brain/mcp` is shared cross-agent memory, not a replacement for Codex's own
native memory — the protocol above covers how the two coexist.

For substantive work (architecture-sensitive, multi-file, a bug
investigation, a refactor, a schema/API change) — not a typo or a one-line
fix — call `brain_context` before implementing, keep the `taskId` and
`contextId`, record `brain_feedback` for clear judgments on delivered
memories, and call `brain_record_outcome` before replying. Full policy:
`docs/agent-integration/BRAIN_WORKFLOW_POLICY.md`.

Do not implement Codex-specific (or any client-specific) Brain logic — the
protocol above applies identically regardless of which agent is connected.
