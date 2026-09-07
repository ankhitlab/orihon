import type { AIAgentSession } from "./agent-session.js";
import type { AIJSONSchema } from "./schema.js";
import { AI_INTENT_SCHEMA } from "./semantic-tool.js";

/** Unified tool description shared by WebMCP and AG-UI adapters. */
export interface AISessionToolDescription {
  name: string;
  description: string;
  inputSchema?: AIJSONSchema;
  /** `server` = semantic/engine; `browser` = live map bridge. */
  source: "server" | "browser";
  group?: string;
}

export interface ListAISessionToolsOptions {
  /** Include `orihon.plan` when the session has server capabilities. Default true. */
  includeServer?: boolean;
  /** Include `map.*` browser bridge tools. Default true. */
  includeBrowser?: boolean;
}

/**
 * Same capability surface HTTP already advertises, flattened to callables
 * that {@link AIAgentSession.call} understands.
 */
export function listAISessionTools(
  session: AIAgentSession,
  options: ListAISessionToolsOptions = {}
): AISessionToolDescription[] {
  const includeServer = options.includeServer !== false;
  const includeBrowser = options.includeBrowser !== false;
  const tools: AISessionToolDescription[] = [];

  if (includeServer && session.describeCapabilities().length > 0) {
    const models = session.describeCapabilities().map(({ id }) => id).join(", ");
    tools.push({
      name: "orihon.plan",
      description:
        `Commit one Orihon semantic map intent (show_places, create_visit_route, update_points, …) ` +
        `through the session capability registry (${models}).`,
      inputSchema: AI_INTENT_SCHEMA as AIJSONSchema,
      source: "server"
    });
  }

  if (includeBrowser) {
    const bridge = session.connect();
    for (const tool of bridge.list()) {
      tools.push({
        name: tool.name,
        description: tool.description ?? `Browser map tool ${tool.name}`,
        ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
        source: "browser",
        group: tool.group
      });
    }
  }

  return tools;
}
