export { AIError } from "./ai/errors.js";
export { AICommandEngine, cameraFromPositions, createAICommandEngine, createAICommandEngineFromSnapshot } from "./ai/engine.js";
export { AICapabilityRegistry, createDefaultAICapabilityRegistry } from "./ai/capabilities.js";
export { AIAgentRuntime, compactAIPlan, createAIAgentRuntime, validateAIIntent } from "./ai/runtime.js";
export { AIAgentSession, createAIAgentSession } from "./ai/agent-session.js";
export type {
  AIApplyObjectMoveInput,
  AIObserveBrowserOptions,
  AIUserMapEvent,
  AIUserMapListener
} from "./ai/session-events.js";
export { AIAgentSessionRegistry, createAIAgentSessionRegistry } from "./ai/session-registry.js";
export {
  createAISessionRecord,
  createMemoryAISessionStore,
  loadAIAgentSession,
  restoreAIAgentSession,
  saveAIAgentSession,
  tryCreateAISessionRecord,
  tryRestoreAIAgentSession
} from "./ai/session-store.js";
export { listAISessionTools } from "./ai/session-tools.js";
export { createAIAGUIAdapter } from "./ai/ag-ui.js";
export { installAIWebMCPTools } from "./ai/webmcp.js";
export { AIBrowserBridge, createAIBrowserBridge } from "./ai/browser-bridge.js";
export { createAILLMAgent } from "./ai/agent.js";
export { createOpenAICompatibleAdapter } from "./ai/openai-compatible.js";
export {
  ORIHON_AI_AGENT_SYSTEM_PROMPT,
  createAIPlaceSearchTool,
  createNominatimPlaceSearchProvider,
  executeAIPlaceSearch
} from "./ai/place-search.js";
export {
  AI_INTENT_SCHEMA,
  AI_INTENT_SCHEMA_FULL,
  AI_INTENT_SCHEMA_STRESS,
  AI_INTENT_SCHEMA_VISIT,
  AI_INTENT_SCHEMAS,
  ORIHON_AI_INTENT_SYSTEM_PROMPT,
  createAIIntentTool,
  getAIIntentSchema
} from "./ai/semantic-tool.js";
export { createAIHTTPHandler } from "./ai/http.js";
export { AIMapProjection, createAIMapProjection } from "./ai/projection.js";
export { AISession, applyScene, createAISession } from "./ai/session.js";
export {
  AI_COMMAND_SCHEMA,
  AI_ENGINE_COMMAND_SCHEMA,
  AI_ENGINE_COMMAND_SCHEMAS,
  ORIHON_AI_ENGINE_SYSTEM_PROMPT,
  ORIHON_AI_POINTS_SYSTEM_PROMPT,
  ORIHON_AI_SYSTEM_PROMPT,
  createAIEngineTool,
  createAITool,
  getAIEngineCommandSchema,
  getAIEngineSystemPrompt
} from "./ai/tool.js";
export {
  validateEngineCommand,
  validateObjectCommand,
  validatePointPatches,
  validatePointsReplaceCommand,
  validateRoutePlanCommand
} from "./ai/engine-validation.js";
export { validateCommand, validateLayer, validateLayerDescription, validateScene } from "./ai/validation.js";
export type {
  AIBasemapSpec,
  AIAgentContext,
  AICapabilityDescription,
  AICapabilityOperationDescription,
  AICreateVisitRouteIntent,
  AIShowPlacesIntent,
  AICameraSpec,
  AICommand,
  AICommandSuccess,
  AICollectionCommand,
  AIEngineCommand,
  AIEngineCommandSuccess,
  AIEngineEvent,
  AIEngineExecuteOptions,
  AIEngineSnapshot,
  AIEngineTransactionEvent,
  AIEngineTransactionOptions,
  AIEngineTransactionPreview,
  AIEngineTransactionSuccess,
  AIEngineToolSuccess,
  AIErrorCode,
  AIErrorDetails,
  AIGeoJSONLayer,
  AILayerDescription,
  AILayerSpec,
  AIMarkerAppearance,
  AIMarkerLayer,
  AIIntent,
  AIIntentCommitSuccess,
  AIObjectBatchChange,
  AIObjectCommand,
  AIObjectFeature,
  AIPopupImage,
  AIPointCategory,
  AIPointDefaults,
  AIPointPatch,
  AIPointPopup,
  AIPointSpec,
  AIPointVisual,
  AIPointVisualDefaults,
  AIPointVisualImage,
  AIPointVisualLabel,
  AIPointsReplaceCommand,
  AIPointViewport,
  AIRichPointPopup,
  AIPathStyle,
  AIPlan,
  AIPlanExecution,
  AIPlanStep,
  AIPolygonLayer,
  AIPolylineLayer,
  AIPosition,
  AIRasterLayer,
  AIRouteCommand,
  AIRoutePlanCommand,
  AIRoutePlanState,
  AIRouteResult,
  AIRouteSummary,
  AIResourceReference,
  AIResult,
  AISceneSpec,
  AITextContent,
  AIUpdatePointsIntent,
  AIVisualizationStressIntent,
  AIVisualizationStressUpdateIntent
} from "./ai/types.js";
export type { AICommandEngineInitialState, AIEngineListener } from "./ai/engine.js";
export type { AICapabilityAdapter } from "./ai/capabilities.js";
export type { AIPlanPreviewResult } from "./ai/runtime.js";
export type {
  AIActor,
  AIAgentSessionContext,
  AIAgentSessionOptions,
  AILocalMapState,
  AIMapViewportBounds,
  AIMapViewportState,
  AIServerCapabilityGroup,
  AISessionCapabilityGroup
} from "./ai/agent-session.js";
export type {
  AISessionRecord,
  AISessionStore,
  RestoreAIAgentSessionOptions
} from "./ai/session-store.js";
export type { AISessionToolDescription, ListAISessionToolsOptions } from "./ai/session-tools.js";
export type { AIAGUIAdapter, AIAGUIAdapterOptions, AIAGUIEvent } from "./ai/ag-ui.js";
export type { AIWebMCPInstallResult, AIWebMCPModelContext, InstallAIWebMCPToolsOptions } from "./ai/webmcp.js";
export { readMapViewport } from "./ai/agent-session.js";
export type { AIHTTPCreateSessionInput, AIHTTPHandler, AIHTTPHandlerOptions, AIHTTPPlaceSearch } from "./ai/http.js";
export type {
  AIBrowserCapability,
  AIBrowserCapabilityDescription,
  AIBrowserCapabilityGroup,
  AIBrowserCapabilityHandlerContext
} from "./ai/browser-bridge.js";
export { isBrowserCapabilityName } from "./ai/browser-bridge.js";
export type {
  AILLMAdapter,
  AILLMAgent,
  AILLMAgentOptions,
  AILLMAgentSuccess,
  AILLMAgentToolTrace,
  AILLMCompletion,
  AILLMCompletionRequest,
  AILLMExecutableTool,
  AILLMMessage,
  AILLMToolCall,
  AILLMToolDefinition,
  AILLMUsage
} from "./ai/agent.js";
export type { OpenAICompatibleAdapterOptions } from "./ai/openai-compatible.js";
export type {
  AIPlaceSearchCandidate,
  AIPlaceSearchImage,
  AIPlaceSearchProfile,
  AIPlaceSearchProvider,
  AIPlaceSearchRequest,
  AIPlaceSearchResultMode,
  AIPlaceSearchSuccess,
  NominatimPlaceSearchOptions
} from "./ai/place-search.js";
export type { AIIntentSchemaProfile, AIIntentToolBridge, AIIntentToolOptions, AIIntentToolSuccess } from "./ai/semantic-tool.js";
export type { AIMapProjectionOptions, AIProjectionSuccess } from "./ai/projection.js";
export type {
  AIEngineSchemaProfile,
  AIEngineToolBridge,
  AIEngineToolOptions,
  AIJSONSchema,
  AIToolBridge,
  AIToolDefinition,
  AIToolOptions
} from "./ai/tool.js";
