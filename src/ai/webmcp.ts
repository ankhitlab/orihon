import type { AIAgentSession } from "./agent-session.js";
import { listAISessionTools, type ListAISessionToolsOptions } from "./session-tools.js";

/** Duck-typed WebMCP modelContext (document.modelContext / navigator.modelContext). */
export interface AIWebMCPModelContext {
  registerTool(
    tool: {
      name: string;
      description?: string;
      inputSchema?: unknown;
      annotations?: {
        readOnlyHint?: boolean;
        consequentialHint?: boolean;
        untrustedContentHint?: boolean;
      };
      execute: (input: unknown, extras?: { signal?: AbortSignal }) => unknown | Promise<unknown>;
    },
    options?: { signal?: AbortSignal; exposedTo?: string[] }
  ): void | Promise<void>;
}

export interface InstallAIWebMCPToolsOptions extends ListAISessionToolsOptions {
  /** Defaults to `document.modelContext` or `navigator.modelContext` when present. */
  modelContext?: AIWebMCPModelContext;
  /** Abort registration (unregister) when aborted. */
  signal?: AbortSignal;
}

export interface AIWebMCPInstallResult {
  tools: string[];
  /** Abort to unregister (when a signal was provided or an internal controller is used). */
  abort: AbortController;
}

function resolveModelContext(explicit?: AIWebMCPModelContext): AIWebMCPModelContext {
  if (explicit) return explicit;
  const doc = (globalThis as { document?: { modelContext?: AIWebMCPModelContext } }).document;
  if (doc?.modelContext && typeof doc.modelContext.registerTool === "function") return doc.modelContext;
  const nav = (globalThis as { navigator?: { modelContext?: AIWebMCPModelContext } }).navigator;
  if (nav?.modelContext && typeof nav.modelContext.registerTool === "function") return nav.modelContext;
  throw new Error(
    "WebMCP modelContext is unavailable. Pass options.modelContext or run in a browser with document.modelContext."
  );
}

/**
 * Register Orihon session tools on a WebMCP modelContext.
 * Uses the same descriptions as {@link listAISessionTools} / HTTP capabilities.
 */
export async function installAIWebMCPTools(
  session: AIAgentSession,
  options: InstallAIWebMCPToolsOptions = {}
): Promise<AIWebMCPInstallResult> {
  const modelContext = resolveModelContext(options.modelContext);
  const abort = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) abort.abort();
    else options.signal.addEventListener("abort", () => abort.abort(), { once: true });
  }
  const tools = listAISessionTools(session, options);
  const names: string[] = [];
  for (const tool of tools) {
    const readOnly = tool.name.startsWith("map.get_") || tool.name === "map.draw_get_mode";
    await modelContext.registerTool(
      {
        name: tool.name,
        description: tool.description,
        ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
        annotations: {
          readOnlyHint: readOnly,
          consequentialHint: tool.name === "orihon.plan",
          untrustedContentHint: false
        },
        execute: async (input, extras) => {
          const result = await session.call(tool.name, input, { signal: extras?.signal ?? abort.signal });
          if (!result.ok) {
            throw new Error(`${result.error.code}: ${result.error.message}`);
          }
          return result.value;
        }
      },
      { signal: abort.signal }
    );
    names.push(tool.name);
  }
  return { tools: names, abort };
}
