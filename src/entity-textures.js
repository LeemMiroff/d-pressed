import * as THREE from 'three';

const SIZE = 64;

export const ENEMY_COLORS = {
  static: ['#92ba48', '#c3de69', '#536c2c'],
  fleeing: ['#42a99d', '#80dece', '#256962'],
  spiked: ['#b34f77', '#ef86a6', '#702e51'],
};

// BoxGeometry lists the camera-facing (+Z) face fifth.
export function mapBoxFront(geometry) {
  const uv = geometry.attributes.uv;
  for (let index = 0; index < uv.count; index += 1) {
    const tile = Math.floor(index / 4) === 4 ? 0 : 1;
    uv.setX(index, (tile * SIZE + 0.5 + uv.getX(index) * (SIZE - 1)) / (2 * SIZE));
  }
}

function boxTexture(draw) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * 2;
  canvas.height = SIZE;
  const context = canvas.getContext('2d');
  for (const front of [true, false]) {
    context.save();
    if (!front) context.translate(SIZE, 0);
    draw(context, front);
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createEnemyTexture(type) {
  const [base, highlight, shadow] = ENEMY_COLORS[type];
  return boxTexture((context, front) => {
    const rect = (color, x, y, width, height) => {
      context.fillStyle = color;
      context.fillRect(x, y, width, height);
    };
    rect(shadow, 0, 0, 64, 64);
    rect(base, 3, 3, 58, 54);
    rect(highlight, 6, 6, 52, 6);
    rect(shadow, 7, 52, 50, 5);
    if (!front) return;
    rect('#292137', 9, 21, 20, 16);
    rect('#292137', 35, 21, 20, 16);
    rect('#fff1c6', 12, 24, 14, 10);
    rect('#fff1c6', 38, 24, 14, 10);
    rect('#292137', 19, 25, 6, 9);
    rect('#292137', 39, 25, 6, 9);
    rect('#292137', 20, 43, 24, 8);
    rect('#fff1c6', 24, 43, 5, 4);
    rect('#fff1c6', 36, 43, 5, 4);
  });
}

export function createChestTexture() {
  return boxTexture((context, front) => {
    const rect = (color, x, y, width, height) => {
      context.fillStyle = color;
      context.fillRect(x, y, width, height);
    };
    rect('#442635', 0, 0, 64, 64);
    for (const [y, color] of [[4, '#c47748'], [17, '#a75637'], [34, '#9b5036'], [47, '#bb6940']]) {
      rect(color, 3, y, 58, 12);
      rect('#e39556', 8, y + 2, 34, 2);
    }
    for (const x of [6, 50]) {
      rect('#594353', x, 0, 8, 64);
      rect('#ad8590', x + 1, 0, 2, 64);
    }
    rect('#503243', 0, 29, 64, 5);
    if (!front) return;
    rect('#4d303a', 22, 23, 20, 21);
    rect('#f1b454', 24, 24, 16, 17);
    rect('#ffe3a4', 26, 26, 12, 3);
    rect('#4d303a', 30, 31, 4, 7);
  });
}
