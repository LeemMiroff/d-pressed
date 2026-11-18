const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class PlatformGenerator {
  constructor({ config, player, random, randomBetween, getPlayerSpeed }) {
    this.config = config;
    this.player = player;
    this.random = random;
    this.randomBetween = randomBetween;
    this.getPlayerSpeed = getPlayerSpeed || (() => this.config.player.maxHorizontalSpeed);
  }

  spawnContent(type) {
    const rule = this.config.platforms.content[type] || {};
    if (type === 'DOUBLE') {
      return { enemy: true, crystals: this.random() < 0.6, chest: this.random() < 0.3 };
    }
    return {
      enemy: this.random() < (rule.enemyChance || 0),
      crystals: this.random() < (rule.crystalChance || 0),
      chest: this.random() < (rule.chestChance || 0),
    };
  }

  choosePattern(state) {
    const weights = this.config.platforms.patternWeights || { SINGLE: 1, WALL: 0, DOUBLE: 0 };
    let candidates = ['SINGLE', 'WALL', 'DOUBLE'].filter((type) => (
      type !== 'DOUBLE' || (this.config.platforms.enablePairedPlatforms && !state.doublePlatformsDisabled)
    ));
    if (state.lastPatternType && state.patternRepeatCount >= (this.config.platforms.maxPatternRepeat ?? 2)) {
      candidates = candidates.filter((type) => type !== state.lastPatternType);
    }
    const openingType = this.config.platforms.openingPatterns?.[state.patternCount];
    if (candidates.includes(openingType)) return openingType;
    const transitions = this.config.platforms.patternTransitions || {};
    if (state.lastPatternType === 'SINGLE' && candidates.includes('SINGLE')) {
      const chance = Number.isFinite(transitions.singleToOtherChance) ? transitions.singleToOtherChance : 0.75;
      candidates = this.random() < chance ? candidates.filter((type) => type !== 'SINGLE') : ['SINGLE'];
    } else if ((state.lastPatternType === 'WALL' || state.lastPatternType === 'DOUBLE') && candidates.includes('SINGLE') && candidates.includes(state.lastPatternType)) {
      const chance = Number.isFinite(transitions.wallOrDoubleToSingleChance) ? transitions.wallOrDoubleToSingleChance : 0.9;
      candidates = this.random() < chance
        ? candidates.filter((type) => type !== state.lastPatternType)
        : candidates.filter((type) => type === state.lastPatternType);
    }
    const diversified = candidates.filter((type) => !this.wouldRepeatPattern(state.patternHistory, type));
    if (diversified.length) candidates = diversified;
    const total = candidates.reduce((sum, type) => sum + Math.max(0, Number(weights[type]) || 0), 0);
    let roll = this.random() * (total || 1);
    for (const type of candidates) {
      roll -= Math.max(0, Number(weights[type]) || 0);
      if (roll <= 0) return type;
    }
    return candidates.at(-1) || 'SINGLE';
  }

  wouldRepeatPattern(history, candidate) {
    const sequence = [...history, candidate];
    const maximumPeriod = Math.min(4, Math.floor(sequence.length / 2));
    for (let period = 2; period <= maximumPeriod; period += 1) {
      let repeats = true;
      for (let offset = 0; offset < period; offset += 1) {
        const current = sequence.length - 1 - offset;
        if (sequence[current] !== sequence[current - period]) {
          repeats = false;
          break;
        }
      }
      if (repeats) return true;
    }
    return false;
  }

  currentPlatformScale(activeRunTime, patternCount) {
    const size = this.config.platforms.platformSize || {};
    const startScale = Number.isFinite(size.startScale) ? size.startScale : 1;
    const minScale = Number.isFinite(size.minScale) ? size.minScale : 0.55;
    const duration = Number.isFinite(size.shrinkDurationSeconds) ? size.shrinkDurationSeconds : 0;
    if (duration > 0) return startScale + (minScale - startScale) * Math.min(1, activeRunTime / duration);
    const shrink = Number.isFinite(size.shrinkPerPattern) ? size.shrinkPerPattern : 0;
    return Math.max(minScale, startScale - patternCount * shrink);
  }

  randomWidth(activeRunTime, patternCount) {
    const scale = this.currentPlatformScale(activeRunTime, patternCount);
    const minimum = Math.max(8, Math.floor(this.config.platforms.minWidth));
    const maximum = Math.max(minimum, Math.floor(this.config.platforms.maxWidth * scale));
    return Math.floor(this.randomBetween(minimum, maximum + 1));
  }

  randomProgressiveWidth(activeRunTime, patternCount) {
    const scale = this.currentPlatformScale(activeRunTime, patternCount);
    const progress = Math.min(1, activeRunTime / this.config.platforms.platformProgressionDuration);
    const minimum = Math.max(
      this.config.platforms.minWidth,
      (this.config.platforms.earlySingleMinWidth + (this.config.platforms.minWidth - this.config.platforms.earlySingleMinWidth) * progress) * scale,
    );
    const maximum = Math.max(
      minimum,
      (this.config.platforms.earlySingleMaxWidth + (this.config.platforms.maxWidth - this.config.platforms.earlySingleMaxWidth) * progress) * scale,
    );
    return Math.floor(this.randomBetween(minimum, maximum + 1));
  }

  randomPlatformX(width) {
    const maximumX = this.config.world.width - width;
    const clearance = Math.max(this.config.platforms.edgeClearance, this.player.width);
    if (maximumX <= clearance * 2 || this.random() < 0.35) return this.random() < 0.5 ? 0 : maximumX;
    return Math.floor(this.randomBetween(clearance, maximumX - clearance + 1));
  }

  randomWallX(width, lastWallSide, wallSideRepeatCount) {
    let side;
    let nextRepeatCount;
    if (!lastWallSide) {
      side = this.random() < 0.5 ? 'left' : 'right';
      nextRepeatCount = 1;
    } else {
      const sameSideChance = wallSideRepeatCount >= 2 ? 0 : 0.25;
      side = this.random() < sameSideChance ? lastWallSide : lastWallSide === 'left' ? 'right' : 'left';
      nextRepeatCount = side === lastWallSide ? wallSideRepeatCount + 1 : 1;
    }
    return {
      x: side === 'left' ? 0 : this.config.world.width - width,
      side,
      repeatCount: nextRepeatCount,
    };
  }

  reachableX(previousPlatform, width, gap) {
    const fallTime = Math.sqrt((2 * gap) / this.config.player.gravity);
    const maximumReach = this.getPlayerSpeed() * fallTime + 8;
    const previousCenter = previousPlatform.x + previousPlatform.width / 2;
    const targetCenter = previousCenter + this.randomBetween(-maximumReach, maximumReach);
    const maximumX = this.config.world.width - width;
    const candidate = clamp(targetCenter - width / 2, 0, maximumX);
    const margin = Math.max(this.config.platforms.wallMargin, this.player.width);
    const x = candidate < margin ? 0 : candidate > maximumX - margin ? maximumX : candidate;
    return this.avoidRepeatedWall(previousPlatform, x, width, gap);
  }

  singlePlacement(previousPlatform, requestedWidth, gap) {
    const clearance = Math.max(this.config.platforms.wallMargin, Math.ceil(this.player.width) + 1);
    const width = Math.min(requestedWidth, this.config.world.width - clearance * 2);
    const rightmostX = this.config.world.width - width - clearance;
    const fallTime = Math.sqrt(2 * gap / this.config.player.gravity);
    const reach = this.getPlayerSpeed() * fallTime + 8;
    const center = previousPlatform
      ? previousPlatform.x + previousPlatform.width / 2
      : this.config.world.width / 2;
    const offset = previousPlatform ? this.randomBetween(-reach, reach) : 0;
    return { width, x: clamp(Math.round(center + offset - width / 2), clearance, rightmostX) };
  }

  avoidRepeatedWall(previousPlatform, x, width, gap) {
    const worldWidth = this.config.world.width;
    const rightX = worldWidth - width;
    if (!previousPlatform || previousPlatform.patternType === 'DOUBLE' || rightX <= 0) return x;
    const repeatsLeft = x === 0 && previousPlatform.x === 0;
    const repeatsRight = x === rightX && previousPlatform.x + previousPlatform.width >= worldWidth;
    if (!repeatsLeft && !repeatsRight) return x;

    const oppositeX = repeatsLeft ? rightX : 0;
    const separation = Math.max(0, oppositeX - previousPlatform.x - previousPlatform.width, previousPlatform.x - oppositeX - width);
    const reach = this.getPlayerSpeed() * Math.sqrt(2 * gap / this.config.player.gravity);
    return separation <= reach ? oppositeX : x;
  }

  configureGroupContent(group, type) {
    if (!group.length) return;
    const rule = this.config.platforms.content[type] || {};
    if (type === 'DOUBLE') {
      const variants = Array.isArray(rule.variants) && rule.variants.length
        ? rule.variants
        : [{ weight: 1, enemy: { guaranteed: true, side: 'random' }, oppositeSide: {} }];
      const total = variants.reduce((sum, variant) => sum + Math.max(0, Number(variant.weight) || 0), 0);
      let roll = this.random() * (total || 1);
      let variant = variants[0];
      for (const candidate of variants) {
        roll -= Math.max(0, Number(candidate.weight) || 0);
        if (roll <= 0) {
          variant = candidate;
          break;
        }
      }
      const enemySide = variant.enemy?.side === 'left'
        ? 0
        : variant.enemy?.side === 'right'
          ? 1
          : this.random() < 0.5 ? 0 : 1;
      const opposite = variant.oppositeSide || {};
      const chest = this.random() < (Number(opposite.chestChance) || 0);
      const crystals = !chest && this.random() < (Number(opposite.crystalChanceIfNoChest) || 0);
      group.forEach((platform, index) => {
        platform.patternType = type;
        platform.spawnContent = {
          enemy: Boolean(variant.enemy?.guaranteed) && index === enemySide,
          crystals: crystals && index !== enemySide,
          chest: chest && index !== enemySide,
        };
      });
      return;
    }
    const content = this.spawnContent(type);
    group.forEach((platform) => {
      platform.patternType = type;
      platform.spawnContent = { ...content };
    });
  }
}
