import type { Orihon } from "../map.js";
import type { AIAgentRuntime } from "./runtime.js";
import {
  AIAgentSession,
  createAIAgentSession,
  type AIActor,
  type AILocalMapState,
  type AISessionCapabilityGroup
} from "./agent-session.js";
import { createAICommandEngineFromSnapshot } from "./engine.js";
import { clone } from "./json.js";
import { AIError, toAIError } from "./errors.js";
import type { AIMapProjection } from "./projection.js";
import type { AIEngineSnapshot, AIResult } from "./types.js";

/** Serializable session bag — auth/DB stay outside Orihon. */
export interface AISessionRecord {
  version: 1;
  id: string;
  actor: AIActor;
  /**
   * Explicit capability allowlist. Absent means the session was created without one
   * and every registered capability stays reachable after a restore — a saved list
   * would silently lock out host-registered capabilities.
   */
  capabilities?: AISessionCapabilityGroup[];
  local: AILocalMapState;
  snapshot: AIEngineSnapshot;
  savedAt: number;
}

export interface AISessionStore {
  save(session: AIAgentSession): AISessionRecord | Promise<AISessionRecord>;
  load(id: string): AISessionRecord | undefined | Promise<AISessionRecord | undefined>;
  delete?(id: string): void | Promise<void>;
  list?(): string[] | Promise<string[]>;
}

export interface RestoreAIAgentSessionOptions {
  map?: Orihon;
  projection?: AIMapProjection;
  runtime?: AIAgentRuntime;
  /** Override capabilities from the record. */
  capabilities?: readonly AISessionCapabilityGroup[];
}

/** Capture engine snapshot + local UI state for host persistence. */
export function createAISessionRecord(session: AIAgentSession): AISessionRecord {
  const capabilities = session.capabilityGroups;
  return {
    version: 1,
    id: session.id,
    actor: { ...session.actor },
    ...(capabilities ? { capabilities } : {}),
    local: clone(session.local) as AILocalMapState,
    snapshot: session.engine.getSnapshot(),
    savedAt: Date.now()
  };
}

/** Rebuild an agent session from a stored record (map/projection optional). */
export function restoreAIAgentSession(
  record: AISessionRecord,
  options: RestoreAIAgentSessionOptions = {}
): AIAgentSession {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new AIError("INVALID_TYPE", "$record", "Expected an AISessionRecord", record);
  }
  if (record.version !== 1) {
    throw new AIError("INVALID_VALUE", "$record.version", "Expected record version 1", record.version);
  }
  if (typeof record.id !== "string" || record.id.trim() === "") {
    throw new AIError("INVALID_TYPE", "$record.id", "Expected a non-empty session id", record.id);
  }
  const engine = createAICommandEngineFromSnapshot(record.snapshot);
  const session = createAIAgentSession({
    id: record.id,
    actor: record.actor ?? {},
    engine,
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(options.capabilities !== undefined
      ? { capabilities: options.capabilities }
      : record.capabilities !== undefined
        ? { capabilities: record.capabilities }
        : {}),
    ...(options.map ? { map: options.map } : {}),
    ...(options.projection ? { projection: options.projection } : {})
  });
  if (record.local && typeof record.local === "object") {
    session.patchLocal(record.local);
  }
  return session;
}

export function saveAIAgentSession(
  store: AISessionStore,
  session: AIAgentSession
): AISessionRecord | Promise<AISessionRecord> {
  return store.save(session);
}

export async function loadAIAgentSession(
  store: AISessionStore,
  id: string,
  options: RestoreAIAgentSessionOptions = {}
): Promise<AIAgentSession | undefined> {
  const record = await store.load(id);
  if (!record) return undefined;
  return restoreAIAgentSession(record, options);
}

/** In-memory store for tests and single-process hosts. */
export function createMemoryAISessionStore(): AISessionStore & {
  readonly size: number;
  clear(): void;
} {
  const records = new Map<string, AISessionRecord>();
  return {
    get size() { return records.size; },
    clear() { records.clear(); },
    save(session) {
      const record = createAISessionRecord(session);
      records.set(record.id, record);
      return record;
    },
    load(id) {
      return records.get(id);
    },
    delete(id) {
      records.delete(id);
    },
    list() {
      return [...records.keys()];
    }
  };
}

export function tryCreateAISessionRecord(session: AIAgentSession): AIResult<AISessionRecord> {
  try {
    return { ok: true, value: createAISessionRecord(session) };
  } catch (error) {
    return { ok: false, error: toAIError(error).toJSON() };
  }
}

export function tryRestoreAIAgentSession(
  record: unknown,
  options: RestoreAIAgentSessionOptions = {}
): AIResult<AIAgentSession> {
  try {
    return { ok: true, value: restoreAIAgentSession(record as AISessionRecord, options) };
  } catch (error) {
    return { ok: false, error: toAIError(error).toJSON() };
  }
}

