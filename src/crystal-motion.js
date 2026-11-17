const randomBetween = (min, max) => min + Math.random() * (max - min);

export class CrystalMotion {
  constructor(game, entity) {
    this.game = game;
    this.entity = entity;
  }

  reset() {
    const entity = this.entity;
    entity.collecting = false;
    entity.phase = 'idle';
    entity.bounces = 0;
    entity.platform = null;
    entity.active = false;
    entity.renderOffsetY = 0;
    entity.rotation = 0;
  }

  collect() {
    const entity = this.entity;
    if (!entity.active || entity.collecting) return;
    const platform = entity.platform;
    if (platform) platform.crystals = platform.crystals.filter((crystal) => crystal !== entity);
    entity.collecting = true;
    entity.phase = 'bounce';
    entity.bounces = 0;
    entity.floorY = entity.y;
    entity.elapsed = 0;
    entity.startX = entity.x;
    entity.startY = entity.y;
    const crystals = this.game.config.crystals;
    const height = randomBetween(crystals.chestJumpMinHeight, crystals.chestJumpMaxHeight)
      * (crystals.crystalCollectBounceHeight / 14);
    entity.secondBounceHeight = height * (crystals.burstCoinSecondBounceHeightMultiplier ?? 0.3);
    entity.velocityY = -Math.sqrt(2 * crystals.chestGravity * height);
    const platformCenter = platform ? platform.x + platform.width / 2 : this.game.config.world.width / 2;
    const direction = Math.sign(platformCenter - entity.x) || (Math.random() < 0.5 ? -1 : 1);
    entity.totalOffsetX = direction * crystals.crystalCollectBounceDistance * 0.5;
    entity.firstBounceDistanceShare = crystals.burstCoinFirstBounceDistanceShare ?? 0.7;
    entity.velocityX = 0;
  }

  startBurst(x, floorY, index, count, platform) {
    const entity = this.entity;
    const crystals = this.game.config.crystals;
    const centerOffset = (count - 1) * 0.5;
    // All burst crystals share one origin. The horizontal spread is expressed
    // only through their launch velocities, so they still fan out in flight.
    const spreadOffsetX = (index - centerOffset) * crystals.chestCoinMinimumGap * (crystals.burstCoinHorizontalSpreadMultiplier || 1) * 0.5;
    const distance = Math.abs(index - centerOffset) / Math.max(1, centerOffset);
    const curve = crystals.burstCoinJumpCurve ?? 2;
    const centerWeight = (1 - distance) ** curve;
    const jumpMultiplier = (crystals.burstCoinEdgeJumpMultiplier ?? 0.75)
      + ((crystals.burstCoinCenterJumpMultiplier ?? 1.5) - (crystals.burstCoinEdgeJumpMultiplier ?? 0.75)) * centerWeight;
    const jumpHeight = randomBetween(crystals.chestJumpMinHeight, crystals.chestJumpMaxHeight) * jumpMultiplier;
    entity.x = x - entity.width / 2;
    entity.y = floorY;
    entity.floorY = floorY;
    entity.platform = platform;
    entity.velocityX = spreadOffsetX * (crystals.burstCoinFirstBounceDistanceShare ?? 0.7);
    entity.velocityY = -Math.sqrt(2 * crystals.chestGravity * jumpHeight);
    entity.secondBounceHeight = jumpHeight * (crystals.burstCoinSecondBounceHeightMultiplier ?? 0.3);
    entity.phase = 'burst';
    entity.rotation = 0;
    entity.rotationSpeed = (index % 2 === 0 ? 1 : -1) * (crystals.rotationSpeed ?? 1.8);
    entity.renderOffsetY = 0;
    entity.bounces = 0;
    entity.elapsed = 0;
    entity.counted = false;
    const firstBounceDuration = 2 * -entity.velocityY / crystals.chestGravity;
    entity.velocityX /= Math.max(firstBounceDuration, 0.001);
    entity.active = true;
    entity.view.visible = true;
  }

  update(deltaSeconds) {
    const entity = this.entity;
    if (!entity.active) return;
    if (entity.kind === 'crystal' && !entity.collecting) return;
    const crystals = this.game.config.crystals;
    if (entity.platform && (entity.kind === 'burst' || entity.collecting)) {
      const platformDelta = entity.platform.y - entity.platform.previousY;
      entity.y += platformDelta;
      const platformOffset = entity.kind === 'crystal' ? (entity.platformOffset ?? 0) : 0;
      entity.floorY = entity.platform.y - platformOffset;
    }
    if (entity.phase === 'counter') {
      entity.elapsed += deltaSeconds;
      const progress = Math.min(1, entity.elapsed / crystals.flightDuration);
      const eased = 1 - (1 - progress) ** 3;
      entity.x = entity.startX + (6 - entity.startX) * eased;
      entity.y = entity.startY + (8 - entity.startY) * eased;
      if (progress >= 1) {
        entity.collecting = false;
        entity.active = false;
        entity.phase = 'idle';
        entity.platform = null;
        entity.view.visible = false;
        this.game.crystalCount += 1;
      }
      return;
    }
    entity.x += entity.velocityX * deltaSeconds;
    entity.y += entity.velocityY * deltaSeconds;
    entity.velocityY += crystals.chestGravity * deltaSeconds;
    if (entity.y < entity.floorY) return;
    entity.y = entity.floorY;
    if (entity.bounces === 0) {
      entity.bounces = 1;
      entity.phase = 'bounce';
      entity.velocityY = -Math.sqrt(2 * crystals.chestGravity * entity.secondBounceHeight);
      const duration = 2 * -entity.velocityY / crystals.chestGravity;
      const totalOffset = entity.kind === 'crystal' ? entity.totalOffsetX : entity.velocityX;
      const firstShare = entity.kind === 'crystal' ? entity.firstBounceDistanceShare : (crystals.burstCoinFirstBounceDistanceShare ?? 0.7);
      entity.velocityX = totalOffset * (1 - firstShare) / Math.max(duration, 0.001);
      return;
    }
    entity.phase = 'counter';
    entity.elapsed = 0;
    entity.startX = entity.x;
    entity.startY = entity.y;
    entity.platform = null;
  }
}
