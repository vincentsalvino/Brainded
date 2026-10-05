# Agent-Agnostic AI Brain — Architecture

## Status

**Architecture direction:** Proposed  
**Primary use case:** Programming/coding agents and engineering workflows  
**Primary integration:** Model Context Protocol (MCP)

> The Brain is infrastructure for agents, not an agent framework.

# 1. Problem

AI coding agents repeatedly encounter:

- lost project decisions
- repeated repository discovery
- buried previous solutions
- inefficient context windows
- duplicated research
- irrelevant retrieval
- prompt-stuffing memory systems
- inflexible fixed-agent architectures
- learning data mixed into user context
- accidental promotion of agent-specific experience into universal truth

The Brain addresses these problems without owning the agent.

# 2. Design Goal

```text
Any compatible agent
        |
        v
      Brain
        |
        +--> relevant memory
        +--> project knowledge
        +--> codebase knowledge
        +--> engineering patterns
        +--> previous experience
        |
        v
small, high-value context
```

The objective is:

> Minimum sufficient context for maximum reliable task performance.

# 3. System Boundary

## Inside Brain

The Brain owns:

- memory
- knowledge
- indexing
- retrieval
- ranking
- context compilation
- compression
- token budgeting
- memory lifecycle
- learning
- retrieval telemetry
- project state
- codebase intelligence

## Outside Brain

External agents own:

- reasoning
- planning
- model inference
- code generation
- terminal execution
- browser execution
- IDE interaction
- user interaction
- agent-specific tool strategy

# 4. Layered Architecture

```text
+-----------------------------------------------------------+
|                    EXTERNAL AGENT                         |
| Claude Code / AiderDesk / Cursor / Codex / Custom Agent |
+-----------------------------+-----------------------------+
                              |
                              | MCP / SDK / HTTP
                              v
+-----------------------------------------------------------+
|                    BRAIN ADAPTER                          |
| MCP Server | SDK | CLI | HTTP                            |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
|                     BRAIN GATEWAY                         |
| identity | sessions | scopes | budgets | permissions     |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
|                       BRAIN CORE                           |
|                                                           |
| Context Planner                                           |
| Retrieval Engine                                          |
| Reranker                                                  |
| Context Compiler                                          |
| Compression                                               |
| Token Budgeter                                            |
| Memory Manager                                            |
| Learning Engine                                           |
+-----------------------------+-----------------------------+
                              |
             +----------------+----------------+
             |                |                |
             v                v                v
+------------------+ +------------------+ +------------------+
| Memory Store     | | Knowledge Store  | | Codebase Index   |
| facts            | | patterns         | | files            |
| decisions        | | rules            | | symbols          |
| experiences      | | procedures       | | dependencies     |
| errors           | | standards        | | references       |
+------------------+ +------------------+ +------------------+
             |                |                |
             +----------------+----------------+
                              |
                              v
+-----------------------------------------------------------+
|                     LEARNING DATA                         |
| retrieval logs | outcomes | reviews | edits | metrics   |
+-----------------------------------------------------------+
```

# 5. Adapter Layer

The adapter layer translates external-agent protocols into Brain operations.

MCP should be the first adapter.

The adapter must remain thin.

```text
brain_context MCP tool
        |
        v
BrainContextService.getContext(...)
```

The same service should be reusable by MCP, SDK, HTTP, CLI, and future adapters.

The Brain core must not depend on MCP.

# 6. Brain Gateway

The gateway establishes request context.

Example:

```json
{
  "agent_id": "custom-agent",
  "session_id": "session-123",
  "project_id": "project-456",
  "repository_id": "repo-789"
}
```

It determines:

- identity
- session
- project
- repository
- available scopes
- requested token budget
- capabilities
- permissions

Avoid vendor-specific agent classes inside the Brain core.

# 7. Memory Model

Memory records should be typed.

Conceptual model:

```ts
type MemoryType =
  | "fact"
  | "decision"
  | "pattern"
  | "rule"
  | "procedure"
  | "experience"
  | "error"
  | "constraint"
  | "project_state"
  | "task_state"
  | "agent_experience"
  | "preference";
```

Example:

```json
{
  "id": "mem_123",
  "type": "decision",
  "scope": "project",
  "scope_id": "project_456",
  "content": "Authentication uses database-backed sessions.",
  "confidence": 0.94,
  "source": "agent_observation"
}
```

The exact schema must be finalized during implementation.

# 8. Scope Model

Potential scopes:

```text
global
user
organization
project
repository
workspace
agent
session
```

Scope is both a security and retrieval concept.

A memory outside the agent's allowed scope must not be returned simply because it is semantically relevant.

**Scope is not the same concept as content domain.** A domain/category tag (e.g. "frontend," "backend," "architecture") describes what a piece of knowledge is about and is useful for filtering and retrieval. It is not an authorization boundary and must never be used as one. Access isolation is decided exclusively by scope; domain tagging carries no security meaning. (Phase 0 audit finding: both reference implementations partially conflated these two concepts — one had no scope mechanism at all, the other used a single field for both content categorization and attempted access control, and that field did not actually enforce isolation at the storage layer.)

