import type { AIAgentSession } from "./agent-session.js";
import type { AIUserMapEvent } from "./session-events.js";
import { listAISessionTools, type AISessionToolDescription, type ListAISessionToolsOptions } from "./session-tools.js";
import type { AIEngineEvent, AIResult } from "./types.js";

/** Minimal AG-UI event shapes Orihon emits for tool runs and state sync. */
export type AIAGUIEvent =
  | { type: "RUN_STARTED"; runId: string; timestamp: number }
  | { type: "RUN_FINISHED"; runId: string; timestamp: number }
  | { type: "RUN_ERROR"; runId: string; message: string; timestamp: number }
  | { type: "TOOL_CALL_START"; runId: string; toolCallId: string; toolName: string; timestamp: number }
  | { type: "TOOL_CALL_ARGS"; runId: string; toolCallId: string; delta: string; timestamp: number }
  | { type: "TOOL_CALL_END"; runId: string; toolCallId: string; timestamp: number }
  | { type: "TOOL_CALL_RESULT"; runId: string; toolCallId: string; result: unknown; timestamp: number }
  | { type: "STATE_SNAPSHOT"; snapshot: unknown; timestamp: number }
  | { type: "STATE_DELTA"; delta: unknown; timestamp: number }
  | { type: "CUSTOM"; name: string; value: unknown; timestamp: number };

export interface AIAGUIAdapterOptions extends ListAISessionToolsOptions {}

export interface AIAGUIAdapter {
  /** Tools derived from the same capability descriptions as HTTP / WebMCP. */
  listTools(): AISessionToolDescription[];
  /** Snapshot suitable for STATE_SNAPSHOT (context + engine revision). */
  getStateSnapshot(): unknown;
  /** Run one tool through {@link AIAgentSession.call} and yield AG-UI events. */
  runTool(input: {
    runId?: string;
    toolCallId?: string;
    name: string;
    args?: unknown;
    signal?: AbortSignal;
  }): AsyncGenerator<AIAGUIEvent, AIResult, void>;
  /** Forward engine + browser user events as STATE_DELTA / CUSTOM. */
  subscribe(listener: (event: AIAGUIEvent) => void): () => void;
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Thin AG-UI-oriented adapter over an {@link AIAgentSession}.
 * Hosts stream the yielded events over SSE/HTTP; Orihon does not own transport.
 */
export function createAIAGUIAdapter(
  session: AIAgentSession,
  options: AIAGUIAdapterOptions = {}
): AIAGUIAdapter {
  return {
    listTools() {
      return listAISessionTools(session, options);
    },
    getStateSnapshot() {
      return {
        context: session.getContext(),
        snapshot: session.engine.getSnapshot()
      };
    },
    async *runTool(input) {
      const runId = input.runId ?? id("run");
      const toolCallId = input.toolCallId ?? id("tool");
      const started = Date.now();
      yield { type: "RUN_STARTED", runId, timestamp: started };
      yield { type: "TOOL_CALL_START", runId, toolCallId, toolName: input.name, timestamp: started };
      const argsText = JSON.stringify(input.args ?? {});
      yield { type: "TOOL_CALL_ARGS", runId, toolCallId, delta: argsText, timestamp: Date.now() };
      const result = await session.call(input.name, input.args, { signal: input.signal });
      yield { type: "TOOL_CALL_END", runId, toolCallId, timestamp: Date.now() };
      if (!result.ok) {
        yield {
          type: "RUN_ERROR",
          runId,
          message: `${result.error.code}: ${result.error.message}`,
          timestamp: Date.now()
        };
        return result;
      }
      yield { type: "TOOL_CALL_RESULT", runId, toolCallId, result: result.value, timestamp: Date.now() };
      yield {
        type: "STATE_SNAPSHOT",
        snapshot: {
          context: session.getContext(),
          snapshot: session.engine.getSnapshot()
        },
        timestamp: Date.now()
      };
      yield { type: "RUN_FINISHED", runId, timestamp: Date.now() };
      return result;
    },
    subscribe(listener) {
      const onEngine = (event: AIEngineEvent): void => {
        listener({ type: "STATE_DELTA", delta: { source: "engine", event }, timestamp: Date.now() });
      };
      const onUser = (event: AIUserMapEvent): void => {
        listener({ type: "CUSTOM", name: "orihon.user", value: event, timestamp: Date.now() });
        listener({
          type: "STATE_DELTA",
          delta: { source: "user", local: session.local, event },
          timestamp: Date.now()
        });
      };
      const stopEngine = session.engine.subscribe(onEngine);
      const stopUser = session.subscribeUser(onUser);
      listener({
        type: "STATE_SNAPSHOT",
        snapshot: {
          context: session.getContext(),
          snapshot: session.engine.getSnapshot()
        },
        timestamp: Date.now()
      });
      return () => {
        stopEngine();
        stopUser();
      };
    }
  };
}
