import { z } from "zod";
import { ScopeRefSchema, MemoryCreateInputSchema, MemoryUpdateInputSchema, FeedbackEventSchema, OutcomeEventSchema, MEMORY_TYPES } from "@brain/contracts";

// Raw Zod shapes (Record<string, ZodType>, not a wrapped z.object) -- the format
// McpServer.registerTool's inputSchema expects. Reused directly from
// @brain/contracts via .shape/.omit(...).shape where a tool's input maps 1:1 onto
// an existing contract type (brain_remember, brain_feedback,
// brain_record_outcome); defined fresh, small, where it doesn't (the others) --
// this task's Step 4/11: "use the exact tool surface... do not invent additional
// MCP functionality," not "force every tool to share one schema shape."

export const getContextShape = {
  task: z.string().min(1),
  scope: ScopeRefSchema,
  maxTokens: z.number().int().positive(),
  agentCapabilities: z.array(z.string().min(1)).optional(),
  taskId: z.string().min(1).optional(),
};

export const recallShape = {
  scope: ScopeRefSchema,
  id: z.string().uuid().optional(),
  type: z.enum(MEMORY_TYPES).optional(),
  tags: z.array(z.string().min(1)).optional(),
  status: z.enum(["active", "archived"]).optional(),
  limit: z.number().int().positive().optional(),
};

export const searchShape = {
  text: z.string().min(1),
  scope: ScopeRefSchema,
  limit: z.number().int().positive().optional(),
};

export const rememberShape = MemoryCreateInputSchema.shape;

export const updateShape = {
  ...MemoryUpdateInputSchema.shape,
  scope: ScopeRefSchema,
};

export const forgetShape = {
  id: z.string().uuid(),
  scope: ScopeRefSchema,
};

export const feedbackShape = FeedbackEventSchema.omit({ id: true, timestamp: true }).shape;

export const recordOutcomeShape = OutcomeEventSchema.omit({ id: true, timestamp: true }).shape;

export const statusShape = {};

export const projectShape = {
  projectId: z.string().min(1),
};
