import test from "node:test";
import assert from "node:assert/strict";
import { diagramRegionArea, normalizeDiagramRegion } from "../src/lib/diagram-region.ts";

test("normalizes finite diagram bounds in the 0..1000 page coordinate system", () => {
  assert.deepEqual(normalizeDiagramRegion({ x: 120.4, y: 250.2, width: 300.5, height: 180.4 }), {
    x: 120, y: 250, width: 301, height: 180
  });
});

test("rejects missing, nonnumeric, out-of-bounds and near-full-page regions", () => {
  assert.equal(normalizeDiagramRegion(null), undefined);
  assert.equal(normalizeDiagramRegion({ x: "10", y: 10, width: 100, height: 100 }), undefined);
  assert.equal(normalizeDiagramRegion({ x: -1, y: 10, width: 100, height: 100 }), undefined);
  assert.equal(normalizeDiagramRegion({ x: 900, y: 10, width: 200, height: 100 }), undefined);
  assert.equal(normalizeDiagramRegion({ x: 0, y: 0, width: 950, height: 950 }), undefined);
});

test("valid figure crops rank ahead of missing or invalid rectangles", () => {
  assert.ok(diagramRegionArea({ x: 100, y: 100, width: 200, height: 200 }) < diagramRegionArea(undefined));
});
