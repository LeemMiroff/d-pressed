import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { findLandingPlatform, isOnPlatform } from './collision.js';
import { PlatformPool } from './platform-pool.js';
import { EnemyManager } from './enemies.js';
import { CrystalManager } from './crystals.js';
import { ChestManager } from './chests.js';
import { PortalManager } from './portal.js';
import { UpgradeManager } from './upgrades.js';
import { Sound } from './audio.js';

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
    this.gameOver = false;
    this.simulationAccumulator = 0;
    this.simulationStep = 1 / 60;
    this.input = input;
    this.config = config;
    this.audio = new Sound();
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
      damage: 1,
    };
    this.previousPlayerX = 0;
    this.previousPlayerY = 0;
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
    this.playerShape.zIndex = 5;
    this.playerShape.width = config.player.visualWidth;
    this.playerShape.height = config.player.visualHeight;
    worldRoot.addChild(this.playerShape);
    this.hitboxShape = new Graphics()
      .rect(0, 0, this.player.width, this.player.height)
      .fill({ color: 0xff3b30, alpha: 0.04 })
      .stroke({ width: 0.5, color: 0xff3b30, alpha: 0.9 });
    this.hitboxShape.zIndex = 6;
    this.hitboxShape.visible = config.player.showHitbox;
    worldRoot.addChild(this.hitboxShape);

    this.gameOverOverlay = new Container({ label: 'game-over' });
    this.gameOverOverlay.visible = false;
    this.gameOverOverlayShape = new Graphics().rect(0, 0, config.world.width, config.world.height).fill(0x000000);
    const restartText = new Text({ text: 'PRESS R', style: { fill: 0xffffff, fontFamily: 'monospace', fontSize: 8 } });
    restartText.anchor.set(0.5);
    restartText.position.set(config.world.width * 0.5, config.world.height * 0.5);
    this.gameOverOverlay.addChild(this.gameOverOverlayShape, restartText);
    this.gameOverRestartText = restartText;
    uiRoot.addChild(this.gameOverOverlay);

    this.restart();
    this.enemyManager = new EnemyManager(this);
    this.enemyManager.reset();
    this.crystalManager = new CrystalManager(this, textures.crystalTexture, uiRoot);
    this.crystalManager.reset();
    this.chestManager = new ChestManager(this, textures.chestTexture);
    this.chestManager.reset();
    this.portalManager = new PortalManager(this);
    this.upgradeManager = new UpgradeManager(this, this.portalManager.hubPlatform.node, this.portalManager.hubPlatform, textures.scarecrowTexture);
  }

  restart(preserveProgression = false, startInHub = true) {
    const preservedWorldSpeed = this.worldSpeed;
    this.input.release();
    this.simulationAccumulator = 0;
    this.gameOver = false;
    this.gameOverOverlay.visible = false;
    if (!preserveProgression) {
      this.difficultyTime = 0;
      this.doublePlatformsDisabled = false;
    }
    this.platformPool.setProgression(this.difficultyTime);
    this.platformPool.initialize(preserveProgression);
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
    this.previousPlayerX = this.player.x;
    this.previousPlayerY = this.player.y;
    this.renderPlayer();
    this.enemyManager?.reset();
    this.crystalManager?.reset();
    this.chestManager?.reset();
    this.portalManager?.reset();
    this.upgradeManager?.reset(!preserveProgression);
    this.mode = 'game';
    if (startInHub) this.portalManager?.startInitialHub();
  }

  resizeWorld(height) {
    this.config.world.height = height;
    this.config.platforms.startY = height - 24;
    this.platformPool.initialStates.length = 0;
    this.gameOverOverlayShape.clear().rect(0, 0, this.config.world.width, height).fill(0x000000);
    this.gameOverRestartText.position.set(this.config.world.width * 0.5, height * 0.5);
    this.restart(false, true);
  }

  update(deltaSeconds) {
    this.simulationAccumulator += Math.min(deltaSeconds, 0.25);
    let steps = 0;
    while (this.simulationAccumulator >= this.simulationStep && steps < 16) {
      this.previousPlayerX = this.player.x;
      this.previousPlayerY = this.player.y;
      this.updateStep(this.simulationStep);
      this.simulationAccumulator -= this.simulationStep;
      steps += 1;
    }
    const alpha = this.simulationAccumulator / this.simulationStep;
    this.renderPlayer(alpha);
  }

  updateStep(dt) {

    if (this.gameOver) {
      return;
    }

    if (this.mode === 'transition') {
      this.portalManager.update(dt);
      this.enemyManager?.update(dt);
      this.chestManager?.update(dt);
      this.crystalManager?.update(dt);
      this.platformPool.clearRecycleFlags();
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
    this.portalManager?.prepareForPlatformRecycle();
    this.platformPool.recycleOffscreen();

    if (this.player.groundedOn?.recycledThisFrame) {
      this.player.groundedOn = null;
    }

    this.updateHorizontalMovement(dt);
    this.updateVerticalMovement(dt);
    if (this.player.y + this.player.height < 0 || this.player.y > this.config.world.height) {
      this.gameOver = true;
      this.audio.over();
      this.gameOverOverlay.visible = true;
      this.input.release();
      return;
    }
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

    if (groundedPlatform && !groundedPlatform.active) {
      this.player.groundedOn = null;
    }

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
      this.audio.land();
      this.player.y = landingPlatform.y - this.player.height;
      this.player.vy = 0;
      this.player.groundedOn = landingPlatform;
      return;
    }

    this.player.y = nextY;
  }

  renderPlayer(alpha = 1) {
    const renderX = this.previousPlayerX + (this.player.x - this.previousPlayerX) * alpha;
    const renderY = this.previousPlayerY + (this.player.y - this.previousPlayerY) * alpha;
    this.playerShape.scale.x = this.facing;
    this.playerShape.position.set(
      renderX + this.config.player.visualOffsetX + (this.facing < 0 ? this.config.player.visualWidth : 0),
      renderY + this.config.player.visualOffsetY,
    );
    this.hitboxShape.position.set(renderX, renderY);
  }

  setHitboxVisible(visible) {
    this.config.player.showHitbox = visible;
    this.hitboxShape.visible = visible;
    this.platformPool.setHitboxVisible(visible);
  }
}
