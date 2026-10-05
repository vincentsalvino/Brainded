# Agent-Agnostic AI Brain — Blueprint

## Vision

Build a general-purpose, coding-first AI Second Brain / cognitive infrastructure layer that any AI agent can connect to.

The Brain is not an agent framework. It provides external agents with persistent memory, project and repository knowledge, efficient retrieval, context compilation, token-budget control, memory lifecycle management, retrieval/outcome learning, cross-agent knowledge sharing, and optional agent-specific experience.

The Brain should be particularly effective for programming and software-engineering workflows while remaining general enough for other agent workloads.

## Core Principle

Separate:

### Brain
Owns:
- memory
- knowledge
- retrieval
- ranking
- compression
- context compilation
- token budgeting
- learning
- memory lifecycle
- project knowledge
- codebase intelligence

### Agent
Owns:
- reasoning
- planning
- coding
- tool execution
- user interaction
- model inference

### Adapter
Owns:
- MCP
- SDK
- HTTP
- CLI
- IDE integrations

The Brain must remain useful if the user changes their agent.

## High-Level Architecture

```text
                         USER
                           |
                           v
                     EXTERNAL AGENT
                           |
                           | MCP / SDK / HTTP
                           v
                  +---------------------+
                  |    BRAIN GATEWAY    |
                  +----------+----------+
                             |
                             v
                  +---------------------+
                  |    BRAIN CORE       |
                  |                     |
                  | Memory              |
                  | Retrieval           |
                  | Ranking             |
                  | Context Compiler    |
                  | Compression         |
                  | Token Budgeting     |
                  | Learning            |
                  +----------+----------+
                             |
             +---------------+----------------+
             |               |                |
             v               v                v
        Memory Store    Codebase Index    Knowledge Store
             |               |                |
             +---------------+----------------+
                             |
                             v
                       Outcome / Feedback
                             |
                             +-----> Learning
```

## Agent Integration

MCP is the first-class integration mechanism.

```text
Claude Code --------AiderDesk -----------Cursor ---------------+--> Brain MCP --> Brain Core
Codex ----------------/
Custom Agent --------/
```

The MCP layer should expose a small stable interface:

- `brain_context`
- `brain_recall`
- `brain_search`
- `brain_remember`
- `brain_update`
- `brain_forget`
- `brain_feedback`
- `brain_record_outcome`
- `brain_status`
- `brain_project`

The MCP layer must remain an adapter. It must not contain retrieval, ranking, memory, or context-compilation logic.

## Context Compiler

`brain_context` is the primary high-level Brain interface.

Example:

```json
{
  "task": "Implement OAuth login",
  "project": "my-project",
  "scope": {
    "repository": "repo"
  },
  "budget": {
    "maxTokens": 3000
  }
}
```

The Brain should:

1. interpret task intent
2. identify relevant memory and knowledge layers
3. retrieve candidates
4. rerank candidates
5. check scope and permissions
6. remove duplicates
7. identify conflicts
8. compress information
9. allocate the requested token budget
10. return an agent-ready context pack

## Memory Model

Do not treat all stored information as one generic memory type.

Initial memory types may include:

- `fact`
- `decision`
- `pattern`
- `rule`
- `procedure`
- `experience`
- `error`
- `constraint`
- `project_state`
- `task_state`
- `agent_experience`
- `preference`

Different memory types may eventually have different retention, confidence, retrieval priority, compression, promotion, expiration, and validation behavior.

## Memory Scopes

Suggested hierarchy:

```text
GLOBAL
  |
USER
  |
ORGANIZATION
  |
PROJECT
  |
REPOSITORY
  |
WORKSPACE
  |
AGENT
  |
SESSION
```

Not every deployment needs every scope.

> Agent experience is not automatically global truth.

> Scope (access isolation) and domain/category (content taxonomy) are different concepts. A domain tag is never an authorization boundary.

## Retrieval Architecture

Use multiple retrieval strategies:

- FTS/BM25
- vector similarity
- lexical overlap
- tags
- metadata
- scope
- recency
- confidence
- historical usefulness
- task relevance
- diversity
- exploration

Pipeline:

```text
Task
 |
 v
Intent / query planning
 |
 +--> lexical retrieval
 +--> semantic retrieval
 +--> code/symbol retrieval
 +--> project knowledge
 +--> episodic retrieval
 |
 v
Candidate pool
 |
 v
Reranking
 |
 +--> relevance
 +--> usefulness
 +--> confidence
 +--> scope
 +--> freshness
 +--> diversity
 |
 v
Conflict + deduplication
 |
 v
Context Compiler
 |
 v
Token Budget
 |
 v
Context Pack
```

## Token Efficiency

Token efficiency is a first-class architectural concern.

Measure:

- retrieval efficiency = relevant tokens / retrieved tokens
- context efficiency = useful context tokens / total context tokens
- tool efficiency = successful outcomes / tool calls
- agent efficiency = successful tasks / agent tokens
- overall quality-to-cost using task quality, tokens, tool calls, latency, and model cost

