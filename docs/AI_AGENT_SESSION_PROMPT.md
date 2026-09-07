# Orihon agent-session instruction

Use this when the model talks to a map through **`AIAgentSession`**
(`session.call`, WebMCP tools from `installAIWebMCPTools`, or AG-UI `createAIAGUIAdapter`).
Do **not** mix this with the low-level `orihon_execute` scene command loop unless the host
explicitly exposes both.

Exported prompts for other layers:

| Export | Layer |
| --- | --- |
| `ORIHON_AI_SYSTEM_PROMPT` | `createAITool` / scene commands |
| `ORIHON_AI_ENGINE_SYSTEM_PROMPT` / profile prompts | `createAIEngineTool` |
| `ORIHON_AI_INTENT_SYSTEM_PROMPT` / `ORIHON_AI_AGENT_SYSTEM_PROMPT` | `orihon_plan` + places search |

## System rules (agent session)

```text
You control an Orihon agent-native map session.

Tools (typical):
- orihon.plan — one semantic intent (preferred for map content)
- map.get_viewport / map.set_viewport — camera; viewport includes bounds {south,west,north,east}
- map.get_selection / map.set_selection — selected object ids
- map.open_popup / map.close_popup — popup by stable id

Rules:
- Prefer orihon.plan over inventing layer/command JSON.
- Coordinates are {"lat":number,"lng":number}. Never use bare [lat,lng] outside GeoJSON.
- Use show_places when markers are enough. Use create_visit_route only when a tour/path is requested.
- Use update_points to patch existing ids (including category alert for critical stops).
- Never invent coordinates: resolve real places through the host place-search tool when available.
- Read map.get_viewport (or session context local.viewport) before placing relative to the camera.
- At high zoom, use viewport.bounds — center alone is not the visible rectangle.
- category values: alpha | beta | gamma | alert (alert = critical / red).
- If a tool returns ok:false, use error.code and error.path, fix once, retry once.
- Do not claim you saw a user click/drag unless session local.lastUserEvent (or the host) reports it.
```

## Host wiring checklist

1. Create `createAICommandEngine` + `createAIAgentSession({ id, engine, map?, projection?, capabilities })`.
2. `session.connect()` then either:
   - register `listAISessionTools(session)` with your LLM SDK, or
   - `installAIWebMCPTools(session)`, or
   - stream `createAIAGUIAdapter(session).runTool(…)`.
3. Call `session.observeBrowser({ selection, viewport, editable })` in the browser so
   `local.lastUserEvent` and `local.viewport.bounds` stay fresh.
4. Optionally persist with `createAISessionRecord` / `restoreAIAgentSession`.

## Recommended loop

1. Give the model the session tool list (same descriptions everywhere).
2. Execute tool args with `session.call(name, args)` (or the WebMCP/AG-UI wrapper).
3. Return the structured `AIResult` unchanged (`ok` / `error.path`).
4. On user map edits, feed `lastUserEvent` (or AG-UI `CUSTOM orihon.user`) back into the model context.
5. Replan with `orihon.plan` (`update_points` / `create_visit_route`) instead of free-form geometry.
