# Claude Code Instructions

This project's `@brain/mcp` server provides persistent memory/context tools
(`brain_*`), configured to be shared identically with every other MCP client
(including Codex) against the same database.

Read `docs/agent-integration/AGENT_BRAIN_PROTOCOL.md` before using any
`brain_*` tool — it defines the client-independent usage contract and applies
the same regardless of which agent is connected.

`@brain/mcp` is shared cross-agent memory, not a replacement for Claude's own
native/session memory — the protocol above covers how the two coexist.

For substantive work (architecture-sensitive, multi-file, a bug
investigation, a refactor, a schema/API change) — not a typo or a one-line
fix — call `brain_context` before implementing, keep the `contextId`, and
record `brain_record_outcome` when done. Full policy:
`docs/agent-integration/BRAIN_WORKFLOW_POLICY.md`.
