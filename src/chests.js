import { Rectangle, Sprite, Texture } from 'pixi.js';

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function overlaps(first, second) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

class ChestEntity {
  constructor(manager, platform, frames) {
    this.manager = manager;
    this.platform = platform;
    this.frames = frames;
    this.node = new Sprite(frames[0]);
    this.node.label = 'chest';
    this.node.anchor.set(0.5, 1);
    this.node.width = frames[0].width;
    this.node.height = frames[0].height;
    this.node.visible = false;
    this.platform.node.addChild(this.node);
    this.active = false;
    this.opened = false;
    this.coinsSpawned = false;
    this.frameIndex = 0;
    this.frameElapsed = 0;
  }

  reset() {
    this.active = false;
    this.opened = false;
    this.coinsSpawned = false;
    this.frameIndex = 0;
    this.frameElapsed = 0;
    this.node.texture = this.frames[0];
    this.node.visible = false;
    this.node.scale.set(1);
    if (this.node.parent !== this.platform.node) this.platform.node.addChild(this.node);
  }

  spawn() {
    const maximumX = Math.max(0, this.platform.width - this.node.width);
    const leftX = Math.round(maximumX * 0.25);
    const rightX = Math.round(maximumX * 0.75);
    const candidates = Math.random() < 0.5
      ? [leftX, rightX]
      : [rightX, leftX];
    const x = candidates[0];
    const worldCenterX = this.platform.x + x + this.node.width * 0.5;
    this.node.position.set(x + this.node.width * 0.5, 0);
    this.node.scale.x = worldCenterX > this.manager.game.config.world.width * 0.5 ? -1 : 1;
    this.node.visible = true;
    this.active = true;
    this.opened = false;
    this.coinsSpawned = false;
    this.frameIndex = 0;
    this.frameElapsed = 0;
    this.node.texture = this.frames[0];
  }

  getBounds() {
    return {
      x: this.platform.x + this.node.x - this.node.width * 0.5,
      y: this.platform.y + this.node.y - this.node.height,
      width: this.node.width,
      height: this.node.height,
    };
  }

  open() {
    if (!this.active || this.opened) return;
    this.opened = true;
    this.active = false;
    this.frameIndex = 0;
    this.frameElapsed = 0;
    this.node.texture = this.frames[0];
  }

  update(deltaSeconds) {
    if (!this.opened) return;
    if (this.frameIndex >= this.frames.length - 1) return;

    this.frameElapsed += deltaSeconds;
    while (this.frameElapsed >= this.manager.config.frameDuration) {
      this.frameElapsed -= this.manager.config.frameDuration;
      this.frameIndex += 1;
      this.node.texture = this.frames[this.frameIndex];
      if (this.frameIndex === 5 && !this.coinsSpawned) {
        this.coinsSpawned = true;
        this.manager.game.crystalManager.spawnBurstCoins(
          this.platform.node,
          this.node.x,
          this.node.y,
          undefined,
          this.platform,
        );
      }
      if (this.frameIndex >= this.frames.length - 1) {
        return;
      }
    }
  }
}

export class ChestManager {
  constructor(game, texture) {
    this.game = game;
    this.config = game.config.chests;
    const frameWidth = Math.floor(texture.width / this.config.frameCount);
    this.frames = Array.from({ length: this.config.frameCount }, (_, index) => new Texture({
      source: texture.source,
      frame: new Rectangle(index * frameWidth, 0, frameWidth, texture.height),
    }));
    this.chests = game.platformPool.items.map(
      (platform) => new ChestEntity(this, platform, this.frames),
    );
  }

  reset() {
    for (const chest of this.chests) {
      chest.reset();
      this.spawnForPlatform(chest);
    }
  }

  clearPlatform(platform) {
    const chest = this.chests.find((candidate) => candidate.platform === platform);
    chest?.reset();
  }

  update(deltaSeconds) {
    for (const chest of this.chests) {
      if (chest.platform.recycledThisFrame) this.spawnForPlatform(chest);
      if (chest.active && overlaps(this.game.player, chest.getBounds())) chest.open();
      chest.update(deltaSeconds);
    }
  }

  spawnForPlatform(chest) {
    chest.reset();
    const isStartPlatform = chest.platform === this.game.player.groundedOn;
    if (chest.platform.active && !chest.platform.hubEntryOnly && (chest.platform.spawnContent?.chest || (isStartPlatform && chest.platform.spawnContent?.chest !== false))) {
      chest.spawn();
    }
  }
}
