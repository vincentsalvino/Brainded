You are working on a new project: an agent-agnostic AI Brain / Second Brain infrastructure for AI coding agents.

The goal is to build a general-purpose memory, knowledge, retrieval, context-compilation, learning, and token-efficiency layer that external AI agents can connect to.

The Brain is especially optimized for programming and software-engineering workflows, but it must remain general enough to support other agent workloads.

============================================================
AUTHORITATIVE ARCHITECTURE
============================================================

Before doing anything else, read:

    BLUEPRINT.md
    ARCHITECTURE.md

These documents describe the intended target architecture.

Treat them as the architectural authority for the NEW Brain.

However, do not blindly assume the architecture is perfect.

If the audit of the existing systems reveals a better architectural approach, document the proposed change in:

    ARCHITECTURE_REVIEW.md

Do not silently modify BLUEPRINT.md or ARCHITECTURE.md.

============================================================
REFERENCE PROJECTS
============================================================

There are two existing projects that contain previous implementations,
experiments, ideas, and architectural work.

Project 1:
    Agent Knowledge Operating System (AEOS)

Project 2:
    AEOS-brain
    https://gitlab.com/aeos3/aeos-brain

They should be available under:

    references/AEOS/
    references/AEOS-brain/

These are REFERENCE IMPLEMENTATIONS.

They are NOT automatically the architecture of the new Brain.

Do not assume that code should be merged simply because it already exists.

============================================================
IMPORTANT ARCHITECTURAL PRINCIPLE
============================================================

The NEW Brain must be AGENT-AGNOSTIC.

Do not hardcode integrations or agent roles into the Brain core.

The Brain must NOT depend architecturally on:

    Claude Code
    Aider
    AiderDesk
    Cursor
    Codex
    specific agent vendors
    ArchitectAgent
    BackendAgent
    FrontendAgent
    ReviewerAgent

These systems are external consumers.

The Brain should expose stable interfaces that allow any compatible
agent to connect.

MCP should be the first-class integration mechanism.

The Brain should own:

    memory
    knowledge
    retrieval
    ranking
    context compilation
    compression
    token budgeting
    learning
    memory lifecycle
    codebase intelligence
    project knowledge

The external agent owns:

    reasoning
    planning
    coding
    tool execution
    user interaction

============================================================
PHASE 0 — AUDIT AEOS
============================================================

Perform a deep audit of the Agent Knowledge Operating System (AEOS).

Do not modify the project.

Understand the actual implementation, not just the documentation.

Audit:

    architecture
    repository structure
    packages/modules
    core abstractions
    memory model
    knowledge model
    storage
    retrieval
    hybrid search
    FTS/BM25
    vector search
    ranking
    reranking
    learning
    feedback
    knowledge aging
    promotion/demotion
    context management
    token optimization
    codebase intelligence
    documentation intelligence
    MCP
    agent integration
    orchestration
    APIs
    CLI
    configuration
    testing
    evaluation
    observability
    deployment
    incomplete components
    duplicated components
    technical debt
    architectural coupling

Determine what is actually implemented.

Identify both strengths and weaknesses.

Create:

    AUDIT_AEOS.md

============================================================
PHASE 1 — AUDIT AEOS-BRAIN
============================================================

Perform the same deep audit of AEOS-brain.

Pay particular attention to:

    its architecture
    its relationship to AEOS
    memory architecture
    knowledge architecture
    retrieval
    context generation
    MCP
    agent integration
    storage
    APIs
    learning
    token efficiency
    codebase intelligence
    incomplete work
    duplicated functionality
    architectural improvements
    architectural regressions
    technical debt

Determine exactly how AEOS-brain relates to AEOS.

Do not assume one is simply a newer version of the other.

Create:

    AUDIT_AEOS_BRAIN.md

============================================================
PHASE 2 — CROSS-PROJECT COMPARISON
============================================================

Compare AEOS and AEOS-brain.

Identify:

    overlapping functionality
    complementary functionality
    conflicting implementations
    better implementations
    incomplete implementations
    architectural differences
    duplicated systems
    missing capabilities
    useful concepts
    concepts that should be abandoned

Create:

    AEOS_COMPARISON.md

Then create:

    MERGE_MATRIX.md

For every significant component, classify it as:

    KEEP
    ADAPT
    REWRITE
    DROP
    INVESTIGATE

