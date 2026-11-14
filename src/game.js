import { Graphics, Sprite } from 'pixi.js';
import { findLandingPlatform, isOnPlatform } from './collision.js';
import { PlatformPool } from './platform-pool.js';
import { EnemyManager } from './enemies.js';
import { CrystalManager } from './crystals.js';
import { ChestManager } from './chests.js';
import { PortalManager } from './portal.js';

function moveTowards(current, target, amount) {
  if (current < target) {
    return Math.min(current + amount, target);
  }

  return Math.max(current - amount, target);
}

export class Game {
  constructor(worldRoot, uiRoot, input, config, textures) {
    this.worldRoot = worldRoot;
    this.uiRoot = uiRoot;
    this.textures = textures;
    this.mode = 'game';
    this.input = input;
    this.config = config;
    this.worldSpeed = config.platforms.initialWorldSpeed;
    this.difficultyTime = 0;
    this.doublePlatformsDisabled = false;
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
    this.crystalManager = new CrystalManager(this, textures.crystalTexture, uiRoot);
    this.crystalManager.reset();
    this.chestManager = new ChestManager(this, textures.chestTexture);
    this.chestManager.reset();
    this.portalManager = new PortalManager(this);
  }

  restart(regeneratePlatforms = false, preserveProgression = false) {
    const preservedWorldSpeed = this.worldSpeed;
    this.input.release();
    if (!preserveProgression) {
      this.difficultyTime = 0;
      this.doublePlatformsDisabled = false;
      this.config.platforms.enablePairedPlatforms = true;
    }
    this.platformPool.setProgression(this.difficultyTime);
    this.platformPool.initialize();
    this.worldSpeed = preserveProgression ? preservedWorldSpeed : this.config.platforms.initialWorldSpeed;
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
    this.crystalManager?.reset();
    this.chestManager?.reset();
    this.portalManager?.reset();
    this.portalManager?.startInitialHub();
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

    if (this.mode === 'transition') {
      this.portalManager.update(dt);
      this.enemyManager?.update(dt);
      this.chestManager?.update(dt);
      this.crystalManager?.update(dt);
      this.platformPool.clearRecycleFlags();
      this.renderPlayer();
      return;
    }

    if (this.mode === 'hub') {
      this.updateHorizontalMovement(dt);
      this.updateVerticalMovement(dt);
      this.renderPlayer();
      this.enemyManager?.update(dt);
      this.chestManager?.update(dt);
      this.crystalManager?.update(dt);
      this.portalManager.update(dt);
      this.platformPool.clearRecycleFlags();
      return;
    }

    if (this.config.platforms.useFlowProgression) {
      this.difficultyTime += dt;
      this.platformPool.setProgression(this.difficultyTime);
      const targetTime = this.config.platforms.targetWorldSpeedTime;
      const targetSpeed = this.config.platforms.targetWorldSpeed;
      const speedPerSecond = (targetSpeed - this.config.platforms.initialWorldSpeed) / targetTime;
      this.worldSpeed = Math.min(
        this.config.platforms.initialWorldSpeed +
          speedPerSecond * this.difficultyTime,
        targetSpeed,
      );
      if (!this.doublePlatformsDisabled && this.difficultyTime >= this.config.platforms.doublePlatformsDuration) {
        this.doublePlatformsDisabled = true;
        this.config.platforms.enablePairedPlatforms = false;
      }
    } else if (this.config.platforms.increaseWorldSpeed) {
      this.difficultyTime += dt;
      this.worldSpeed = Math.min(
        this.config.platforms.initialWorldSpeed + this.config.platforms.worldSpeedIncrease * this.difficultyTime,
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
    this.chestManager?.update(dt);
    this.crystalManager?.update(dt);
    this.portalManager?.update(dt);
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
