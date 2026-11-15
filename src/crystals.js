import { Rectangle, Sprite, Text, Texture } from 'pixi.js';

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function overlaps(first, second) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

class CrystalEntity {
  constructor(game, platform, frames, config, side, uiRoot, target) {
    this.game = game;
    this.platform = platform;
    this.config = config;
    this.side = side;
    this.uiRoot = uiRoot;
    this.target = target;
    this.frames = frames;
    this.frameIndex = 0;
    this.frameElapsed = 0;
    this.node = new Sprite(frames[0]);
    this.node.label = `crystal-${side}`;
    this.node.width = frames[0].width;
    this.node.height = frames[0].height;
    this.node.visible = false;
    this.platform.node.addChild(this.node);
    this.active = false;
    this.flight = null;
    this.pendingSpawn = false;
  }

  hide() {
    if (this.flight) return;
    this.active = false;
    this.node.visible = false;
  }

  attachToPlatform() {
    if (this.node.parent !== this.platform.node) this.platform.node.addChild(this.node);
    this.node.scale.set(1);
  }

  reset() {
    this.flight = null;
    this.pendingSpawn = false;
    this.active = false;
    this.frameIndex = 0;
    this.frameElapsed = 0;
    this.node.texture = this.frames[0];
    this.node.visible = false;
    this.attachToPlatform();
  }

  prepareForRespawn() {
    this.pendingSpawn = false;
    this.active = false;
    if (!this.flight) {
      this.node.visible = false;
      this.attachToPlatform();
    }
  }

  cancelPendingSpawn() {
    this.pendingSpawn = false;
    if (!this.flight) this.node.visible = false;
  }

  scheduleSpawn() {
    if (this.flight) {
      this.pendingSpawn = true;
      return;
    }
    this.spawn();
  }

  spawn() {
    if (this.flight) return;
    this.pendingSpawn = false;
    this.attachToPlatform();
    const availableWidth = Math.max(0, this.platform.width - this.node.width);
    const edgeZone = Math.min(this.config.edgeZone, availableWidth);
    const minimumX = this.side === 'left'
      ? 0
      : Math.max(0, availableWidth - edgeZone);
    const maximumX = this.side === 'left'
      ? edgeZone
      : availableWidth;
    const x = Math.floor(randomBetween(minimumX, maximumX + 1));
    this.node.position.set(x, -this.node.height - this.config.platformGap);
    this.node.visible = true;
    this.active = true;
  }

  updateAnimation(deltaSeconds) {
    this.frameElapsed += deltaSeconds;
    while (this.frameElapsed >= this.config.frameDuration) {
      this.frameElapsed -= this.config.frameDuration;
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.node.texture = this.frames[this.frameIndex];
    }
  }

  collect() {
    if (!this.active || this.flight) return;
    this.active = false;
    this.game.audio.reward();
    this.frameIndex = 0;
    this.frameElapsed = 0;
    this.node.texture = this.frames[0];
    const bounceHeight = randomBetween(
      this.config.chestJumpMinHeight,
      this.config.chestJumpMaxHeight,
    ) * (this.config.crystalCollectBounceHeight / 14);
    const bounceVelocityY = -Math.sqrt(2 * this.config.chestGravity * bounceHeight);
    const firstBounceDistanceShare = this.config.burstCoinFirstBounceDistanceShare ?? 0.7;
    const secondBounceHeight = bounceHeight * (this.config.burstCoinSecondBounceHeightMultiplier ?? 0.3);
    const landingY = this.node.position.y;
    const globalPosition = this.node.toGlobal({
      x: this.node.width * 0.5,
      y: this.node.height * 0.5,
    });
    const localPosition = this.uiRoot.toLocal(globalPosition);
    const crystalCenterX = this.node.x + this.node.width * 0.5;
    const platformCenterX = this.platform.width * 0.5;
    const direction = Math.sign(platformCenterX - crystalCenterX) || (Math.random() < 0.5 ? -1 : 1);
    const bounceDuration = (
      -bounceVelocityY + Math.sqrt(
        bounceVelocityY ** 2 + 2 * this.config.chestGravity * (landingY - this.node.position.y),
      )
    ) / this.config.chestGravity;
    this.flight = {
      phase: 'bounce',
      elapsed: 0,
      startX: this.node.position.x,
      startY: this.node.position.y,
      landingY,
      bounceCount: 1,
      firstBounceDistanceShare,
      secondBounceHeight,
      totalOffsetX: direction * this.config.crystalCollectBounceDistance,
      velocityX: direction * this.config.crystalCollectBounceDistance
        * firstBounceDistanceShare / bounceDuration,
      velocityY: bounceVelocityY,
    };
  }

