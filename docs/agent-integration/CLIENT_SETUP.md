# Connect an agent to Memory Atlas

Run `npm run build` from the Memory Atlas checkout. Use absolute paths to the built
server and the intended database. Local clients that should share knowledge
must point at the same database and use the same project ID for the same repo.
Call `brain_status` in a new session to confirm that the tools are connected.

## Local clients

**Codex CLI, IDE, or ChatGPT desktop using the local Codex environment.** If
`ai-brain` is already configured, open a new session and check `brain_status`.
Otherwise, register it once. Codex reads `AGENTS.md` in the project. See the
[official OpenAI documentation for desktop MCP settings](https://learn.chatgpt.com/docs/developer-settings)
and [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

```powershell
codex mcp add ai-brain -- node 'C:/absolute/ai-brain/packages/mcp/dist/server.js' 'C:/absolute/ai-brain/data/brain.db'
```

**Claude Code.** Register the server for your user or choose project scope for
one workspace. Open a new session and check `/mcp`. Put the workflow pointer in
the project's `CLAUDE.md`. See [Claude Code MCP setup](https://code.claude.com/docs/en/mcp)
and [project instructions](https://code.claude.com/docs/en/memory).

```powershell
claude mcp add --transport stdio --scope user ai-brain -- node 'C:/absolute/ai-brain/packages/mcp/dist/server.js' 'C:/absolute/ai-brain/data/brain.db'
```

**Other local MCP hosts.** Add a stdio server using the host's MCP configuration.
For hosts that use an `mcpServers` JSON object, use this entry. Put the workflow
block below in the host's persistent project instructions.

```json
{
  "mcpServers": {
    "ai-brain": {
      "command": "node",
      "args": [
        "C:/absolute/ai-brain/packages/mcp/dist/server.js",
        "C:/absolute/ai-brain/data/brain.db"
      ]
    }
  }
}
```

## Hosted ChatGPT, Claude, and API agents

Check whether the selected host can launch local stdio MCP. A hosted client
that accepts remote MCP needs a reachable, authorized MCP endpoint. This repo
ships a stdio server. For ChatGPT environments that support a private connection,
check the workspace's permissions and the official OpenAI documentation on the
[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
Use the host's project instructions or agent system prompt to install the
workflow block. If the client has no connected `brain_*` tools, follow the
workflow's bypass step.

## Workflow block for any agent

Copy this block into a project's persistent instructions. Replace `PROJECT_ID`
with its stable, shared project ID. In a repository that already points to the
[workflow policy](BRAIN_WORKFLOW_POLICY.md), keep that file as the source of truth.

```text
Use Memory Atlas for substantive project work such as debugging, refactors,
architecture decisions, and multi-file changes. Skip it for trivial edits.

Before implementation, call brain_context with the task description, a fresh
taskId, scope {kind: "project", id: "PROJECT_ID"}, and a bounded maxTokens.
Keep the returned contextId and taskId. Verify relevant memories against the
current files and user instructions. Use brain_search or brain_recall for a
specific follow-up lookup.

Before the final response, review every delivered memory. When usefulness is
clear, call brain_feedback once with the original taskId, contextId, and
memoryId. Mark verified reuse useful. Mark clearly irrelevant, redundant,
or incorrect items with the matching reason. Leave uncertain items unlabeled.
Then call brain_record_outcome with the same taskId and contextId and the
actual result. Include a testsPassed signal only after running the relevant
tests. Save durable new decisions or findings in the narrowest correct scope.

If Brain is unavailable, continue and state the reason once. If a response
has no contextId, report that the delivery could not be attributed.
```

The MCP server also sends the workflow on connection. A client can ignore
server guidance, and a client that never calls Brain leaves no database trace.
To verify a rollout, select a real substantive task, retain its task ID,
and run the [validation runner](../../packages/evaluation/validation/README.md)
with `--task-id`. Check for recorded context, the exact linked outcome,
and feedback for any clearly judged items. The [agent protocol](AGENT_BRAIN_PROTOCOL.md)
documents the tool inputs.
