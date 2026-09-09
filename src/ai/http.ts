import type { AIActor, AIAgentSession, AISessionCapabilityGroup } from "./agent-session.js";
import { createAIAgentSession } from "./agent-session.js";
import type { AICommandEngine } from "./engine.js";
import { AIError, toAIError } from "./errors.js";
import type { AIPlaceSearchSuccess } from "./place-search.js";
import type { AIAgentRuntime } from "./runtime.js";
import { createAIAgentRuntime } from "./runtime.js";
import type { AIAgentSessionRegistry } from "./session-registry.js";
import type { AIEngineExecuteOptions, AIIntentCommitSuccess, AIResult } from "./types.js";

export interface AIHTTPPlaceSearch {
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<AIResult<AIPlaceSearchSuccess>>;
}

export interface AIHTTPCreateSessionInput {
  id: string;
  actor?: AIActor;
  capabilities?: readonly AISessionCapabilityGroup[];
}

export interface AIHTTPHandlerOptions {
  /** Per-SSE-client byte budget. Overflow ends with resync_required; fetch a snapshot before reconnecting. Default 1 MiB. */
  maxEventQueueBytes?: number;
  /** Endpoint prefix. Default: /api/orihon */
  basePath?: string;
  /** Reuse a host-configured semantic runtime/capability registry. */
  runtime?: AIAgentRuntime;
  /** Intent HTTP responses. Default compact (no echoed point payloads). */
  intentResultMode?: "compact" | "full";
  /**
   * Place search used by POST /places. External agents call this instead of
   * importing Nominatim. Optional: without it the endpoint returns 503.
   */
  placeSearch?: AIHTTPPlaceSearch;
  /**
   * Optional in-memory session registry. Enables POST /sessions and
   * session-scoped context / capabilities / intents / SSE.
   */
  sessions?: AIAgentSessionRegistry;
  /**
   * Factory for POST /sessions. Defaults to createAIAgentSession bound to the
   * handler engine/runtime. Hosts may wrap this for actor defaults or stores.
   */
  createSession?: (input: AIHTTPCreateSessionInput) => AIAgentSession;
}

export type AIHTTPHandler = (request: Request) => Promise<Response>;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function statusForError(code: string | undefined): number {
  if (code === "REVISION_CONFLICT") return 409;
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;
  return 400;
}

function compactIntentResult(result: AIResult<{
  plan: { goal: AIIntentCommitSuccess["goal"] };
  revision: number;
  resources: AIIntentCommitSuccess["resources"];
  context: AIIntentCommitSuccess["context"];
}>): AIResult<AIIntentCommitSuccess> {
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      goal: result.value.plan.goal,
      revision: result.value.revision,
      resources: result.value.resources,
      context: result.value.context
    }
  };
}

