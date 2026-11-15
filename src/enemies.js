import { Rectangle, Sprite, Texture } from 'pixi.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

const HIT_FLIGHT_DURATION = 0.18;
const HIT_JUMP_HEIGHT = 4;
const DEATH_GRAVITY = 440;
const DEATH_VELOCITY_Y = -156;
const IDLE_FRAME_DURATION = 0.08;

class Enemy {
  constructor(game, platform, worldRoot, worldHeight, frames) {
    this.game = game;
    this.platform = platform;
    this.worldRoot = worldRoot;
    this.worldHeight = worldHeight;
    this.frames = frames;
    this.node = new Sprite(frames[0]);
    this.node.label = 'enemy';
    this.node.zIndex = 10;
    platform.node.addChild(this.node);
    this.width = frames[0].width;
    this.height = frames[0].height;
    this.node.anchor.set(0.5, 0.5);
    this.node.width = this.width;
    this.node.height = this.height;
    this.x = 0;
    this.y = 0;
    this.hp = 1;
    this.maxHp = 1;
    this.defeated = false;
    this.lastHitDirection = 0;
    this.deathVelocityY = 0;
    this.deathVelocityX = 0;
    this.deathSpin = 0;
    this.dying = false;
    this.hitFlight = null;
    this.idleFrameIndex = 0;
    this.idleFrameElapsed = 0;
    this.deathVelocityX = 0;
    this.deathVelocityY = 0;
  }

  configure(hp = 1) {
    this.maxHp = hp;
    this.hp = hp;
    this.defeated = false;
    this.lastHitDirection = 0;
    this.dying = false;
    this.hitFlight = null;
    this.idleFrameIndex = 0;
    this.idleFrameElapsed = 0;
    this.node.rotation = 0;
    this.node.alpha = 1;
    this.node.scale.set(1, 1);
    this.setFrame(0);
    if (this.platform.hubEntryOnly || this.platform.spawnContent?.enemy === false) {
      this.node.visible = false;
      return;
    }
    if (this.node.parent !== this.platform.node) this.platform.node.addChild(this.node);
    this.x = clamp((this.platform.width - this.width) * 0.5, 1, Math.max(1, this.platform.width - this.width - 1));
    this.y = -this.height;
    this.node.visible = true;
    this.render();
  }

  update(deltaSeconds) {
    if (this.dying) {
      this.setFrame(3);
      this.deathVelocityY += DEATH_GRAVITY * deltaSeconds;
      this.node.position.x += this.deathVelocityX * deltaSeconds;
      this.node.position.y += this.deathVelocityY * deltaSeconds;
      this.node.rotation += this.deathSpin * deltaSeconds;
      if (this.node.position.y > this.worldHeight + 24) {
        this.node.visible = false;
        this.dying = false;
      }
      return;
    }
    if (this.hitFlight) {
      this.setFrame(4);
      this.hitFlight.elapsed += deltaSeconds;
      const progress = Math.min(1, this.hitFlight.elapsed / HIT_FLIGHT_DURATION);
      const arc = 4 * HIT_JUMP_HEIGHT * progress * (1 - progress);
      this.node.position.set(
        this.hitFlight.startX + this.hitFlight.offsetX * progress,
        this.hitFlight.startY - arc,
      );
      if (progress >= 1) {
        this.x = clamp(
          this.x + this.hitFlight.offsetX,
          1,
          Math.max(1, this.platform.width - this.width - 1),
        );
        this.hitFlight = null;
        this.idleFrameIndex = 0;
        this.idleFrameElapsed = 0;
        this.setFrame(0);
        this.render();
      }
      return;
    }
    this.updateIdleAnimation(deltaSeconds);
    this.render();
  }

