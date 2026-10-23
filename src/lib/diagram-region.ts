export type DiagramRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Validate model-provided figure bounds in normalized 0..1000 full-page coordinates.
 * Reject invalid or too-large rectangles instead of accidentally cropping a whole solution slide.
 */
export function normalizeDiagramRegion(value: unknown): DiagramRegion | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const values = [item.x, item.y, item.width, item.height];
  if (!values.every(entry => typeof entry === "number" && Number.isFinite(entry))) return undefined;
  const [x, y, width, height] = values as number[];
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return undefined;
  if (x + width > 1000 || y + height > 1000) return undefined;
  if (width * height > 850_000) return undefined;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export function diagramRegionArea(value: unknown): number {
  const region = normalizeDiagramRegion(value);
  return region ? region.width * region.height : Number.POSITIVE_INFINITY;
}