# 9. Retrieval Engine

Retrieval should be multi-stage.

## Stage 1 — Cheap candidate generation

Potential signals:

- FTS5/BM25
- tags
- metadata
- exact identifiers
- symbol names
- project filters
- repository filters

## Stage 2 — Semantic retrieval

Use vector similarity where useful.

## Stage 3 — Reranking

Consider:

- task relevance
- scope relevance
- confidence
- freshness
- historical usefulness
- source quality
- diversity
- contradiction risk

## Stage 4 — Context selection

Select only information that contributes useful context.

# 10. Retrieval Pipeline

```text
Task
 |
 v
Intent / Query Planning
 |
 +--> lexical retrieval
 +--> semantic retrieval
 +--> code/symbol retrieval
 +--> project knowledge
 +--> episodic retrieval
 |
 v
Candidate Pool
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
Conflict Detection
 |
 v
Deduplication
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

# 11. Context Compiler

The Context Compiler converts retrieved candidates into an agent-ready context pack.

Input:

- task
- scope
- budget
- agent capabilities
- retrieval candidates

Operations:

```text
candidate set
    |
    v
deduplicate
    |
    v
resolve / flag conflicts
    |
    v
rank information value
    |
    v
compress
    |
    v
allocate token budget
    |
    v
validate budget
    |
    v
context pack
```

The compiler should optimize information density rather than raw document quantity.

# 12. Token Budgeting

Token budgets are a hard architectural boundary.

Example:

```json
{
  "budget": {
    "maxTokens": 3000
  }
}
```

The Brain must estimate and enforce the resulting context size before returning it.

Internal learning data should normally remain internal:

- retrieval counts
- success statistics
- ranking features
- candidate scores
- review history
- telemetry

The agent should receive useful knowledge, not the Brain's entire internal state.

# 13. Agent Protocol

Initial stable operations:

- `brain_context`
- `brain_recall`
- `brain_search`
- `brain_remember`
- `brain_update`
- `brain_feedback`
- `brain_record_outcome`
- `brain_forget`
- `brain_status`
- `brain_project`

The Brain may contain many more internal services. The external protocol should remain small and stable.

# 14. Agent Connection Lifecycle

```text
Agent starts
    |
    v
Connects to Brain MCP
    |
    v
Brain establishes session
    |
    v
Agent optionally provides identity/capabilities
    |
    v
Agent works normally
    |
    +--> brain_context
    +--> brain_recall
    +--> brain_remember
    +--> brain_feedback
    |
    v
Session ends
```

No custom agent implementation is required.

# 15. Agent Profiles

Agent profiles should be data rather than classes.

Example:

```json
{
  "agent_id": "agent_123",
  "capabilities": [
    "typescript",
    "react",
    "terminal"
  ],
  "context_limit": 8000
}
```

The Brain may learn which memories and retrieval strategies work well for an agent, but this information should remain appropriately scoped.

# 16. Knowledge vs Experience

## Knowledge

Reusable information:

- framework patterns
- engineering principles
- repository conventions
- architecture decisions
- coding standards

## Experience

Interaction-derived information:

- previous implementation failures
- successful approaches
- debugging discoveries
- task-specific lessons
- agent observations

Experience may be promoted into knowledge through a controlled process.

# 17. Learning Architecture

```text
Retrieval
   |
   v
Agent Usage
   |
   v
Task Outcome
   |
   +--> tests
   +--> review
   +--> human edits
   +--> success/failure
   |
   v
Feedback
   |
   v
Learning Store
   |
   +--> ranking
   +--> confidence
   +--> promotion
   +--> demotion
   +--> aging
```

Learning should improve the Brain over time without requiring larger agent prompts.

**Context inclusion must be tracked as distinct from retrieval.** A memory can be retrieved as a candidate without being included in the final context pack (it may be out-ranked or dropped for budget). Outcome attribution must be computed against what was actually delivered to the agent, not against the full candidate pool — otherwise a memory that was considered but never shown can be incorrectly credited or blamed for a task's outcome. (Phase 0 audit finding: both reference implementations logged retrieval but neither distinguished "considered" from "delivered," and neither had a working path from outcome back to ranking at all.)

# 18. Codebase Intelligence

Coding-first indexing should cover:

- files
- symbols
- imports
- references
- dependencies
- configuration
- tests
- documentation
- architecture notes

Potential future capabilities:

- symbol-level retrieval
- dependency-aware retrieval
- change-aware context
- test-aware retrieval
- repository architecture inference
- code relationship graphs

The codebase index is a knowledge source. It is not identical to memory.

# 19. Memory Lifecycle

```text
Candidate
   |
   v
Captured
   |
   v
Validated
   |
   v
Active
   |
   +--> reused
   +--> strengthened
   +--> weakened
   +--> stale
   |
   v
Archived / Removed
```

Possible lifecycle signals include confidence, repeated confirmation, successful reuse, contradiction, age, source quality, explicit correction, and task outcomes.

# 20. Promotion and Demotion

Not all experiences should become durable knowledge.

```text
Agent Experience
       |
       v
