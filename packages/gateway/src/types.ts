import type {
  ScopeRef,
  TokenBudget,
  ContextPack,
  MemoryType,
  MemoryStatus,
  MemoryCreateInput,
  MemoryUpdateInput,
  FeedbackEvent,
  OutcomeEvent,
} from "@brain/contracts";

// Request/response shapes for the 10 brain_* operations. Defined here (not in
// @brain/contracts) because they're Gateway-orchestration-specific -- they
// compose existing contract types with the one thing none of retrieval /
// ranking / context / token individually need but Gateway does: a caller-
// supplied, opaque `taskId` for correlating the event chain
// (RetrievalEvent -> ContextEvent -> OutcomeEvent, PHASE_1_SPEC.md
// Learning/Outcome Telemetry). packages/mcp imports these directly from
// @brain/gateway; nothing outside Gateway/MCP needs them.

/**
 * P2-005 / decision E3. What `brain_context` actually returns.
 *
 * `ContextPack` is core/token's output and stays exactly as it is: items, token
 * count, truncation, omissions. A pure budget-enforcement function has no business
 * minting an event id, so delivery identity is added HERE, where the Gateway --
 * the layer that actually creates the ContextEvent -- can supply it.
 *
 * `contextId` is null only when telemetry recording failed. That is honest and
 * distinguishable: the agent still got its context, and it knows the delivery was
 * not recorded, so feedback about it cannot be correlated.
 */
export type ContextDelivery = ContextPack & {
  contextId: string | null;
};

export interface GetContextRequest {
  task: string;
  scope: ScopeRef;
  budget: TokenBudget;
  agentCapabilities?: string[];
  taskId?: string;
}

export interface RecallRequest {
  scope: ScopeRef;
  id?: string;
  type?: MemoryType;
  tags?: string[];
  status?: MemoryStatus;
  limit?: number;
}

export interface SearchRequest {
  text: string;
  scope: ScopeRef;
  limit?: number;
  filters?: { type?: MemoryType; domain?: string; tags?: string[] };
}

export interface ForgetRequest {
  id: string;
  scope: ScopeRef;
}

export type RememberRequest = MemoryCreateInput;
export interface UpdateRequest {
  input: MemoryUpdateInput;
  scope: ScopeRef;
}

export type FeedbackRequest = Omit<FeedbackEvent, "id" | "timestamp">;
export type RecordOutcomeRequest = Omit<OutcomeEvent, "id" | "timestamp">;

export interface StatusResult {
  ok: true;
  vectorSearchAvailable: boolean;
}

export interface ProjectRequest {
  projectId: string;
}

export interface ProjectInfo {
  projectId: string;
  memoryCount: number;
}