  updateFlight(deltaSeconds) {
    if (!this.flight) return false;
    if (this.flight.phase === 'bounce') {
      this.node.position.x += this.flight.velocityX * deltaSeconds;
      this.node.position.y += this.flight.velocityY * deltaSeconds;
      this.flight.velocityY += this.config.chestGravity * deltaSeconds;
      if (this.node.position.y >= this.flight.landingY) {
        this.node.position.y = this.flight.landingY;
        if (this.flight.bounceCount === 1) this.startSecondBounce();
        else this.startCounterFlight();
      }
      return false;
    }
    this.flight.elapsed += deltaSeconds;
    const progress = Math.min(1, this.flight.elapsed / this.config.flightDuration);
    const easedProgress = 1 - (1 - progress) ** 3;
    const targetX = this.target.x - this.node.width * 0.5;
    const targetY = this.target.y - this.node.height * 0.5;
    this.node.position.set(
      this.flight.startX + (targetX - this.flight.startX) * easedProgress,
      this.flight.startY + (targetY - this.flight.startY) * easedProgress,
    );
    if (progress < 1) return false;
    const shouldRespawn = this.pendingSpawn && this.platform.active;
    this.flight = null;
    this.pendingSpawn = false;
    this.node.visible = false;
    this.attachToPlatform();
    if (shouldRespawn) this.spawn();
    return true;
  }

  startSecondBounce() {
    this.flight.bounceCount = 2;
    this.flight.velocityY = -Math.sqrt(2 * this.config.chestGravity * this.flight.secondBounceHeight);
    const bounceDuration = (2 * -this.flight.velocityY) / this.config.chestGravity;
    const remainingOffset = this.flight.totalOffsetX * (1 - this.flight.firstBounceDistanceShare);
    this.flight.velocityX = remainingOffset / bounceDuration;
  }

  startCounterFlight() {
    const globalPosition = this.node.toGlobal({
      x: this.node.width * 0.5,
      y: this.node.height * 0.5,
    });
    this.uiRoot.addChild(this.node);
    const localPosition = this.uiRoot.toLocal(globalPosition);
    this.node.position.set(
      localPosition.x - this.node.width * 0.5,
      localPosition.y - this.node.height * 0.5,
    );
    this.flight.phase = 'counter';
    this.flight.elapsed = 0;
    this.flight.startX = this.node.position.x;
    this.flight.startY = this.node.position.y;
    this.frameIndex = 0;
    this.frameElapsed = 0;
    this.node.texture = this.frames[0];
  }

  getWorldBounds() {
    return {
      x: this.platform.x + this.node.x,
      y: this.platform.y + this.node.y,
      width: this.node.width,
      height: this.node.height,
    };
  }
}

class BurstCoin {
  constructor(manager, parent, centerX, floorY, offsetX, platformEntity = null, jumpHeightMultiplier = 1) {
    this.manager = manager;
    this.parent = parent;
    this.platformEntity = platformEntity;
    this.frames = manager.frames;
    this.config = manager.config;
    this.node = new Sprite(this.frames[0]);
    this.node.label = 'chest-coin';
    this.node.width = this.frames[0].width;
    this.node.height = this.frames[0].height;
    const startY = floorY - this.config.chestCoinHeightOffset - this.node.height;
    const startX = centerX - this.node.width * 0.5;
    this.node.position.set(startX, startY);
    this.parent.addChild(this.node);
    this.phase = 'burst';
    this.firstBounceDistanceShare = this.config.burstCoinFirstBounceDistanceShare ?? 0.7;
    this.secondBounceHeightMultiplier = this.config.burstCoinSecondBounceHeightMultiplier ?? 0.5;
    this.totalOffsetX = offsetX;
    const jumpHeight = randomBetween(this.config.chestJumpMinHeight, this.config.chestJumpMaxHeight) * jumpHeightMultiplier;
    this.velocityY = -Math.sqrt(2 * this.config.chestGravity * jumpHeight);
    this.landingY = floorY - this.node.height;
    const verticalDistance = this.landingY - startY;
    const landingTime = (
      Math.sqrt(this.velocityY ** 2 + 2 * this.config.chestGravity * verticalDistance)
      - this.velocityY
    ) / this.config.chestGravity;
    this.velocityX = (offsetX * this.firstBounceDistanceShare) / landingTime;
    this.secondBounceHeight = jumpHeight * this.secondBounceHeightMultiplier;
    this.landDelay = 0;
    this.elapsed = 0;
    this.frameIndex = 0;
    this.frameElapsed = 0;
    this.counted = false;
  }

