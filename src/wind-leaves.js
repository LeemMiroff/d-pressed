import * as THREE from 'three';

const LEAF_COUNT = 5;
const LEAF_SHAPES = [
  ['#f3c65c', 'M6 42 Q12 16 35 15 Q48 14 58 7 Q58 34 43 44 Q25 55 6 42', 'M6 45 Q29 37 50 18'],
  ['#e99142', 'M7 42 L13 26 L21 29 L26 12 L34 20 L44 8 L47 23 L58 20 L52 35 L56 41 Q31 58 7 42', 'M6 46 Q29 39 47 24'],
  ['#ffad54', 'M7 46 Q16 40 18 29 Q23 9 54 12 Q58 40 38 48 Q23 54 12 47 Z', 'M7 49 Q28 40 46 21'],
];

function leafTexture([color, silhouette, vein]) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fill(new Path2D(silhouette));
  context.strokeStyle = '#ab6137';
  context.lineWidth = 3;
  context.lineCap = 'round';
  context.stroke(new Path2D(vein));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class WindLeaves {
  constructor(world, width) {
    this.width = width;
    this.time = 0;
    const textures = LEAF_SHAPES.map(leafTexture);
    this.leaves = Array.from({ length: LEAF_COUNT }, (_, index) => {
      const material = new THREE.SpriteMaterial({
        map: textures[index % textures.length],
        opacity: 0.78,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      world.add(sprite);
      return {
        sprite,
        x: width * (index + 0.5) / LEAF_COUNT,
        heightRatio: 0.08 + 0.84 * (index + 0.5) / LEAF_COUNT,
        phase: index * 2.4,
        speed: 16 * (22 + (index * 7 % 13)),
        size: 2.4 + (index % 4) * 0.4,
      };
    });
  }

  update(dt, worldHeight) {
    this.time += dt;
    for (const leaf of this.leaves) {
      const phase = this.time + leaf.phase;
      leaf.x -= leaf.speed * dt;
      if (leaf.x < -leaf.size) leaf.x += this.width + 2 * leaf.size;
      leaf.sprite.position.set(leaf.x, leaf.heightRatio * worldHeight + Math.sin(phase * 3) * 8, 10);
      leaf.sprite.scale.set(leaf.size * (0.68 + 0.32 * Math.cos(phase * 3)), leaf.size, 1);
      leaf.sprite.material.rotation = Math.sin(phase * 2.6) * 0.7;
    }
  }
}