function parseSessionPath(pathname: string, basePath: string): { sessionId: string; rest: string } | undefined {
  const prefix = `${basePath}/sessions/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const remainder = pathname.slice(prefix.length);
  const slash = remainder.indexOf("/");
  if (slash === -1) {
    return remainder ? { sessionId: decodeURIComponent(remainder), rest: "" } : undefined;
  }
  const sessionId = decodeURIComponent(remainder.slice(0, slash));
  if (!sessionId) return undefined;
  return { sessionId, rest: remainder.slice(slash + 1) };
}

function readSessionIdFromUrl(url: URL): string | undefined {
  const value = url.searchParams.get("sessionId");
  return value && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Standards-based HTTP adapter for Fetch-compatible servers and edge runtimes.
 * Host applications remain responsible for authentication, authorization, rate
 * limits, persistence and choosing the map/tenant-specific engine instance.
 */
export function createAIHTTPHandler(engine: AICommandEngine, options: AIHTTPHandlerOptions = {}): AIHTTPHandler {
  const maxEventQueueBytes = options.maxEventQueueBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxEventQueueBytes) || maxEventQueueBytes < 1024) throw new RangeError("maxEventQueueBytes must be an integer >= 1024");
  if (!engine || typeof engine.execute !== "function") throw new TypeError("createAIHTTPHandler(engine) requires an AICommandEngine");
  const basePath = (options.basePath ?? "/api/orihon").replace(/\/$/, "");
  const runtime = options.runtime ?? createAIAgentRuntime(engine);
  const defaultIntentMode = options.intentResultMode ?? "compact";
  const placeSearch = options.placeSearch;
  const sessions = options.sessions;
  const createSession = options.createSession ?? ((input: AIHTTPCreateSessionInput) => createAIAgentSession({
    id: input.id,
    actor: input.actor,
    capabilities: input.capabilities,
    engine,
    runtime
  }));
  const encoder = new TextEncoder();

  function sessionOrError(id: string | undefined): AIAgentSession | Response {
    if (!sessions) {
      return jsonResponse({
        ok: false,
        error: { code: "NOT_FOUND", path: "$sessions", message: "Session registry is not configured on this HTTP adapter" }
      }, 503);
    }
    try {
      return sessions.require(id);
    } catch (error) {
      const ai = toAIError(error).toJSON();
      return jsonResponse({ ok: false, error: ai }, statusForError(ai.code));
    }
  }

  function capabilitiesPayload(session?: AIAgentSession) {
    return {
      version: 1,
      capabilities: session ? session.describeCapabilities() : runtime.describeCapabilities(),
      interfaces: {
        http: {
          places: { method: "POST", path: `${basePath}/places` },
          intents: { method: "POST", path: `${basePath}/intents` },
          ...(sessions ? {
            sessions: { method: "POST", path: `${basePath}/sessions` },
            sessionContext: { method: "GET", path: `${basePath}/sessions/:id` },
            sessionLocal: { method: "POST", path: `${basePath}/sessions/:id/local` },
            sessionEvents: { method: "GET", path: `${basePath}/sessions/:id/events` }
          } : {})
        },
        llmTools: ["orihon_search_places", "orihon_plan"],
        placeSearch: Boolean(placeSearch),
        sessions: Boolean(sessions)
      },
      ...(session ? { session: { id: session.id, actor: session.actor } } : {})
    };
  }

  function eventsResponse(request: Request, session?: AIAgentSession): Response {
    // A session may own a different engine than the handler (per-tenant createSession).
    // Streaming the handler engine there would hand the client events from another map,
    // permanently out of step with GET /sessions/:id/snapshot.
    const source = session?.engine ?? engine;
    let unsubscribe: (() => void) | undefined;
    let close: (() => void) | undefined;
    const abort = (): void => close?.();
    const cleanup = (): void => {
      unsubscribe?.(); unsubscribe = undefined;
      request.signal.removeEventListener("abort", abort);
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        close = () => { if (closed) return; closed = true; cleanup(); controller.close(); };
        if (request.signal.aborted) { close(); return; }
        const ready = {
          revision: source.revision,
          ...(session ? { sessionId: session.id, actor: session.actor } : {})
        };
        controller.enqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify(ready)}\n\n`));
        unsubscribe = source.subscribe((event) => {
          if (closed) return;
          const data = encoder.encode(`id: ${event.revision}\nevent: command\ndata: ${JSON.stringify(event)}\n\n`);
          if (data.byteLength > (controller.desiredSize ?? 0)) {
            controller.enqueue(encoder.encode(`event: resync_required\ndata: {"revision":${source.revision},"reason":"slow_consumer"}\n\n`));
            close?.();
            return;
          }
          controller.enqueue(data);
        });
        request.signal.addEventListener("abort", abort, { once: true });
      },
      cancel() {
        close = undefined;
        cleanup();
      }
    }, { highWaterMark: maxEventQueueBytes, size: chunk => chunk.byteLength });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive"
      }
    });
  }

  async function handleIntent(
    request: Request,
    pathname: string,
    session: AIAgentSession | undefined
  ): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: { code: "NOT_JSON", path: "$", message: "Request body must be valid JSON" } }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ ok: false, error: { code: "INVALID_TYPE", path: "$", message: "Expected {intent, baseRevision?, resultMode?, sessionId?}" } }, 400);
    }
    const envelope = body as Record<string, unknown>;
    for (const key of Object.keys(envelope)) {
      if (key !== "intent" && key !== "baseRevision" && key !== "resultMode" && key !== "sessionId") {
        return jsonResponse({ ok: false, error: { code: "UNKNOWN_PROPERTY", path: `$.${key}`, message: `Unknown property "${key}"` } }, 400);
      }
    }
    if (!("intent" in envelope)) {
      return jsonResponse({ ok: false, error: { code: "REQUIRED_PROPERTY", path: "$.intent", message: "Required property \"intent\" is missing" } }, 400);
    }
    if (envelope.baseRevision !== undefined && typeof envelope.baseRevision !== "number") {
      return jsonResponse({ ok: false, error: { code: "INVALID_TYPE", path: "$.baseRevision", message: "Expected a number" } }, 400);
    }
    let active = session;
    if (!active && typeof envelope.sessionId === "string") {
      const resolved = sessionOrError(envelope.sessionId);
      if (resolved instanceof Response) return resolved;
      active = resolved;
    } else if (!active && envelope.sessionId !== undefined) {
      return jsonResponse({ ok: false, error: { code: "INVALID_TYPE", path: "$.sessionId", message: "Expected a string" } }, 400);
    }
    if (envelope.resultMode !== undefined && envelope.resultMode !== "full" && envelope.resultMode !== "compact") {
      return jsonResponse({ ok: false, error: { code: "INVALID_VALUE", path: "$.resultMode", message: "Expected compact or full", received: envelope.resultMode } }, 400);
    }
    const resultMode = envelope.resultMode ?? defaultIntentMode;
    const executeOptions: AIEngineExecuteOptions = {
      ...(typeof envelope.baseRevision === "number" ? { baseRevision: envelope.baseRevision } : {})
    };
    const planned = active
      ? active.plan(envelope.intent, executeOptions)
      : runtime.plan(envelope.intent, executeOptions);
    const result = !planned.ok
      ? planned
      : pathname.endsWith("/preview")
        ? (active ? active.preview(planned.value) : runtime.preview(planned.value))
        : (active ? active.commit(planned.value) : runtime.commit(planned.value));
    if (!result.ok) {
      return jsonResponse(result, statusForError(result.error.code));
    }
    if (resultMode === "full") {
      return jsonResponse(result, 200);
    }
    if (pathname.endsWith("/preview")) {
      return jsonResponse({
        ok: true,
        value: {
          goal: result.value.plan.goal,
          revision: result.value.revision,
          resources: result.value.resources,
          context: result.value.context,
          plan: result.value.plan,
          ...(active ? { sessionId: active.id } : {})
        }
      }, 200);
    }
    const compact = compactIntentResult(result);
    if (compact.ok && active) {
      return jsonResponse({
        ok: true,
        value: { ...compact.value, sessionId: active.id }
      }, 200);
    }
    return jsonResponse(compact, 200);
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const querySessionId = readSessionIdFromUrl(url);

    if (request.method === "POST" && pathname === `${basePath}/sessions`) {
      if (!sessions) {
        return jsonResponse({
          ok: false,
          error: { code: "NOT_FOUND", path: "$sessions", message: "Session registry is not configured on this HTTP adapter" }
        }, 503);
      }
      let body: unknown;
      try { body = await request.json(); }
      catch { return jsonResponse({ ok: false, error: { code: "NOT_JSON", path: "$", message: "Request body must be valid JSON" } }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse({ ok: false, error: { code: "INVALID_TYPE", path: "$", message: "Expected {id?, actor?, capabilities?}" } }, 400);
      }
      const envelope = body as Record<string, unknown>;
      for (const key of Object.keys(envelope)) {
        if (key !== "id" && key !== "actor" && key !== "capabilities") {
          return jsonResponse({ ok: false, error: { code: "UNKNOWN_PROPERTY", path: `$.${key}`, message: `Unknown property "${key}"` } }, 400);
        }
      }
      const id = typeof envelope.id === "string" && envelope.id.trim() !== ""
        ? envelope.id.trim()
        : `map:${crypto.randomUUID()}`;
      try {
        if (sessions.has(id)) {
          return jsonResponse({
            ok: false,
            error: { code: "DUPLICATE_ID", path: "$.id", message: `Session "${id}" already exists`, received: id }
          }, 409);
        }
        const session = createSession({
          id,
          actor: envelope.actor && typeof envelope.actor === "object" && !Array.isArray(envelope.actor)
            ? envelope.actor as AIActor
            : undefined,
          capabilities: Array.isArray(envelope.capabilities)
            ? envelope.capabilities as AISessionCapabilityGroup[]
            : undefined
        });
        if (session.id !== id) {
          throw new AIError("INVALID_VALUE", "$.id", "createSession must preserve the requested session id", session.id);
        }
        sessions.register(session);
        return jsonResponse({ ok: true, value: session.getContext() }, 201);
      } catch (error) {
        const ai = toAIError(error).toJSON();
        return jsonResponse({ ok: false, error: ai }, statusForError(ai.code));
      }
    }

    const sessionPath = parseSessionPath(pathname, basePath);
    if (sessionPath) {
      const resolved = sessionOrError(sessionPath.sessionId);
      if (resolved instanceof Response) return resolved;
      const session = resolved;
      const rest = sessionPath.rest;
      if (request.method === "GET" && (rest === "" || rest === "context")) {
        return jsonResponse(session.getContext());
      }
      if (request.method === "GET" && rest === "capabilities") {
        return jsonResponse(capabilitiesPayload(session));
      }
      if (request.method === "GET" && rest === "snapshot") {
        return jsonResponse(session.engine.getSnapshot());
      }
      if (request.method === "GET" && rest === "events") {
        return eventsResponse(request, session);
      }
      if (request.method === "POST" && (rest === "intents" || rest === "intents/preview")) {
        return handleIntent(request, `${basePath}/${rest}`, session);
      }
      if (request.method === "POST" && rest === "local") {
        let body: unknown;
        try { body = await request.json(); }
        catch { return jsonResponse({ ok: false, error: { code: "NOT_JSON", path: "$", message: "Request body must be valid JSON" } }, 400); }
        try {
          const local = session.patchLocal(body as Record<string, unknown>);
          return jsonResponse({ ok: true, value: { sessionId: session.id, local } });
        } catch (error) {
          const ai = toAIError(error).toJSON();
          return jsonResponse({ ok: false, error: ai }, statusForError(ai.code));
        }
      }
      if (request.method === "DELETE" && rest === "") {
        sessions!.unregister(session.id);
        return jsonResponse({ ok: true, value: { id: session.id } });
      }
      return jsonResponse({ ok: false, error: { code: "NOT_FOUND", path: "$request.url", message: "Orihon AI session endpoint not found" } }, 404);
    }

    let querySession: AIAgentSession | undefined;
    if (querySessionId) {
      // Never fall through to unscoped state: a client that asked for a session and
      // silently got the global engine would believe its allowlist was applied.
      const resolved = sessionOrError(querySessionId);
      if (resolved instanceof Response) return resolved;
      querySession = resolved;
    }

    if (request.method === "GET" && pathname === `${basePath}/capabilities`) {
      return jsonResponse(capabilitiesPayload(querySession));
    }
    if (request.method === "GET" && pathname === `${basePath}/context`) {
      return jsonResponse(querySession ? querySession.getContext() : runtime.getContext());
    }
    if (request.method === "GET" && pathname === `${basePath}/snapshot`) {
      return jsonResponse(engine.getSnapshot());
    }
    if (request.method === "POST" && pathname === `${basePath}/places`) {
      if (!placeSearch) {
        return jsonResponse({
          ok: false,
          error: {
            code: "NOT_FOUND",
            path: "$placeSearch",
            message: "Place search is not configured on this HTTP adapter. Pass placeSearch to createAIHTTPHandler."
          }
        }, 503);
      }
      let body: unknown;
      try { body = await request.json(); }
      catch { return jsonResponse({ ok: false, error: { code: "NOT_JSON", path: "$", message: "Request body must be valid JSON" } }, 400); }
      const result = await placeSearch.execute(body, { signal: request.signal });
      return jsonResponse(result, result.ok ? 200 : statusForError(result.error.code));
    }
    if (request.method === "POST" && pathname === `${basePath}/commands`) {
      let body: unknown;
      try { body = await request.json(); }
      catch { return jsonResponse({ ok: false, error: { code: "NOT_JSON", path: "$", message: "Request body must be valid JSON" } }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse({ ok: false, error: { code: "INVALID_TYPE", path: "$", message: "Expected {command, baseRevision?}" } }, 400);
      }
      const envelope = body as Record<string, unknown>;
      for (const key of Object.keys(envelope)) {
        if (key !== "command" && key !== "baseRevision") {
          return jsonResponse({ ok: false, error: { code: "UNKNOWN_PROPERTY", path: `$.${key}`, message: `Unknown property "${key}"` } }, 400);
        }
      }
      if (!("command" in envelope)) {
        return jsonResponse({ ok: false, error: { code: "REQUIRED_PROPERTY", path: "$.command", message: "Required property \"command\" is missing" } }, 400);
      }
      const executeOptions: AIEngineExecuteOptions = {};
      if (envelope.baseRevision !== undefined) {
        if (typeof envelope.baseRevision !== "number") {
          return jsonResponse({ ok: false, error: { code: "INVALID_TYPE", path: "$.baseRevision", message: "Expected a number" } }, 400);
        }
        executeOptions.baseRevision = envelope.baseRevision;
      }
      const result = engine.execute(envelope.command, executeOptions);
      return jsonResponse(result, result.ok ? 200 : statusForError(result.error.code));
    }
    if (request.method === "POST" && (pathname === `${basePath}/intents` || pathname === `${basePath}/intents/preview`)) {
      return handleIntent(request, pathname, querySession);
    }
    if (request.method === "GET" && pathname === `${basePath}/events`) {
      return eventsResponse(request, querySession);
    }
    return jsonResponse({ ok: false, error: { code: "NOT_FOUND", path: "$request.url", message: "Orihon AI endpoint not found" } }, 404);
  };
}