  update(deltaSeconds) {
    if (this.phase === 'burst') {
      this.node.position.x += this.velocityX * deltaSeconds;
      this.node.position.y += this.velocityY * deltaSeconds;
      this.velocityY += this.config.chestGravity * deltaSeconds;
      if (this.node.position.y >= this.landingY) {
        this.node.position.y = this.landingY;
        this.startSecondBounce();
      }
      return false;
    }

    if (this.phase === 'bounce') {
      this.node.position.x += this.velocityX * deltaSeconds;
      this.node.position.y += this.velocityY * deltaSeconds;
      this.velocityY += this.config.chestGravity * deltaSeconds;
      if (this.node.position.y >= this.landingY) {
        this.node.position.y = this.landingY;
        this.startCounterFlight();
      }
      return false;
    }

    this.frameElapsed += deltaSeconds;
    while (this.frameElapsed >= this.config.frameDuration) {
      this.frameElapsed -= this.config.frameDuration;
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.node.texture = this.frames[this.frameIndex];
    }

    this.elapsed += deltaSeconds;
    const progress = Math.min(1, this.elapsed / this.config.flightDuration);
    const easedProgress = 1 - (1 - progress) ** 3;
    const targetX = this.manager.target.x - this.node.width * 0.5;
    const targetY = this.manager.target.y - this.node.height * 0.5;
    this.node.position.set(
      this.startX + (targetX - this.startX) * easedProgress,
      this.startY + (targetY - this.startY) * easedProgress,
    );
    if (progress < 1) return false;

    if (this.counted) return false;
    this.counted = true;
    this.node.removeFromParent();
    return true;
  }

  startSecondBounce() {
    this.phase = 'bounce';
    this.velocityY = -Math.sqrt(2 * this.config.chestGravity * this.secondBounceHeight);
    const bounceDuration = (2 * -this.velocityY) / this.config.chestGravity;
    const remainingOffset = this.totalOffsetX * (1 - this.firstBounceDistanceShare);
    this.velocityX = remainingOffset / bounceDuration;
  }

  detachFromPlatform() {
    if (!this.platformEntity || this.parent !== this.platformEntity.node) return;
    const globalPosition = this.node.toGlobal({
      x: this.node.width * 0.5,
      y: this.node.height * 0.5,
    });
    const globalLanding = this.platformEntity.node.toGlobal({ x: 0, y: this.landingY });
    const worldRoot = this.manager.game.worldRoot;
    worldRoot.addChild(this.node);
    const localPosition = worldRoot.toLocal(globalPosition);
    const localLanding = worldRoot.toLocal(globalLanding);
    this.node.position.set(
      localPosition.x - this.node.width * 0.5,
      localPosition.y - this.node.height * 0.5,
    );
    this.landingY = localLanding.y;
    this.parent = worldRoot;
    this.platformEntity = null;
  }

  startCounterFlight() {
    const globalPosition = this.node.toGlobal({
      x: this.node.width * 0.5,
      y: this.node.height * 0.5,
    });
    this.manager.uiRoot.addChild(this.node);
    const localPosition = this.manager.uiRoot.toLocal(globalPosition);
    this.node.position.set(
      localPosition.x - this.node.width * 0.5,
      localPosition.y - this.node.height * 0.5,
    );
    this.phase = 'counter';
    this.elapsed = 0;
    this.startX = this.node.position.x;
    this.startY = this.node.position.y;
    this.frameIndex = 0;
    this.frameElapsed = 0;
    this.node.texture = this.frames[0];
  }
}

export class CrystalManager {
  constructor(game, texture, uiRoot) {
    this.game = game;
    this.config = game.config.crystals;
    this.uiRoot = uiRoot;
    this.count = this.config.startingCount || 0;
    const frameWidth = Math.floor(texture.width / this.config.frameCount);
    this.frames = Array.from({ length: this.config.frameCount }, (_, index) => new Texture({
      source: texture.source,
      frame: new Rectangle(index * frameWidth, 0, frameWidth, texture.height),
    }));
    this.counterRoot = new Sprite(this.frames[0]);
    this.counterRoot.label = 'crystal-counter-icon';
    this.counterRoot.width = this.frames[0].width;
    this.counterRoot.height = this.frames[0].height;
    this.counterRoot.position.set(4, 4);
    this.counterLabel = new Text({
      text: '0',
      resolution: 4,
      roundPixels: true,
      style: { fontFamily: 'monospace', fontSize: 8, fontWeight: 'bold', fill: 0xffffff },
    });
    this.counterLabel.position.set(13, 3);
    this.uiRoot.addChild(this.counterRoot, this.counterLabel);
    this.target = { x: 4 + this.frames[0].width * 0.5, y: 4 + this.frames[0].height * 0.5 };
    this.burstCoins = [];
    this.crystalsByPlatform = game.platformPool.items.map((platform) => ({
      platform,
      left: new CrystalEntity(game, platform, this.frames, this.config, 'left', uiRoot, this.target),
      right: new CrystalEntity(game, platform, this.frames, this.config, 'right', uiRoot, this.target),
    }));
    for (const platform of game.platformPool.items) {
      const previousBeforeRecycle = platform.beforeRecycle;
      platform.beforeRecycle = () => {
        previousBeforeRecycle?.();
        this.detachBurstCoins(platform);
      };
    }
  }