  tryHit(previousCenterX, currentCenterX, playerTop, playerBottom, direction) {
    if (this.defeated || this.hitFlight || !this.node.visible || !this.platform.active || playerBottom < this.platform.y - 1 || playerTop > this.platform.y + 2) return false;
    const centerX = this.platform.x + this.x + this.width * 0.5;
    const crossed = (previousCenterX < centerX && currentCenterX >= centerX)
      || (previousCenterX > centerX && currentCenterX <= centerX);
    if (!crossed || direction === 0 || (this.maxHp > 1 && this.lastHitDirection === direction)) return false;
    this.lastHitDirection = direction;
    this.game.audio.hit();
    this.hp -= this.game.player.damage || 1;
    this.node.scale.x *= -1;
    if (this.hp <= 0) {
      this.defeated = true;
      this.game.audio.bonus();
      this.dying = true;
      const worldX = this.platform.x + this.x;
      const worldY = this.platform.y + this.y;
      this.worldRoot.addChild(this.node);
      this.node.position.set(worldX + this.width * 0.5, worldY + this.height * 0.5);
      this.node.alpha = 1;
      this.deathVelocityX = direction > 0 ? 30 : -30;
      this.deathVelocityY = DEATH_VELOCITY_Y;
      this.deathSpin = direction > 0 ? 18 : -18;
      this.setFrame(3);
      return true;
    }
    this.hitFlight = {
      elapsed: 0,
      startX: this.node.position.x,
      startY: this.node.position.y,
      offsetX: (Math.random() < 0.5 ? -1 : 1) * randomBetween(1, 2),
    };
    return false;
  }

  setFrame(index) {
    this.node.texture = this.frames[index];
  }

  updateIdleAnimation(deltaSeconds) {
    this.idleFrameElapsed += deltaSeconds;
    while (this.idleFrameElapsed >= IDLE_FRAME_DURATION) {
      this.idleFrameElapsed -= IDLE_FRAME_DURATION;
      this.idleFrameIndex = (this.idleFrameIndex + 1) % 3;
      this.setFrame(this.idleFrameIndex);
    }
  }

  render() {
    if (!this.node.visible) return;
    this.node.position.set(this.x + this.width * 0.5, this.y + this.height * 0.5);
  }

  resetForRecycle() {
    this.dying = false;
    this.hitFlight = null;
    this.defeated = false;
    this.node.removeFromParent();
    this.node.visible = false;
    this.node.rotation = 0;
    this.node.alpha = 1;
    this.node.scale.set(1, 1);
  }
}

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.enemies = [];
    this.previousPlayerCenterX = 0;
    const frameCount = 5;
    const frameGap = 0;
    const frameWidth = Math.floor(
      (game.textures.enemyTexture.width - frameGap * (frameCount - 1)) / frameCount,
    );
    this.frames = Array.from({ length: frameCount }, (_, index) => new Texture({
      source: game.textures.enemyTexture.source,
      frame: new Rectangle(
        index * (frameWidth + frameGap),
        0,
        frameWidth,
        game.textures.enemyTexture.height,
      ),
    }));
    for (let index = 0; index < game.platformPool.items.length; index += 1) {
      const enemy = new Enemy(
        game,
        game.platformPool.items[index],
        game.worldRoot,
        game.config.world.height,
        this.frames,
      );
      enemy.configure(3);
      this.enemies.push(enemy);
    }
    for (const enemy of this.enemies) {
      const previousBeforeRecycle = enemy.platform.beforeRecycle;
      enemy.platform.beforeRecycle = () => {
        previousBeforeRecycle?.();
        enemy.resetForRecycle();
      };
    }
  }

  reset() {
    for (const enemy of this.enemies) {
      enemy.worldHeight = this.game.config.world.height;
      enemy.configure(3);
    }
    this.previousPlayerCenterX = this.game.player.x + this.game.player.width * 0.5;
  }

  update(deltaSeconds) {
    const player = this.game.player;
    const currentCenterX = player.x + player.width * 0.5;
    const direction = Math.sign(currentCenterX - this.previousPlayerCenterX);
    for (const enemy of this.enemies) {
      if (enemy.platform.recycledThisFrame && !enemy.dying) {
        if (enemy.platform.portalPlatform) enemy.node.visible = false;
        else if (enemy.platform.spawnContent?.enemy) enemy.configure(3);
        else enemy.node.visible = false;
      }
      const defeated = enemy.tryHit(
        this.previousPlayerCenterX,
        currentCenterX,
        player.y,
        player.y + player.height,
        direction,
      );
      if (defeated) {
        this.game.crystalManager.spawnBurstCoins(
          enemy.platform.node,
          enemy.x + enemy.width * 0.5,
          0,
          3,
          enemy.platform,
        );
      }
      enemy.update(deltaSeconds);
    }
    this.previousPlayerCenterX = currentCenterX;
  }
}
