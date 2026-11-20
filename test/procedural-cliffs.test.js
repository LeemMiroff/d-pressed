import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Mesh, Raycaster, Vector3 } from 'three';
import { CONFIG } from '../src/config.js';
import { buildCliffSection, maximumCliffRecess, ProceduralCliffs } from '../src/procedural-cliffs.js';

const { platformSupports: settings } = CONFIG;
const seed = 27182;

function seam(section, y) {
  const attr = section.geometry.getAttribute('position');
  const normals = section.geometry.getAttribute('normal');
  const values = (attribute, i) => [attribute.getX(i), attribute.getY(i), attribute.getZ(i)];
  const point = (i) => {
    const [x, localY, z] = values(attr, i);
    return { position: [x, section.start - localY, z], normal: values(normals, i) };
  };
  const edges = new Map();
  for (let i = 0; i < attr.count; i += 3) {
    const corners = [point(i), point(i + 1), point(i + 2)];
    for (let j = 0; j < corners.length; j += 1) {
      const points = [corners[j], corners[(j + 1) % corners.length]].sort((a, b) => a.position[2] - b.position[2] || a.position[0] - b.position[0]);
      const [a, b] = points.map(({ position }) => position);
      if (Math.abs(a[1] - y) > 24.01 || Math.abs(b[1] - y) > 24.01 || (a[2] < -28 && b[2] < -28)) continue;
      const key = [a, b].map((values) => values.map((value) => value.toFixed(4)).join(',')).sort().join('|');
      if (!edges.delete(key)) edges.set(key, points);
    }
  }
  return edges;
}

function assertSharedFacets(upper, lower) {
  const upperEdges = seam(upper, upper.end);
  const lowerEdges = seam(lower, lower.start);
  assert.ok(upperEdges.size > 5);
  assert.deepEqual([...upperEdges.keys()].sort(), [...lowerEdges.keys()].sort());
  for (const [key, edge] of upperEdges) {
    edge.forEach(({ normal }, i) => {
      const other = lowerEdges.get(key)[i];
      assert.ok(normal.every((value, axis) => Math.abs(value - other.normal[axis]) < 1e-6));
    });
  }
  const heights = [...upperEdges.values()].flatMap((edge) => edge.map(({ position }) => position[1]));
  assert.ok(Math.max(...heights) - Math.min(...heights) > 8);
}

test('facets keep their positions and lighting normals across a streamed cliff boundary', () => {
  const shared = [{ x: 58, width: 21, y: 148.6 }, { x: 3, width: 22, y: 151.4 }];
  const upper = buildCliffSection(0, 150, [{ x: 35, width: 28, y: 60 }, ...shared], 120, settings, seed, 0);
  const lower = buildCliffSection(150, 300, [...shared, { x: 70, width: 40, y: 234 }], 120, settings, seed, 1);
  assertSharedFacets(upper, lower);
});

test('both paired platforms and an inset ledge touch rock while the canyon stays open', () => {
  const ledges = [{ x: 0, width: 43, y: 101 }, { x: 79, width: 41, y: 101 }, { x: 55, width: 12, y: 135 }];
  const section = buildCliffSection(0, 150, ledges, 120, settings, seed, 0);
  const mesh = new Mesh(section.geometry);
  const ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1), 0, 70);
  const hit = (x, y) => {
    ray.ray.origin.set(x, -y, 10);
    return ray.intersectObject(mesh)[0];
  };
  for (const ledge of ledges) {
    const samples = Array.from({ length: 9 }, (_, i) => hit(ledge.x + (i + 1) * ledge.width / 10, ledge.y));
    assert.ok(samples.some((sample) => sample?.point.z > 0.7), `No solid rock under platform at x=${ledge.x}`);
  }
  const opening = Array.from({ length: 23 }, (_, i) => hit(5 + i * 5, 103)).filter((sample) => !sample);
  assert.ok(opening.length > 4);
  assert.ok(section.bridge.left[0] - section.bridge.right[0] > 18);
  for (const [x, y] of [[10, 68], [30, 65], [50, 60], [70, 52], [95, 49], [115, 50]]) {
    assert.ok(hit(x, y)?.point.z > -12, `The diagonal rock face is broken at ${x}, ${y}`);
  }
  assert.equal(hit(45, 20), undefined);
  assert.equal(hit(50, 95), undefined);
  assert.ok(section.geometry.boundingBox.max.z <= 3);
});

