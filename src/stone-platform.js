import { MeshStandardMaterial } from 'three';
import { loadStoneGeometry } from './stone-geometry.js';

export async function loadStonePlatform(url) {
  const { geometry, size } = await loadStoneGeometry(url);
  return {
    geometry,
    material: new MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }),
    widthToHeight: size.x / size.y,
  };
}

export function fitStonePlatform(mesh, source, width) {
  // Stretch the middle of wide ledges and keep their two shallow end bevels.
  const endFraction = 0.1;
  const middleEdge = 0.5 - endFraction;
  const endScale = Math.min(mesh.scale.y * source.widthToHeight, width / (4 * endFraction));
  const middleScale = (width - 2 * endFraction * endScale) / (2 * middleEdge);
  const original = source.geometry.getAttribute('position');
  const positions = mesh.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const originalX = original.getX(i);
    const distance = Math.abs(originalX);
    const fittedX = distance > middleEdge
      ? width / 2 - (0.5 - distance) * endScale
      : distance * middleScale;
    positions.setX(i, Math.sign(originalX) * fittedX / width);
  }
  positions.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}
