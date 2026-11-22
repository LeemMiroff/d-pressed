import { Color, Float32BufferAttribute, MeshStandardMaterial } from 'three';
import { loadStoneGeometry } from './stone-geometry.js';
import { addCliffSurfaceAttributes, applyCliffWear, CANYON_ROCK_COLOR } from './cliff-surface.js';

function paintPlatformPart(part, material) {
  // The GLB uses slate materials only beneath the pale limestone cap.
  const slate = material.name.startsWith('Stone |');
  const colors = part.getAttribute('color');
  part.setAttribute('platformSlate', new Float32BufferAttribute(new Float32Array(colors.count).fill(Number(slate)), 1));
  if (slate) {
    const { r, g, b } = new Color(CANYON_ROCK_COLOR);
    for (let i = 0; i < colors.count; i += 1) colors.setXYZ(i, r, g, b);
  }
}

export async function loadStonePlatform(url, wearTextureReady) {
  const [{ geometry, size }, wearTexture] = await Promise.all([
    loadStoneGeometry(url, { decoratePart: paintPlatformPart }), wearTextureReady,
  ]);
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.94 });
  if (wearTexture) {
    addCliffSurfaceAttributes(geometry, 0, 1, size.toArray());
    applyCliffWear(material, wearTexture, 1, { platform: true });
  }
  return {
    geometry,
    material,
    hasWear: Boolean(wearTexture),
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
  if (source.hasWear) addCliffSurfaceAttributes(mesh.geometry, 0, 1, [width, mesh.scale.y, mesh.scale.z]);
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}
