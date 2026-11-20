import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { addCliffSurfaceAttributes } from '../src/cliff-surface.js';

test('rock wear crosses a subdivided fold and leaves coplanar diagonals clean', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    0, 0, 0, 0, -1, 0, 2, 0, 0,
    0, 0, 0, 1, 0, 0, 1, 1, -1,
    1, 0, 0, 2, 0, 0, 1, 1, -1,
  ], 3));
  geometry.computeVertexNormals();
  addCliffSurfaceAttributes(geometry);
  const strengths = geometry.getAttribute('cliffEdgeStrength');
  for (const vertex of [0, 3, 6]) assert.ok(strengths.getY(vertex) > 0 || strengths.getZ(vertex) > 0);
  assert.equal(strengths.getX(3), 0);
  assert.equal(strengths.getY(6), 0);
});

test('a shallow fold is lit when it separates two authored facets', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    0, 0, 0, 0, -1, 0, 2, 0, 0,
    0, 0, 0, 2, 0, 0, 1, 1, -0.1,
  ], 3));
  geometry.computeVertexNormals();
  for (const [ids, highlighted] of [[[1, 1], false], [[1, 2], true]]) {
    geometry.userData.facetIds = ids;
    addCliffSurfaceAttributes(geometry);
    const strengths = geometry.getAttribute('cliffEdgeStrength');
    assert.equal(strengths.getY(0) > 0, highlighted);
    assert.equal(strengths.getZ(3) > 0, highlighted);
  }
});

test('a highlighted corner continues into a triangle that only touches the crease at its tip', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    0, 0, 0, 0, -1, 0, 2, 0, 0,
    0, 0, 0, 2, 0, 0, 1, 1, -1,
    0, 0, 0, -1, 0, 0, -1, -1, 0,
  ], 3));
  geometry.computeVertexNormals();
  addCliffSurfaceAttributes(geometry);
  const { cliffCornerDistance: distance, cliffCornerStrength: strength, cliffEdgeStrength: edge } = geometry.attributes;
  assert.equal(edge.getX(6), 0);
  assert.ok(strength.getX(6) > 0);
  assert.equal(distance.getX(6), 0);
  assert.equal(distance.getX(7), 1);
});
