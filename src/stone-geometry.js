import { Float32BufferAttribute, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export async function loadStoneGeometry(url, { normalize = true } = {}) {
  const { scene } = await new GLTFLoader().loadAsync(url);
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const part = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    part.applyMatrix4(mesh.matrixWorld);
    const { r, g, b } = mesh.material.color;
    const colors = new Float32Array(part.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = r;
      colors[i + 1] = g;
      colors[i + 2] = b;
    }
    part.setAttribute('color', new Float32BufferAttribute(colors, 3));
    parts.push(part);
  });

  // Store the face palette in the vertices so each material uses the same draw.
  const geometry = parts.length ? mergeGeometries(parts) : null;
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Stone asset has no compatible mesh primitives');
  geometry.computeBoundingBox();
  const { boundingBox } = geometry;
  const size = boundingBox.getSize(new Vector3());
  const center = boundingBox.getCenter(new Vector3());
  if (![size.x, size.y, size.z].every((axis) => Number.isFinite(axis) && axis > 0)) {
    throw new Error('Stone asset must have positive width, height, and depth');
  }
  if (normalize) {
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  }
  return { geometry, size };
}
