import { Graphics } from 'pixi.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class Enemy {
  constructor(platform, worldRoot, worldHeight) {
    this.platform = platform;
    this.worldRoot = worldRoot;
    this.worldHeight = worldHeight;
    this.node = new Graphics({ label: 'enemy' });
    this.node.zIndex = 10;
    platform.node.addChild(this.node);
    this.width = 7;
    this.height = 7;
    this.node.pivot.set(this.width * 0.5, this.height * 0.5);
    this.x = 0;
    this.y = 0;
    this.hp = 1;
    this.maxHp = 1;
    this.defeated = false;
    this.lastHitDirection = 0;
    this.flashTime = 0;
    this.deathVelocityY = 0;
    this.deathVelocityX = 0;
    this.deathSpin = 0;
    this.dying = false;
    this.deathVelocityX = 0;
    this.deathVelocityY = 0;
  }

  configure(hp = 1) {
    this.maxHp = hp;
    this.hp = hp;
    this.defeated = false;
    this.lastHitDirection = 0;
    this.flashTime = 0;
    this.dying = false;
    this.node.rotation = 0;
    this.node.alpha = 1;
    if (this.node.parent !== this.platform.node) this.platform.node.addChild(this.node);
    this.x = clamp((this.platform.width - this.width) * 0.5, 1, Math.max(1, this.platform.width - this.width - 1));
    this.y = -this.height;
    this.node.visible = true;
    this.render();
  }

  update(deltaSeconds) {
    if (this.dying) {
      this.deathVelocityY += 220 * deltaSeconds;
      this.node.position.x += this.deathVelocityX * deltaSeconds;
      this.node.position.y += this.deathVelocityY * deltaSeconds;
      this.node.rotation += this.deathSpin * deltaSeconds;
      if (this.node.position.y > this.worldHeight + 24) {
        this.node.visible = false;
      }
      return;
    }
    this.flashTime = Math.max(0, this.flashTime - deltaSeconds);
    this.render();
  }

  tryHit(previousCenterX, currentCenterX, playerTop, playerBottom, direction) {
    if (this.defeated || !this.platform.active || playerBottom < this.platform.y - 1 || playerTop > this.platform.y + 2) return;
    const centerX = this.platform.x + this.x + this.width * 0.5;
    const crossed = (previousCenterX < centerX && currentCenterX >= centerX)
      || (previousCenterX > centerX && currentCenterX <= centerX);
    if (!crossed || direction === 0 || (this.maxHp > 1 && this.lastHitDirection === direction)) return;
    this.lastHitDirection = direction;
    this.hp -= 1;
    this.flashTime = 0.12;
    if (this.hp <= 0) {
      this.defeated = true;
      this.dying = true;
      const worldX = this.platform.x + this.x;
      const worldY = this.platform.y + this.y;
      this.worldRoot.addChild(this.node);
      this.node.position.set(worldX + this.width * 0.5, worldY + this.height * 0.5);
      this.node.alpha = 1;
      this.deathVelocityX = direction > 0 ? 30 : -30;
      this.deathVelocityY = -110;
      this.deathSpin = direction > 0 ? 18 : -18;
    }
  }

  render() {
    if (!this.node.visible) return;
    const bodyColor = this.flashTime > 0 ? 0xfff0b5 : this.maxHp > 1 ? 0xd77991 : 0xc34f6b;
    this.node.clear()
      .rect(0, 1, this.width, this.height - 1).fill(bodyColor)
      .rect(1, 0, this.width - 2, 1).fill(0xf3d6d0)
      .rect(1.5, 2, 1, 1).fill(0x351f28)
      .rect(this.width - 2.5, 2, 1, 1).fill(0x351f28);
    this.node.position.set(this.x + this.width * 0.5, this.y + this.height * 0.5);
  }
}

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.enemies = [];
    this.previousPlayerCenterX = 0;
    for (let index = 0; index < game.platformPool.items.length; index += 1) {
      if (index % 2 !== 1) continue;
      const enemy = new Enemy(game.platformPool.items[index], game.worldRoot, game.config.world.height);
      enemy.configure(3);
      this.enemies.push(enemy);
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
      if (enemy.platform.recycledThisFrame) enemy.configure(3);
      enemy.tryHit(this.previousPlayerCenterX, currentCenterX, player.y, player.y + player.height, direction);
      enemy.update(deltaSeconds);
    }
    this.previousPlayerCenterX = currentCenterX;
  }
}
