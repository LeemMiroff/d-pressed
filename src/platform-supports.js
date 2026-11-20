import { Mesh, MeshStandardMaterial } from 'three';
import { SUPPORT_SCALE_LIMITS } from './config.js';
import { loadStoneGeometry } from './stone-geometry.js';

const limitScale = (value) => Math.max(SUPPORT_SCALE_LIMITS.min, Math.min(SUPPORT_SCALE_LIMITS.max, value));

export async function loadPlatformSupports(urls) {
  const variants = await Promise.all(urls.map((url) => loadStoneGeometry(url, { normalize: false })));
  if (variants.some(({ geometry }) => geometry.boundingBox.max.z > 3)) {
    throw new Error('A platform support exceeds the 3-unit relief behind its ledge');
  }
  return new PlatformSupports(variants);
}

class PlatformSupports {
  constructor(variants) {
    this.variants = variants;
    this.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.94 });
  }

  attach(platform, parent) {
    const mesh = new Mesh(this.variants[0].geometry, this.material);
    mesh.name = 'Platform rock support';
    mesh.visible = false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    platform.support = mesh;
  }

  configure(platform, config, seed, fixedVariant) {
    const mesh = platform.support;
    // Derive scenery without consuming any of the route or enemy random streams.
    let hash = seed ^ Math.imul(platform.x | 0, 0x9e3779b1) ^ Math.imul(platform.y | 0, 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d) >>> 0;
    mesh.visible = fixedVariant != null || (hash & 7) >= 3;
    if (!mesh.visible) return;

    const variant = this.variants[fixedVariant ?? ((hash >>> 3) % this.variants.length)];
    const atLeftEdge = platform.x <= 0.001;
    const atRightEdge = platform.x + platform.width >= config.world.width - 0.001;
    const leftSide = atLeftEdge || (!atRightEdge && (hash & 256) === 0);
    const widthScale = Math.min(0.83 + ((hash >>> 11) & 7) * 0.045, platform.width * 0.97 / variant.size.x);
    const heightScale = fixedVariant != null ? 1 : 0.78 + ((hash >>> 16) & 7) * 0.075;
    mesh.geometry = variant.geometry;
    mesh.position.set(0, platform.height / 2, -config.platforms.depth / 2);
    platform.supportStyle = { atLeftEdge, atRightEdge, leftSide, widthScale, heightScale, width: variant.size.x };
    this.resize(platform, config.platformSupports);
  }

  resize(platform, sizing) {
    if (!platform.support.visible) return;
    const style = platform.supportStyle;
    const width = style.widthScale * limitScale(sizing.widthScale);
    const height = style.heightScale * limitScale(sizing.heightScale);
    platform.support.scale.set(style.leftSide ? width : -width, height, 1);
    const edgeInset = style.width * width * 0.33;
    platform.supportOffset = style.leftSide
      ? (style.atLeftEdge ? edgeInset : platform.width * 0.23)
      : (style.atRightEdge ? platform.width - edgeInset : platform.width * 0.77);
  }
}
