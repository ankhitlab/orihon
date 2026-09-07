import type {
  AIObjectFeature,
  AIPointDefaults,
  AIPointSpec,
  AIPointVisual,
  AIPointVisualDefaults,
  AIPointsReplaceCommand
} from "./types.js";

function mergeVisual(
  defaults: AIPointVisualDefaults | undefined,
  point: AIPointVisual | undefined
): AIPointVisual | undefined {
  if (!defaults && !point) return undefined;
  if (!defaults) return point;
  const defaultImage = defaults.image && typeof defaults.image.url === "string"
    ? ({ ...defaults.image } as AIPointVisual["image"])
    : undefined;
  if (!point) {
    // Defaults alone are useful as soon as they form a valid visual — a shared label,
    // a shared image.url, or both. Requiring a label here silently dropped
    // presentation.defaults.visual.image, the shared marker chrome agents are told to send.
    if (defaults.label === undefined && !defaultImage) return undefined;
    return {
      ...(defaultImage ? { image: defaultImage } : {}),
      ...(defaults.label !== undefined ? { label: defaults.label } : {}),
      ...(defaults.size !== undefined ? { size: defaults.size } : {}),
      ...(defaults.collisionMode !== undefined ? { collisionMode: defaults.collisionMode } : {})
    };
  }
  const image = point.image
    ? { ...(defaults.image ?? {}), ...point.image }
    : defaultImage;
  const label = point.label !== undefined ? point.label : defaults.label;
  const size = point.size !== undefined ? point.size : defaults.size;
  const collisionMode = point.collisionMode !== undefined ? point.collisionMode : defaults.collisionMode;
  if (!image && label === undefined) return undefined;
  // Omit absent keys instead of writing explicit undefined into feature properties.
  return {
    ...(image ? { image } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(collisionMode !== undefined ? { collisionMode } : {})
  };
}

function applyDefaults(point: AIPointSpec, defaults?: AIPointDefaults): AIPointSpec {
  if (!defaults) return point;
  const visual = mergeVisual(defaults.visual, point.visual);
  return {
    ...point,
    ...(point.category === undefined && defaults.category !== undefined ? { category: defaults.category } : {}),
    ...(visual ? { visual } : {})
  };
}

/** Convert the compact point command into canonical GeoJSON objects. */
export function pointCommandFeatures(command: AIPointsReplaceCommand): AIObjectFeature[] {
  return command.points.map((raw) => {
    const point = applyDefaults(raw, command.defaults);
    const properties: Record<string, unknown> = {};
    if (point.title !== undefined) properties.title = point.title;
    if (point.popup !== undefined) properties.popup = point.popup;
    if (point.visual !== undefined) properties.visual = point.visual;
    if (point.category !== undefined) properties.category = point.category;
    return {
      type: "Feature",
      id: point.id,
      geometry: { type: "Point", coordinates: [point.position.lng, point.position.lat] },
      properties
    };
  });
}