Repeated evidence
       |
       v
Validation
       |
       v
Candidate Knowledge
       |
       v
Promotion
```

Conversely:

```text
Knowledge
   |
   v
Repeated contradiction
   |
   v
Confidence reduction
   |
   v
Demotion / review
```

The exact policy should be evaluated empirically.

# 21. Security and Isolation

The Brain must enforce authorization before retrieval results reach an agent.

Minimum requirements:

- project isolation
- repository isolation
- explicit memory scopes
- agent/session identity
- deletion support
- provenance
- access control
- no accidental cross-project retrieval

Semantic similarity must never override authorization.

# 22. Evaluation

The Brain must be evaluated using real coding tasks.

## Quality

Measure:

- tests passing
- review score
- human edits
- task success
- regression rate

## Retrieval

Measure:

- precision@K
- recall@K
- NDCG
- usefulness rate
- irrelevant retrieval rate

## Efficiency

Measure:

- context tokens
- total model tokens
- retrieval tokens
- tool calls
- latency
- cost
- useful tokens / total context tokens

## Memory

Measure:

- future reuse
- false-memory rate
- stale-memory rate
- contradiction rate
- correction rate

Optimization target:

```text
maximum reliable task quality
/
minimum total cost
```

# 23. Existing AEOS / AEOS-brain Integration

AEOS and AEOS-brain are reference implementations.

They should be audited before migration.

Potential reusable areas may include:

- hybrid retrieval
- FTS
- vector search
- knowledge schemas
- retrieval logs
- performance scoring
- exploration strategies
- knowledge aging
- promotion/demotion
- evaluation
- codebase search
- documentation search
- context-budget protection
- MCP concepts

No component should be migrated solely because it already exists. Every component must pass the target architecture's compatibility test.

# 24. Migration Principle

```text
Audit
  |
  v
Compare
  |
  v
Classify
  |
  +--> KEEP
  +--> ADAPT
  +--> REWRITE
  +--> DROP
  +--> INVESTIGATE
  |
  v
Target Architecture
  |
  v
Incremental Implementation
```

Avoid simply adding old repositories together.

The goal is to create the best architecture using validated components from both projects.

# 25. Storage Direction

Start local-first.

Initial candidates:

- SQLite
- FTS5
- sqlite-vec / local vector search
- filesystem

The storage layer must expose interfaces so implementations can later be replaced.

Avoid prematurely coupling the architecture to:

- one vector database
- one cloud provider
- one embedding provider
- one LLM provider

# 26. Suggested Package Architecture

```text
brain/
|
+-- packages/
|
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

Exact package boundaries may change after auditing AEOS and AEOS-brain.

# 27. Optional Orchestrator

An orchestrator may eventually exist:

```text
brain-core
   |
   +-- brain-mcp
   +-- brain-sdk
   +-- brain-cli
   |
   +-- optional brain-orchestrator
```

The orchestrator is optional and must not become a hidden dependency of the Brain.

# 28. Non-Goals

The initial Brain is not:

- Claude Code
- Aider
- AiderDesk
- Cursor
- Codex
- an agent replacement
- a fixed multi-agent framework
- a prompt library
- a generic vector database wrapper
- a mandatory orchestration framework
- a cloud-first SaaS product

# 29. Architectural Invariants

1. The Brain is agent-agnostic.
2. Agents are external consumers.
3. MCP is an adapter.
4. The Brain core works without MCP.
5. Memory is typed.
6. Memory is scoped.
7. Knowledge and experience are distinct.
8. Retrieval is separate from context compilation.
9. Token budgets are enforced.
10. Internal learning telemetry is separate from normal context.
11. Agent-specific experience does not automatically become global knowledge.
12. Storage is replaceable.
13. Vendor-specific agent logic does not belong in Brain core.
14. Token optimization cannot reduce task quality.
15. Existing AEOS/AEOS-brain code is reused only after audit.
16. Migration is incremental rather than a giant rewrite.
17. Architecture changes must be explicitly documented.
18. The Brain must remain useful even when the external agent changes.
19. The Brain's default configuration performs basic memory and knowledge operations with zero required external network calls. Hosted embedding or LLM providers may be configured as optional enhancements but must never be load-bearing for core operation. (Added post-Phase-0-audit: AEOS-brain's hard dependency on a hosted embedding/LLM API for every write was its most significant architectural regression relative to AEOS's fully local approach.)
20. Core packages require automated tests, including explicit coverage of their degradation/failure paths, before being considered complete. (Added post-Phase-0-audit: both reference implementations shipped core logic with effectively no automated test coverage and both accumulated defects a test would have caught — a silently data-losing schema parser, a silently-swallowed broken database call, a live concurrency bug.)
21. Layer boundaries stated as invariants above — MCP as a thin adapter, core independence from storage implementation details — are enforced mechanically (e.g. CI import-boundary checks) wherever practical, not by convention or code review alone. (Added post-Phase-0-audit: both reference implementations stated an MCP-thinness principle and both drifted from it as they grew, with nothing catching the drift.)