For each decision include:

    component
    source project
    location
    purpose
    implementation status
    dependencies
    strengths
    weaknesses
    architectural compatibility
    target Brain layer
    migration strategy
    reason for decision

Do not preserve old architecture merely because it already exists.

============================================================
PHASE 3 — ARCHITECTURE REVIEW
============================================================

Now compare the findings from:

    AUDIT_AEOS.md
    AUDIT_AEOS_BRAIN.md
    AEOS_COMPARISON.md
    MERGE_MATRIX.md

against:

    BLUEPRINT.md
    ARCHITECTURE.md

Identify:

    architectural conflicts
    missing abstractions
    unnecessary abstractions
    reusable components
    components requiring redesign
    components that should remain reference-only
    components that should be removed
    architectural assumptions that should not survive
    capabilities missing from the target architecture

Create:

    ARCHITECTURE_REVIEW.md

Do not silently modify the authoritative architecture files.

============================================================
PHASE 4 — DEFINE THE TARGET SYSTEM
============================================================

Based on the audit and architecture review, define the target Brain.

The target should have a clear separation between:

    Brain Core
    Brain Gateway
    MCP Adapter
    SDK/CLI adapters
    Memory
    Knowledge
    Retrieval
    Ranking
    Context Compiler
    Token Budgeting
    Learning
    Codebase Intelligence
    Storage

The MCP layer should remain thin.

The Brain core must not depend on MCP.

The Brain must be usable by:

    Claude Code
    Aider/AiderDesk
    Cursor
    Codex
    custom agents
    future agents

without creating vendor-specific architecture inside the Brain.

============================================================
PHASE 5 — BUILD PLAN
============================================================

Create:

    BUILD_PLAN.md

Create a phase-by-phase implementation plan.

Do not propose a giant rewrite.

The system must be built incrementally.

For every phase specify:

    objective
    dependencies
    components
    packages/files
    interfaces/contracts
    data models
    migrations
    reused AEOS components
    reused AEOS-brain components
    rewritten components
    discarded components
    tests
    evaluation
    acceptance criteria
    risks
    expected token/cost impact
    what is explicitly NOT implemented yet

The plan should have clear milestones.

============================================================
PHASE 6 — IMPLEMENTATION READINESS
============================================================

Create:

    IMPLEMENTATION_READINESS.md

Answer:

    1. What is the smallest viable Brain?
    2. What must be built first?
    3. What AEOS code should be reused immediately?
    4. What AEOS-brain code should be reused immediately?
    5. What should remain reference-only?
    6. What requires rewriting?
    7. What should be dropped?
    8. Which contracts must be frozen?
    9. What tests must exist?
    10. What is the first implementation milestone?
    11. What are the biggest architectural risks?
    12. What decisions require human approval?

============================================================
TOKEN AND COST EFFICIENCY
============================================================

Token efficiency is a first-class architectural objective.

However:

DO NOT optimize for token count alone.

The goal is:

    maximum useful task quality
    /
    minimum context + model + tool cost

The Brain should eventually measure:

    context tokens
    total model tokens
    retrieval tokens
    useful context
    tool calls
    latency
    task success
    human edits
    review outcomes
    cost

A system that saves tokens but produces worse code is NOT an optimization.

============================================================
MEMORY PRINCIPLES
============================================================

Do not treat all memory as one undifferentiated store.

The target architecture should distinguish concepts such as:

    facts
    decisions
    patterns
    rules
    procedures
    experiences
    errors
    constraints
    project state
    task state
    agent experience

Memory should have explicit scope.

Potential scopes include:

    global
    user
    organization
    project
    repository
    workspace
    agent
    session

Agent-specific experience must not automatically become global knowledge.

============================================================
STOP CONDITION
============================================================

DO NOT START IMPLEMENTING THE NEW BRAIN YET.

Do not create the production Brain implementation.

Do not perform a large migration.

Do not rewrite AEOS.

Do not rewrite AEOS-brain.

First produce:

    AUDIT_AEOS.md
    AUDIT_AEOS_BRAIN.md
    AEOS_COMPARISON.md
    MERGE_MATRIX.md
    ARCHITECTURE_REVIEW.md
    BUILD_PLAN.md
    IMPLEMENTATION_READINESS.md

Then STOP.

Wait for explicit approval before beginning implementation.

The goal of this first phase is to understand what already exists,
determine what is worth keeping, define what needs to change, and
produce a controlled implementation plan for the new Brain.