test('rock returns recede into the opening and both sides can open to the screen edge', () => {
  const left = buildCliffSection(0, 150, [], 120, settings, seed, 0);
  const right = buildCliffSection(300, 450, [], 120, settings, seed, 2);
  const ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1), 0, 80);
  const isOpen = (section, x, y) => {
    ray.ray.origin.set(x, section.start - y, 10);
    return ray.intersectObject(new Mesh(section.geometry)).length === 0;
  };
  assert.ok(left.geometry.boundingBox.min.z < -30);
  assert.ok(left.geometry.boundingBox.max.z <= 3);
  assert.ok([116, 122, 128, 134].some((y) => isOpen(left, 1, y)));
  assert.ok([302, 308, 314, 320].some((y) => isOpen(right, 119, y)));
});

test('large planar facets and adjustable returns stay within the cliff depth bounds', () => {
  const detailed = { ...settings, facetSize: 16, fractureStrength: 1, recessDepth: 0.6 };
  const broad = { ...settings, facetSize: 34, facetStretch: 1.8, fractureStrength: 0, recessDepth: 1.4 };
  const small = buildCliffSection(150, 300, [], 120, detailed, seed, 1);
  const large = buildCliffSection(150, 300, [], 120, broad, seed, 1);
  assert.ok(large.frontAspect.panels >= 8);
  assert.ok(large.frontAspect.panels < small.frontAspect.panels);
  assert.ok(large.geometry.boundingBox.min.z < small.geometry.boundingBox.min.z);
  assert.ok(large.geometry.boundingBox.min.z >= -maximumCliffRecess(120, broad) - 1e-5);
  assert.ok(large.geometry.boundingBox.max.z <= 3);
});

test('a narrow ledge still reaches a coarse wall near a facet edge', () => {
  const start = 471.1137;
  const y = start + 78.9;
  const ledges = [{ x: 0, width: 31, y: start + 29 }, { x: 84, width: 36, y: start + 29 },
    { x: 60, width: 13, y }, { x: 13, width: 92, y: start + 128.9 }];
  const coarse = { ...settings, facetSize: 34, facetStretch: 1.8, fractureStrength: 0,
    recessDepth: 1.4, mountBlend: 1.4, rockCoverage: 0.95, openingSize: 0.15 };
  const { geometry } = buildCliffSection(start, start + 150, ledges, 120, coarse, 16, 3);
  const mesh = new Mesh(geometry);
  const ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1), 0, 70);
  const hasContact = [0, -0.7, 0.7, -1.7, 1.7, -2.7, 2.7].some((dy) =>
    Array.from({ length: 16 }, (_, index) => 60.75 + index * 0.75).some((x) => {
      ray.ray.origin.set(x, start - y + dy, 10);
      return ray.intersectObject(mesh)[0]?.point.z > 0.3;
    }));
  assert.ok(hasContact);
});

test('rock reaching across an opening has a short flat tip behind the ledge', () => {
  const ledges = [{ x: 0, width: 42, y: 178 }, { x: 75, width: 45, y: 178 },
    { x: 64, width: 14, y: 225 }, { x: 12, width: 99, y: 276 }];
  const section = buildCliffSection(150, 300, ledges, 120, { ...settings, facetStretch: 1 }, seed, 1);
  const mesh = new Mesh(section.geometry);
  const ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1), 0, 70);
  for (const y of [222.85, 225, 228.35]) {
    ray.ray.origin.set(74.37, section.start - y, 10);
    assert.ok(ray.intersectObject(mesh)[0]?.point.z > 2.4);
  }
  ray.ray.origin.set(72.72, section.start - 225, 10);
  assert.ok(ray.intersectObject(mesh)[0]?.point.z < 0);
});

test('scrolling discards geometry outside the retained range and keeps the seam in view', () => {
  const scenery = new ProceduralCliffs(new Group());
  scenery.reset(0);
  scenery.sync([{ x: 10, width: 80, y: 94 }], 0, CONFIG, 240, seed);
  const early = scenery.sections.get(-1);
  assert.equal(early.geometry.hasAttribute('color'), false);
  assert.equal(early.mesh.material.vertexColors, false);
  assert.equal(early.mesh.material.map, null);
  let disposed = false;
  early.geometry.addEventListener('dispose', () => { disposed = true; });

  scenery.render(135, 240);
  assert.ok(disposed);
  scenery.sync([{ x: 9, width: 25, y: 24 }, { x: 10, width: 80, y: 233 }], 135, CONFIG, 240, seed);
  assert.equal(scenery.sections.has(-1), false);
  assert.ok(scenery.sections.has(0) && scenery.sections.has(1) && scenery.sections.has(2));
  const upper = scenery.sections.get(0);
  const lower = scenery.sections.get(1);
  assert.ok(scenery.lastBuild.ms >= 0);
  assert.equal(scenery.lastBuild.vertices, scenery.lastBuild.triangles * 3);
  scenery.render(135, 240);
  assert.equal(upper.mesh.position.y - 150, lower.mesh.position.y);
  assertSharedFacets(upper, lower);
});