Never optimize token count alone.

A smaller context that produces worse output is a failure.

## Agent Independence

The Brain must not hardcode agent roles.

Do not build the core around ArchitectAgent, FrontendAgent, BackendAgent, or ReviewerAgent.

External agents can identify themselves using metadata and capabilities.

Example:

```json
{
  "agent_id": "custom-agent-123",
  "capabilities": [
    "coding",
    "typescript",
    "terminal"
  ],
  "context_limit": 8000,
  "protocol": "brain-v1"
}
```

Agent-specific behavior should be represented as data/configuration rather than hardcoded agent classes.

## Learning Loop

```text
Agent
 |
 v
Task
 |
 v
Retrieval
 |
 v
Context
 |
 v
Implementation
 |
 v
Outcome
 |
 +--> success
 +--> failure
 +--> human edits
 +--> review
 +--> tests
 |
 v
Feedback
 |
 v
Ranking / Memory Learning
```

Learning telemetry should remain internal and should not automatically be dumped into agent context.

## Knowledge vs Experience

### Knowledge
Generally reusable information such as framework principles, OAuth patterns, database principles, repository conventions, and architecture decisions.

### Experience
Information derived from actual interactions such as previous implementation failures, successful approaches, debugging discoveries, task-specific lessons, and agent observations.

Experience may be promoted into knowledge through a controlled process.

## Codebase Intelligence

Because programming is the primary use case, the Brain should understand repositories.

Potential indexing targets:

- files
- symbols
- imports
- references
- dependencies
- configuration
- tests
- documentation
- architecture notes

The codebase index is a knowledge source. It is not itself equivalent to memory.

## Storage Strategy

Start local-first.

A practical initial direction:

- SQLite
- FTS5
- local vector search / sqlite-vec where appropriate
- filesystem-backed artifacts
- TypeScript / Node
- MCP

Storage and embedding implementations should be hidden behind replaceable interfaces.

Do not lock the Brain to a specific cloud provider.

## Suggested Repository Layout

```text
brain/
|
+-- packages/
|   +-- core/
|   |   +-- contracts/
|   |   +-- memory/
|   |   +-- retrieval/
|   |   +-- ranking/
|   |   +-- context/
|   |   +-- compression/
|   |   +-- learning/
|   |   +-- token/
|   |
|   +-- storage/
|   +-- codebase/
|   +-- knowledge/
|   +-- mcp/
|   +-- sdk/
|   +-- cli/
|
+-- migrations/
+-- seed/
+-- evaluation/
+-- docs/
+-- examples/
+-- data/
+-- tests/
|
+-- BLUEPRINT.md
+-- ARCHITECTURE.md
```

## Development Phases

### Phase 0 — Architecture Audit
Study AEOS and AEOS-brain. Determine what already works, what can be reused, what needs adaptation, what needs rewriting, and what should be discarded.

### Phase 1 — Brain Core
Build contracts, memory model, scopes, storage, basic retrieval, basic context compiler, and token budgeting.

### Phase 2 — MCP
Build the initial Brain MCP interface.

### Phase 3 — Coding Intelligence
Add repository indexing, symbol search, file context, documentation indexing, and project state.

### Phase 4 — Learning
Add retrieval telemetry, outcomes, ranking improvements, memory promotion, memory aging, and evaluation.

### Phase 5 — Advanced Efficiency
Add predictive retrieval, context caching, semantic deduplication, contradiction detection, adaptive token budgets, and agent-specific retrieval policies.

### Phase 6 — Ecosystem
Potentially add SDKs, CLI, cloud synchronization, UI, and optional orchestration.

## Non-Goals

The initial Brain is not:

- a replacement for Claude Code
- a replacement for Aider/AiderDesk
- a replacement for Cursor
- a replacement for Codex
- a fixed multi-agent framework
- a prompt library
- a generic vector database wrapper
- a cloud-first SaaS
- a mandatory orchestration system

## Architectural Invariants

1. Agents are external consumers.
2. MCP is an adapter, not the Brain core.
3. The Brain core works without MCP.
4. Memory types are explicit.
5. Memory has scope.
6. Knowledge and experience are distinct.
7. Retrieval and context compilation are separate.
8. Token budgets are enforced before context reaches the agent.
9. Learning telemetry stays separate from normal agent context.
10. Agent-specific experience does not automatically become global knowledge.
11. Storage technology remains replaceable.
12. Every optimization must preserve or improve task quality.
13. Vendor-specific agent logic does not belong in the Brain core.
14. Existing code is reused only after architectural audit.
15. The Brain's default configuration requires no external network call for basic operation; hosted providers are optional, never load-bearing.
16. Core packages require automated tests, including failure/degradation paths, before being considered complete.
17. Stated layer boundaries (MCP thinness, storage independence) are mechanically enforced, not just documented.
