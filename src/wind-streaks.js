import * as THREE from 'three';

const STREAK_COUNT = 3;
const STREAK_DEPTH = 10;
const between = (min, max) => min + Math.random() * (max - min);

function createStreakTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 16;
  const context = canvas.getContext('2d');
  const along = context.createLinearGradient(0, 0, canvas.width, 0);
  along.addColorStop(0, 'transparent');
  along.addColorStop(0.13, 'white');
  along.addColorStop(0.4, 'rgba(255, 255, 255, 0.55)');
  along.addColorStop(1, 'transparent');
  context.fillStyle = along;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const across = context.createLinearGradient(0, 0, 0, canvas.height);
  across.addColorStop(0, 'transparent');
  across.addColorStop(0.45, 'white');
  across.addColorStop(0.55, 'white');
  across.addColorStop(1, 'transparent');
  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = across;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class WindStreaks {
  constructor(world, width, camera) {
    this.width = width;
    this.camera = camera;
    this.cameraPoint = new THREE.Vector3();
    const map = createStreakTexture();
    this.streaks = Array.from({ length: STREAK_COUNT }, (_, index) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map,
        depthWrite: false,
        toneMapped: false,
      }));
      sprite.visible = false;
      world.add(sprite);
      return { sprite, elapsed: -0.45 * index };
    });
  }

  update(dt, worldHeight) {
    for (const streak of this.streaks) {
      streak.elapsed += dt;
      if (streak.elapsed < 0) continue;
      if (!streak.sprite.visible) this.startStreak(streak, worldHeight);

      const progress = streak.elapsed / streak.duration;
      if (progress >= 1) {
        streak.sprite.visible = false;
        streak.elapsed = -between(0.12, 0.85);
        continue;
      }

      const angle = progress * Math.PI * 2 + streak.phase;
      const x = streak.startX - progress * streak.travel;
      const y = streak.heightRatio * worldHeight + progress * streak.drift + Math.sin(angle) * streak.sway;
      const slope = streak.drift + Math.cos(angle) * streak.sway * Math.PI * 2;
      streak.sprite.position.set(x, y, STREAK_DEPTH);
      streak.sprite.material.rotation = Math.atan2(-slope, streak.travel);
    }
  }

  startStreak(streak, worldHeight) {
    const length = between(24, 54);
    streak.heightRatio = between(0.12, 0.88);
    streak.phase = between(0, Math.PI * 2);
    streak.drift = between(-9, 9);
    streak.sway = between(0.5, 2.3);
    const centerX = this.width / 2;
    const centerY = streak.heightRatio * worldHeight;
    const verticalReach = Math.abs(streak.drift) + streak.sway;
    const cameraDepthAt = (y) => -this.cameraPoint
      .set(centerX, y, STREAK_DEPTH).applyMatrix4(this.camera.matrixWorldInverse).z;
    const farthestDepth = Math.max(cameraDepthAt(centerY - verticalReach), cameraDepthAt(centerY + verticalReach));
    const halfViewWidth = farthestDepth / this.camera.projectionMatrix.elements[0];
    const thickness = between(1, 1.6);
    const outside = halfViewWidth + Math.hypot(length, thickness) / 2 + 2;
    streak.startX = centerX + outside;
    streak.travel = 2 * outside;
    streak.duration = streak.travel / between(210, 440);
    streak.sprite.material.opacity = between(0.34, 0.60);
    streak.sprite.scale.set(length, thickness, 1);
    streak.sprite.visible = true;
  }
}
