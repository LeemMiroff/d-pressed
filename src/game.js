import { Graphics, Sprite } from 'pixi.js';
import { findLandingPlatform, isOnPlatform } from './collision.js';
import { PlatformPool } from './platform-pool.js';
import { EnemyManager } from './enemies.js';

function moveTowards(current, target, amount) {
  if (current < target) {
    return Math.min(current + amount, target);
  }

  return Math.max(current - amount, target);
}

export class Game {
  constructor(worldRoot, input, config, textures) {
    this.worldRoot = worldRoot;
    this.input = input;
    this.config = config;
    this.worldSpeed = config.platforms.initialWorldSpeed;
    this.difficultyTime = 0;
    this.player = {
      x: 0,
      y: 0,
      width: config.player.width,
      height: config.player.height,
      vx: 0,
      vy: 0,
      groundedOn: null,
    };
    this.facing = 1;

    this.platformPool = new PlatformPool(
      worldRoot,
      config.platforms,
      config.world,
      config.player,
      textures.platformTexture,
    );
    this.platformPool.initialize();

    this.playerShape = new Sprite(textures.playerTexture);
    this.playerShape.width = config.player.visualWidth;
    this.playerShape.height = config.player.visualHeight;
    worldRoot.addChild(this.playerShape);
    this.hitboxShape = new Graphics()
      .rect(0, 0, this.player.width, this.player.height)
      .fill({ color: 0xff3b30, alpha: 0.04 })
      .stroke({ width: 0.5, color: 0xff3b30, alpha: 0.9 });
    this.hitboxShape.visible = config.player.showHitbox;
    worldRoot.addChild(this.hitboxShape);

    this.restart();
    this.enemyManager = new EnemyManager(this);
    this.enemyManager.reset();
  }

  restart() {
    this.input.release();
    this.platformPool.reset();
    this.worldSpeed = this.config.platforms.initialWorldSpeed;
    this.difficultyTime = 0;
    this.player.vx = 0;
    this.player.vy = 0;
    this.facing = 1;

    const startPlatform = this.platformPool.items[
      Math.min(this.config.player.startPlatformIndex, this.platformPool.items.length - 1)
    ];
    this.player.groundedOn = startPlatform;
    this.player.x = startPlatform.x + (startPlatform.width - this.player.width) / 2;
    this.player.y = startPlatform.y - this.player.height;
    this.renderPlayer();
    this.enemyManager?.reset();
  }

  resizeWorld(height) {
    this.config.world.height = height;
    this.config.platforms.startY = height - 24;
    this.platformPool.initialStates.length = 0;
    this.platformPool.initialize();
    this.restart();
  }

  update(deltaSeconds) {
    const dt = Math.min(deltaSeconds, 0.05);

    if (this.config.platforms.increaseWorldSpeed) {
      this.difficultyTime += dt;
      this.worldSpeed = Math.min(
        this.config.platforms.initialWorldSpeed +
          this.config.platforms.worldSpeedIncrease * this.difficultyTime,
        this.config.platforms.maxWorldSpeed,
      );
    }

    this.platformPool.updateMovement(dt, this.worldSpeed);
    this.platformPool.recycleOffscreen();

    if (this.player.groundedOn?.recycledThisFrame) {
      this.player.groundedOn = null;
    }

    this.updateHorizontalMovement(dt);
    this.updateVerticalMovement(dt);
    this.renderPlayer();
    this.enemyManager?.update(dt);
  }

  updateHorizontalMovement(deltaSeconds) {
    const direction = this.input.isRightHeld ? 1 : -1;
    this.facing = direction;
    const targetSpeed = direction * this.config.player.maxHorizontalSpeed;
    const isTurning = this.player.vx !== 0 && Math.sign(this.player.vx) !== direction;
    const rate = isTurning ? this.config.player.braking : this.config.player.acceleration;

    this.player.vx = moveTowards(this.player.vx, targetSpeed, rate * deltaSeconds);
    this.player.x += this.player.vx * deltaSeconds;
    this.player.x = Math.max(
      0,
      Math.min(this.config.world.width - this.player.width, this.player.x),
    );
  }

  updateVerticalMovement(deltaSeconds) {
    const groundedPlatform = this.player.groundedOn;

    if (groundedPlatform?.active) {
      this.player.y = groundedPlatform.y - this.player.height;
      this.player.vy = 0;

      if (!isOnPlatform(this.player, groundedPlatform)) {
        this.player.groundedOn = null;
      }
    }

    if (this.player.groundedOn) {
      return;
    }

    const previousBottom = this.player.y + this.player.height;
    this.player.vy += this.config.player.gravity * deltaSeconds;
    const nextY = this.player.y + this.player.vy * deltaSeconds;
    const nextBottom = nextY + this.player.height;
    const landingPlatform = findLandingPlatform(
      this.player,
      previousBottom,
      nextBottom,
      this.platformPool.items,
    );

    if (landingPlatform) {
      this.player.y = landingPlatform.y - this.player.height;
      this.player.vy = 0;
      this.player.groundedOn = landingPlatform;
      return;
    }

    this.player.y = nextY;
  }

  renderPlayer() {
    this.playerShape.scale.x = this.facing;
    this.playerShape.position.set(
      this.player.x + this.config.player.visualOffsetX + (this.facing < 0 ? this.config.player.visualWidth : 0),
      this.player.y + this.config.player.visualOffsetY,
    );
    this.hitboxShape.position.set(this.player.x, this.player.y);
  }

  setHitboxVisible(visible) {
    this.config.player.showHitbox = visible;
    this.hitboxShape.visible = visible;
    this.platformPool.setHitboxVisible(visible);
  }
}
