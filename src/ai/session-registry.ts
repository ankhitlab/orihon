import type { AIAgentSession } from "./agent-session.js";
import { AIError } from "./errors.js";

/**
 * In-memory registry of agent sessions for a host process.
 * Persistence, auth and multi-node sync stay outside Orihon.
 */
export class AIAgentSessionRegistry {
  readonly #sessions = new Map<string, AIAgentSession>();

  get size(): number {
    return this.#sessions.size;
  }

  has(id: string): boolean {
    return this.#sessions.has(id);
  }

  get(id: string): AIAgentSession | undefined {
    return this.#sessions.get(id);
  }

  /** Register or replace a session. Returns the previous session if any. */
  register(session: AIAgentSession): AIAgentSession | undefined {
    if (!session || typeof session.id !== "string") {
      throw new TypeError("register(session) requires an AIAgentSession");
    }
    const previous = this.#sessions.get(session.id);
    this.#sessions.set(session.id, session);
    return previous;
  }

  /** Remove and return the session, or undefined if missing. */
  unregister(id: string): AIAgentSession | undefined {
    const session = this.#sessions.get(id);
    if (session) this.#sessions.delete(id);
    return session;
  }

  list(): AIAgentSession[] {
    return [...this.#sessions.values()];
  }

  /** Resolve a session or throw AIError NOT_FOUND / INVALID_TYPE. */
  require(id: unknown, path = "$sessionId"): AIAgentSession {
    if (typeof id !== "string" || id.trim() === "") {
      throw new AIError("INVALID_TYPE", path, "Expected a non-empty session id", id);
    }
    const key = id.trim();
    const session = this.#sessions.get(key);
    if (!session) throw new AIError("NOT_FOUND", path, `Session "${key}" is not registered`, key);
    return session;
  }
}

export function createAIAgentSessionRegistry(): AIAgentSessionRegistry {
  return new AIAgentSessionRegistry();
}
