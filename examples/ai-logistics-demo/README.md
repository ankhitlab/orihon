# Orihon logistics vertical demo

Closed-loop agent-native map story for dispatch:

1. Load late deliveries (`show_places`)
2. Highlight critical stops (`update_points` → `category: "alert"`)
3. Propose order (`create_visit_route` with `reactive: true`)
4. Dispatcher drags or selects a stop → browser event → AI **immediately adds**
   a reaction marker in `ai-notes` (and a “было” ghost on drag) → `objects.update`
   → engine replans

No LLM key required. Uses the same demo server as `examples/ai-agent-demo`.

```powershell
npm run demo:ai
```

Open <http://127.0.0.1:4193/examples/ai-logistics-demo/> and press **Запустить цикл**, then drag a red stop.

Session id: `map:ai-logistics-demo` (separate from the playground session).