  reset() {
    this.clearBurstCoins();
    this.count = this.config.startingCount || 0;
    this.updateCounter();
    for (const group of this.crystalsByPlatform) {
      group.left.reset();
      group.right.reset();
      this.spawnForPlatform(group);
    }
  }

  update(deltaSeconds) {
    if (!this.config.enabled) return;

    for (const group of this.crystalsByPlatform) {
      if (group.platform.recycledThisFrame) {
        this.spawnForPlatform(group);
      }
      group.left.updateAnimation(deltaSeconds);
      group.right.updateAnimation(deltaSeconds);
      this.collectFromPlayer(group);
      this.updateFlight(group.left, deltaSeconds);
      this.updateFlight(group.right, deltaSeconds);
    }
    for (let index = this.burstCoins.length - 1; index >= 0; index -= 1) {
      if (this.burstCoins[index].update(deltaSeconds)) {
        this.awardCrystal();
        this.burstCoins.splice(index, 1);
      }
    }
  }

  clearBurstCoins() {
    for (const coin of this.burstCoins) coin.node.removeFromParent();
    this.burstCoins.length = 0;
  }

  clearPlatform(platform) {
    const group = this.crystalsByPlatform.find((candidate) => candidate.platform === platform);
    if (!group) return;
    group.left.reset();
    group.right.reset();
  }

  spawnBurstCoins(parent, centerX, floorY, count = this.config.chestCoinCount, platformEntity = null) {
    const spacing = this.config.chestCoinMinimumGap * (this.config.burstCoinHorizontalSpreadMultiplier || 1);
    const centerOffset = (count - 1) * 0.5;
    const centerJump = this.config.burstCoinCenterJumpMultiplier ?? 1.5;
    const edgeJump = this.config.burstCoinEdgeJumpMultiplier ?? 0.75;
    const curve = this.config.burstCoinJumpCurve ?? 2;
    const maximumDistance = Math.max(1, centerOffset);
    for (let index = 0; index < count; index += 1) {
      const offsetX = (index - centerOffset) * spacing;
      const distance = Math.abs(index - centerOffset) / maximumDistance;
      const centerWeight = (1 - distance) ** curve;
      const jumpHeightMultiplier = edgeJump + (centerJump - edgeJump) * centerWeight;
      this.burstCoins.push(new BurstCoin(this, parent, centerX, floorY, offsetX, platformEntity, jumpHeightMultiplier));
    }
  }

  detachBurstCoins(platform) {
    for (const coin of this.burstCoins) {
      if (coin.platformEntity === platform) coin.detachFromPlatform();
    }
  }

  updateFlight(crystal, deltaSeconds) {
    if (crystal.updateFlight(deltaSeconds)) {
      this.awardCrystal();
    }
  }

  awardCrystal() {
    this.count += 1;
    this.updateCounter();
  }

  updateCounter() {
    this.counterLabel.text = String(this.count);
  }

  spawnForPlatform(group) {
    const { platform, left, right } = group;
    if (platform.portalPlatform || platform.hubEntryOnly || platform.spawnContent?.crystals === false) {
      left.reset();
      right.reset();
      return;
    }
    left.prepareForRespawn();
    right.prepareForRespawn();
    if (!platform.active) {
      left.cancelPendingSpawn();
      right.cancelPendingSpawn();
      return;
    }
    const touchesLeftWall = platform.x === 0;
    const touchesRightWall = platform.x + platform.width >= this.game.config.world.width;
    if (touchesLeftWall) {
      left.cancelPendingSpawn();
      right.scheduleSpawn();
      return;
    }
    if (touchesRightWall) {
      left.scheduleSpawn();
      right.cancelPendingSpawn();
      return;
    }
    left.scheduleSpawn();
    right.scheduleSpawn();
  }

  collectFromPlayer(group) {
    const player = this.game.player;
    const playerBounds = {
      x: player.x,
      y: player.y,
      width: player.width,
      height: player.height,
    };
    for (const crystal of [group.left, group.right]) {
      if (crystal.active && overlaps(playerBounds, crystal.getWorldBounds())) {
        crystal.collect();
      }
    }
  }
}
