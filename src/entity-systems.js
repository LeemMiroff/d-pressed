const overlap = (first, second) => (
  first.x < second.x + second.width
  && first.x + first.width > second.x
  && first.y < second.y + second.height
  && first.y + first.height > second.y
);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function updateEnemyEntity(game, entity, deltaSeconds) {
  if (!entity.active) return;
  if (entity.dying) {
    entity.deathVelocityY += 440 * deltaSeconds;
    entity.x += entity.deathVelocityX * deltaSeconds;
    if (entity.deathDepthRemaining > 0) {
      const depthStep = Math.min(entity.deathVelocityZ * deltaSeconds, entity.deathDepthRemaining);
      entity.renderOffsetZ += depthStep;
      entity.deathDepthRemaining -= depthStep;
    }
    entity.y += entity.deathVelocityY * deltaSeconds;
    entity.rotation += entity.deathRotation * deltaSeconds;
    if (entity.y - entity.height > game.worldHeight + 24) {
      entity.dying = false;
      entity.active = false;
      entity.platform = null;
      entity.view.visible = false;
    }
    return;
  }
  if (entity.defeated) return;
  if (!entity.platform) {
    entity.active = false;
    entity.view.visible = false;
    return;
  }

  const wasHitFlight = entity.hitFlightTimer > 0;
  entity.y = entity.platform.y;
  entity.hitTimer = Math.max(0, entity.hitTimer - deltaSeconds);
  entity.hitFlightTimer = Math.max(0, entity.hitFlightTimer - deltaSeconds);
  if (entity.hitFlightTimer > 0) {
    const progress = 1 - entity.hitFlightTimer / 0.18;
    entity.renderOffsetX = entity.hitFlightOffsetX * progress;
    entity.renderOffsetY = 16 * progress * (1 - progress);
  } else {
    if (wasHitFlight && entity.hitFlightOffsetX && entity.platform) {
      const minX = entity.platform.x + 1;
      const maxX = entity.platform.x + entity.platform.width - entity.width - 1;
      entity.x = clamp(entity.x + entity.hitFlightOffsetX, minX, Math.max(minX, maxX));
    }
    entity.renderOffsetX = 0;
    entity.renderOffsetY = 0;
    if (entity.fleeing) {
      const direction = Math.sign(entity.x + entity.width / 2 - game.player.x - game.player.width / 2)
        || entity.lastHitDirection;
      const minX = entity.platform.x;
      const maxX = Math.max(minX, minX + entity.platform.width - entity.width);
      entity.x = clamp(entity.x + direction * game.config.enemies.fleeing.speed * deltaSeconds, minX, maxX);
    }
  }
  if (entity.hitTimer === 0 && entity.hitFlightTimer === 0 && overlap(game.player, {
    x: entity.x,
    y: entity.y - entity.height,
    width: entity.width,
    height: entity.height,
  })) {
    const stomp = game.player.vy > 0 && game.player.y + game.player.height <= entity.y + 2;
    game.hitEnemy(entity, stomp);
  }
  if ((entity.hitTimer > 0 || entity.hitFlightTimer > 0) && entity.view.material?.emissive) entity.view.material.emissive.setHex(0xffd66b);
  else if (entity.view.material?.emissive) entity.view.material.emissive.setHex(0x000000);
}

export function updateCollectibleEntity(game, entity, deltaSeconds, state) {
  if (entity.kind === 'crystal') {
    if (!state.collectedCrystalThisFrame && entity.active && !entity.collecting && overlap(game.player, {
      x: entity.x,
      y: entity.y - entity.height,
      width: entity.width,
      height: entity.height,
    })) {
      entity.motion.collect();
      state.collectedCrystalThisFrame = true;
    }
    if (entity.collecting) entity.motion.update(deltaSeconds);
    game.updateCrystalAnimation(entity, deltaSeconds);
    return;
  }

  if (entity.kind === 'chest' && entity.active && overlap(game.player, {
    x: entity.x,
    y: entity.y - entity.height,
    width: entity.width,
    height: entity.height,
  })) {
    entity.active = false;
    entity.view.visible = false;
    game.spawnBurst(entity.x + entity.width / 2, entity.y, game.config.crystals.chestCoinCount, entity.platform);
  }
  if (entity.kind === 'burst' && entity.active) entity.motion.update(deltaSeconds);
  if (entity.kind === 'burst') game.updateCrystalAnimation(entity, deltaSeconds);
}
