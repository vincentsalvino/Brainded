#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Gateway, BrainError, internalError } from "@brain/gateway";
import {
  getContextShape,
  recallShape,
  searchShape,
  rememberShape,
  updateShape,
  forgetShape,
  feedbackShape,
  recordOutcomeShape,
  statusShape,
  projectShape,
} from "./schemas.js";

/**
 * The SDK parses each optional shape field as `T | undefined` (key always
 * present); Gateway's request types use `key?: T` (key must be absent, not
 * present-as-undefined) under this project's `exactOptionalPropertyTypes`
 * strictness. Both are correct in their own layer -- this bridges them, rather
 * than loosening either type.
 */
type UndefinedToOptional<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

function omitUndefined<T extends Record<string, unknown>>(obj: T): UndefinedToOptional<T> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result as UndefinedToOptional<T>;
}

/**
 * The MCP adapter. Every handler follows exactly one shape (this task's Step 3 /
 * PHASE_1_SPEC.md MCP Boundary): the SDK has already validated input against the
 * schema in schemas.ts by the time a handler runs; the handler calls exactly one
 * Gateway method; the result is formatted for MCP. No handler branches on which
 * agent is calling (this task's Step 5) -- none of them even receive that
 * information, because Gateway's API has no such parameter to pass.
 *
 * Errors are reported via CallToolResult.isError (MCP's own documented
 * convention for tool-level failures, as opposed to protocol-level errors) --
 * never a bare "something went wrong" string; the BrainError's `code` and
 * `message` both survive onto the wire (this task's Step 10).
 */
export function registerBrainTools(server: McpServer, gateway: Gateway): void {
  server.registerTool(
    "brain_context",
    {
      description:
        "Compile a budget-enforced, ranked context pack for a task: retrieval -> ranking -> context compilation -> token optimization. " +
        "When the project has indexed code, relevant source chunks and bounded dependency context are automatically blended into the same budget (see codeItems/dependencyItems on the response) -- no separate call needed. " +
        "Returns a contextId naming this exact delivery -- pass it back to brain_feedback and brain_record_outcome so the Brain can tell which delivery your report refers to. " +
        "Optionally pass taskId to group several deliveries under one logical task.",
      inputSchema: getContextShape,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const pack = await gateway.getContext(
          omitUndefined({
            task: args.task,
            scope: args.scope,
            budget: { maxTokens: args.maxTokens },
            agentCapabilities: args.agentCapabilities,
            taskId: args.taskId,
          }),
        );
        return ok(pack);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "brain_recall",
    { description: "Direct memory lookup by id, or by filter -- no ranking, no context compilation.", inputSchema: recallShape },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await gateway.recall(omitUndefined(args));
        return ok(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "brain_search",
    { description: "Ranked candidate search -- no token budget, no context compilation.", inputSchema: searchShape },
    async (args): Promise<CallToolResult> => {
      try {
        const results = await gateway.search(omitUndefined(args));
        return ok({ results });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "brain_remember",
    { description: "Create a new memory.", inputSchema: rememberShape },
    async (args): Promise<CallToolResult> => {
      try {
        const record = await gateway.remember(args);
        return ok(record);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "brain_update",
    { description: "Update an existing memory's content/domain/tags/confidence, or archive it via status.", inputSchema: updateShape },
    async (args): Promise<CallToolResult> => {
      try {
        const { scope, ...input } = args;
        const record = await gateway.update({ input, scope });
        return ok(record);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "brain_forget",
    { description: "Archive (soft delete) a memory. Never a hard purge.", inputSchema: forgetShape },
    async (args): Promise<CallToolResult> => {
      try {
        const record = await gateway.forget(args);
        return ok(record);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "brain_feedback",
    {
      description:
        "Report whether a specific memory was useful. Pass the contextId returned by brain_context to attribute this to that exact delivery; " +
        "pass reason (redundant | irrelevant | incorrect | other) to say why -- 'redundant' means the memory was fine but duplicated another, which is not the same as wrong.",
      inputSchema: feedbackShape,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const event = await gateway.feedback(args);
        return ok(event);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "brain_record_outcome",
    {
      description:
        "Report the outcome of a task. Pass the contextId returned by brain_context to attribute the outcome to that exact delivery.",
      inputSchema: recordOutcomeShape,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const event = await gateway.recordOutcome(args);
        return ok(event);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "brain_status",
    { description: "Brain health and capability status.", inputSchema: statusShape },
    async (): Promise<CallToolResult> => {
      try {
        const status = await gateway.status();
        return ok(status);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "brain_project",
    { description: "Confirm a project scope and report its memory count.", inputSchema: projectShape },
    async (args): Promise<CallToolResult> => {
      try {
        const info = await gateway.project(args);
        return ok(info);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: (typeof data === "object" && data !== null ? (data as Record<string, unknown>) : { value: data }),
  };
}

function toolError(error: unknown): CallToolResult {
  const brainError = error instanceof BrainError ? error : internalError("unexpected error", error);
  return {
    content: [{ type: "text", text: JSON.stringify({ code: brainError.code, message: brainError.message }) }],
    isError: true,
  };
}

/** Standalone entry point: `node dist/server.js <db-path>`. Not invoked by tests, which construct their own McpServer + in-memory Brain directly. */
export async function main(): Promise<void> {
  const { createBrain } = await import("./bootstrap.js");
  const dbPath = process.argv[2] ?? "./brain.db";
  const brain = createBrain(dbPath);

  const server = new McpServer({ name: "ai-brain", version: "0.1.0" });
  registerBrainTools(server, brain.gateway);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  main().catch((error) => {
    console.error("brain-mcp failed to start:", error);
    process.exit(1);
  });
}
