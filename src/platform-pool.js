import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

export class PlatformEntity {
  constructor(config, texture, worldWidth) {
    this.config = config;
    this.worldWidth = worldWidth;
    this.node = new Container({ label: 'platform' });
    this.hitboxShape = new Graphics();
    this.node.addChild(this.hitboxShape);
    this.texture = texture;
    this.leftTexture = new Texture({
      source: texture.source,
      frame: new Rectangle(0, 0, 1, texture.height),
    });
    this.centerTexture = new Texture({
      source: texture.source,
      frame: new Rectangle(1, 0, 1, texture.height),
    });
    this.rightTexture = new Texture({
      source: texture.source,
      frame: new Rectangle(2, 0, 1, texture.height),
    });
    this.leftEdge = new Sprite(this.leftTexture);
    this.center = new Sprite(this.centerTexture);
    this.rightEdge = new Sprite(this.rightTexture);
    this.node.addChild(this.leftEdge, this.center, this.rightEdge);
    this.active = false;
    this.recycledThisFrame = false;
    this.previousY = 0;
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = config.height;
    this.beforeRecycle = null;
    this.allowWallContact = false;
    this.hubEntryOnly = false;
    this.patternType = 'SINGLE';
    this.patternIndex = 0;
    this.spawnContent = { enemy: false, crystals: false, chest: false };
  }

  configure(x, y, width, allowWallContact = false) {
    let spawnX = Math.round(x);
    const spawnY = Math.round(y);
    const maximumX = this.worldWidth - width;
    spawnX = Math.max(0, Math.min(maximumX, spawnX));
    this.allowWallContact = allowWallContact;
    if (!allowWallContact) {
      const edgeClearance = this.config.edgeClearance;
      if (spawnX > 0 && spawnX < edgeClearance) {
        spawnX = 0;
      } else if (spawnX < maximumX && spawnX > maximumX - edgeClearance) {
        spawnX = maximumX;
      } else {
        spawnX = Math.max(edgeClearance, Math.min(maximumX - edgeClearance, spawnX));
      }
    }
    this.active = true;
    this.recycledThisFrame = false;
    this.x = spawnX;
    this.y = spawnY;
    this.previousY = spawnY;
    this.width = width;
    this.node.visible = true;
    this.hitboxShape.clear()
      .rect(0, 0, width, this.height)
      .fill({ color: 0xff3b30, alpha: 0.04 })
      .stroke({ width: 0.5, color: 0xff3b30, alpha: 0.9 });
    this.hitboxShape.visible = this.showHitboxes;
    this.node.position.set(spawnX, spawnY);
    this.leftEdge.width = 1;
    this.leftEdge.height = this.height;
    const touchesLeftWall = spawnX === 0;
    const touchesRightWall = spawnX + width >= this.worldWidth;
    this.leftEdge.visible = !touchesLeftWall;
    this.rightEdge.visible = !touchesRightWall;
    const leftInset = touchesLeftWall ? 0 : 1;
    const rightInset = touchesRightWall ? 0 : 1;
    this.center.width = Math.max(1, width - leftInset - rightInset);
    this.center.height = this.height;
    this.rightEdge.width = 1;
    this.rightEdge.height = this.height;
    this.leftEdge.position.set(0, 0);
    this.center.position.set(leftInset, 0);
    this.rightEdge.position.set(width - 1, 0);
    if (!touchesLeftWall && !touchesRightWall) {
      this.leftEdge.position.set(0, 0);
      this.rightEdge.position.set(width - 1, 0);
    }
  }

  setHitboxVisible(visible) {
    this.showHitboxes = visible;
    this.hitboxShape.visible = visible;
  }

  moveTo(x, y) {
    this.x = x;
    this.y = y;
    this.node.position.set(x, y);
  }

  deactivate() {
    this.active = false;
    this.node.visible = false;
  }
}

export class PlatformPool {
  constructor(parent, config, worldConfig, playerConfig, texture) {
    this.parent = parent;
    this.config = config;
    this.worldConfig = worldConfig;
    this.playerConfig = playerConfig;
    this.items = [];
    this.showHitboxes = false;
    this.initialStates = [];
    this.groups = [];
    this.progression = 0;
    this.pairProgression = 0;
    this.patternCount = 0;
    this.lastPatternType = null;
    this.patternRepeatCount = 0;
    this.activeRunTime = 0;

    for (let index = 0; index < config.poolSize; index += 1) {
      const platform = new PlatformEntity(config, texture, worldConfig.width);
      platform.showHitboxes = this.showHitboxes;
      parent.addChild(platform.node);
      this.items.push(platform);
    }
  }

  setHitboxVisible(visible) {
    this.showHitboxes = visible;
    for (const platform of this.items) platform.setHitboxVisible(visible);
  }

  initialize(preserveProgress = false) {
    let previousPlatform = null;
    let y = this.config.startY;
    this.initialStates.length = 0;
    this.groups = [];
    if (!preserveProgress) {
      this.patternCount = 0;
      this.lastPatternType = null;
      this.patternRepeatCount = 0;
    }

    for (let index = 0; index < this.items.length; index += 1) {
      const startPlatformIndex = this.playerConfig.startPlatformIndex;
      const wouldPairStartPlatform = index === startPlatformIndex || index + 1 === startPlatformIndex;
      const requestedType = this.choosePatternType();
      const canPair = index < this.items.length - 1
        && index % 2 === 0
        && !wouldPairStartPlatform
        && this.config.enablePairedPlatforms
        && requestedType === 'DOUBLE';
      if (canPair) {
        if (previousPlatform) {
          y -= randomBetween(this.config.minGap, this.config.maxGap);
        }
        const leftWidth = this.randomWidth();
        const rightWidth = this.randomWidth();
        const minimumGap = 16;
        const availableWidth = this.worldConfig.width - minimumGap;
        const widthScale = Math.min(1, availableWidth / (leftWidth + rightWidth));
        const scaledLeftWidth = Math.floor(leftWidth * widthScale);
        const scaledRightWidth = Math.floor(rightWidth * widthScale);
        const leftPlatform = this.items[index];
        const rightPlatform = this.items[index + 1];
        leftPlatform.configure(0, y, scaledLeftWidth, true);
        rightPlatform.configure(this.worldConfig.width - scaledRightWidth, y, scaledRightWidth, true);
        this.initialStates.push(
          { x: leftPlatform.x, y: leftPlatform.y, width: leftPlatform.width },
          { x: rightPlatform.x, y: rightPlatform.y, width: rightPlatform.width },
        );
        this.groups.push([leftPlatform, rightPlatform]);
        this.configurePatternContent([leftPlatform, rightPlatform], 'DOUBLE');
        if (!preserveProgress) this.registerPattern('DOUBLE');
        previousPlatform = rightPlatform;
        index += 1;
        continue;
      }
      const platform = this.items[index];
      const isEarly = this.progression < 1;
      const useSmall = isEarly && Math.random() < this.config.earlySmallChance;
      const width = isEarly && !useSmall ? this.randomProgressiveWidth() : this.randomWidth();

      if (previousPlatform) {
        const gap = randomBetween(this.config.minGap, this.config.maxGap);
        y -= gap;
        const x = requestedType === 'WALL'
          ? (Math.random() < 0.5 ? 0 : this.worldConfig.width - width)
          : isEarly && !useSmall
            ? this.randomPlatformX(width)
          : this.reachableX(previousPlatform, width, gap);
        platform.configure(x, y, width, true);
      } else {
        const x = requestedType === 'WALL'
          ? (Math.random() < 0.5 ? 0 : this.worldConfig.width - width)
          : this.randomPlatformX(width);
        platform.configure(x, y, width, true);
      }

      previousPlatform = platform;
      this.initialStates.push({
        x: platform.x,
        y: platform.y,
        width: platform.width,
      });
      this.groups.push([platform]);
      const patternType = requestedType === 'WALL' ? 'WALL' : 'SINGLE';
      platform.patternType = patternType;
      this.configurePatternContent([platform], patternType);
      if (!preserveProgress) this.registerPattern(patternType);
    }
    this.assignGroupSlots();
  }

  assignGroupSlots() {
    const slotHeight = this.config.height + this.config.minGap;
    const startPlatform = this.items[this.playerConfig.startPlatformIndex];
    const startGroupIndex = this.groups.findIndex((group) => group.includes(startPlatform));
    for (let index = 0; index < this.groups.length; index += 1) {
      let y;
      if (index === startGroupIndex) {
        y = this.config.startY - slotHeight;
      } else if (index < startGroupIndex) {
        y = this.config.startY + (startGroupIndex - index - 1) * slotHeight;
      } else {
        y = this.config.startY + (index - startGroupIndex) * slotHeight;
      }
      for (const platform of this.groups[index]) {
        platform.moveTo(platform.x, y);
        const state = this.initialStates[this.items.indexOf(platform)];
        if (state) state.y = y;
      }
    }
  }

  prepareRouteBelow(anchorY) {
    const activeGroups = this.groups.filter((group) => group.every((platform) => platform.active));
    const entryGroup = activeGroups.find((group) => group.length === 1) || activeGroups[0];
    if (!entryGroup) return null;

    for (const platform of this.items) {
      platform.hubEntryOnly = false;
      platform.routeStaged = false;
      platform.portalPlatform = false;
      platform.node.visible = true;
    }

    // The hub is followed by exactly one short platform at the right wall.
    let y = anchorY + this.config.height + randomBetween(this.config.minGap, this.config.maxGap);
    const entry = entryGroup[0];
    const entryWidth = Math.floor(this.worldConfig.width * 0.4);
    entry.configure(this.worldConfig.width - entryWidth, y, entryWidth, true);
    entry.recycledThisFrame = true;
    entry.hubEntryOnly = true;
    entry.routeStaged = true;
    for (const platform of entryGroup) platform.node.visible = true;

    // Rebuild the rest using the normal gap range and fully random placement.
    for (const group of activeGroups) {
      if (group === entryGroup) continue;
      y += this.config.height + randomBetween(this.config.minGap, this.config.maxGap);
      if (group.length > 1) {
        const leftWidth = this.randomWidth();
        const rightWidth = this.randomWidth();
        const scale = Math.min(1, (this.worldConfig.width - 16) / (leftWidth + rightWidth));
        const scaledLeft = Math.floor(leftWidth * scale);
        const scaledRight = Math.floor(rightWidth * scale);
        group[0].configure(0, y, scaledLeft, true);
        group[1].configure(this.worldConfig.width - scaledRight, y, scaledRight, true);
      } else {
        const platform = group[0];
        const width = this.progression < 1 ? this.randomProgressiveWidth() : this.randomWidth();
        const x = this.randomPlatformX(width);
        platform.configure(x, y, width, true);
      }
      for (const platform of group) {
        platform.recycledThisFrame = true;
        platform.node.visible = true;
      }
    }

    return entry;
  }

  reset() {
    for (let index = 0; index < this.items.length; index += 1) {
      const platform = this.items[index];
      const initialState = this.initialStates[index];
      platform.configure(initialState.x, initialState.y, initialState.width, platform.allowWallContact);
      platform.recycledThisFrame = false;
    }
  }

  updateMovement(deltaSeconds, worldSpeed) {
    for (const platform of this.items) {
      platform.recycledThisFrame = false;

      if (!platform.active) {
        continue;
      }

      platform.previousY = platform.y;
      platform.moveTo(platform.x, platform.y - worldSpeed * deltaSeconds);
    }
  }

  clearRecycleFlags() {
    for (const platform of this.items) platform.recycledThisFrame = false;
  }

  recycleOffscreen() {
    const isOffscreen = (group) => group.every((platform) => platform.active && platform.y + platform.height < 0);
    const findLowestPlatform = (excludedGroup) => this.groups.reduce((result, group) => {
      if (group === excludedGroup || !group.every((platform) => platform.active)) return result;
      const lowest = group.reduce((candidate, platform) => (!candidate || platform.y > candidate.y ? platform : candidate), null);
      return !result || lowest.y > result.y ? lowest : result;
    }, null);

    while (true) {
      let group = this.groups.find(isOffscreen);
      if (!group) return;
      const lowestPlatform = findLowestPlatform(group);
      if (!lowestPlatform) {
        group.forEach((platform) => {
          platform.beforeRecycle?.();
          platform.deactivate();
        });
        continue;
      }
      const gap = randomBetween(this.config.minGap, this.config.maxGap);
      const y = lowestPlatform.y + this.config.height + gap;
      const groupIndex = this.groups.indexOf(group);
      let requestedType = this.choosePatternType();
      if (!this.config.enablePairedPlatforms && requestedType === 'DOUBLE') requestedType = 'SINGLE';
      if (group.length === 1 && requestedType === 'DOUBLE') {
        const partner = this.groups.find((candidate) => candidate !== group && candidate.length === 1 && isOffscreen(candidate));
        if (partner) {
          const originalGroup = group;
          group = [group[0], partner[0]];
          group.isPortalPair = false;
          this.groups.splice(this.groups.indexOf(partner), 1);
          this.groups.splice(this.groups.indexOf(originalGroup), 1, group);
          requestedType = 'DOUBLE';
        } else {
          requestedType = 'SINGLE';
        }
      }
      group.forEach((platform) => platform.beforeRecycle?.());
      group.forEach((platform) => {
        platform.hubEntryOnly = false;
        platform.portalPlatform = false;
      });
      if (group.length > 1 && requestedType !== 'DOUBLE') {
        const first = group[0];
        const second = group[1];
        const firstWidth = this.progression < 1 ? this.randomProgressiveWidth() : this.randomWidth();
        const secondWidth = this.progression < 1 ? this.randomProgressiveWidth() : this.randomWidth();
        const firstX = requestedType === 'WALL'
          ? (Math.random() < 0.5 ? 0 : this.worldConfig.width - firstWidth)
          : this.randomPlatformX(firstWidth);
        const secondY = y + this.config.height + this.config.minGap;
        first.configure(firstX, y, firstWidth, true);
        second.configure(this.randomPlatformX(secondWidth), secondY, secondWidth, true);
        const firstGroup = [first];
        const secondGroup = [second];
        this.groups.splice(this.groups.indexOf(group), 1, firstGroup, secondGroup);
        this.configurePatternContent(firstGroup, requestedType);
        this.configurePatternContent(secondGroup, requestedType);
        this.registerPattern(requestedType);
        this.registerPattern(requestedType);
        first.recycledThisFrame = true;
        second.recycledThisFrame = true;
        continue;
      }
      if (group.length > 1) {
        const leftWidth = this.randomWidth();
        const rightWidth = this.randomWidth();
        const scale = Math.min(1, (this.worldConfig.width - 16) / (leftWidth + rightWidth));
        const scaledLeftWidth = Math.floor(leftWidth * scale);
        const scaledRightWidth = Math.floor(rightWidth * scale);
        group[0].configure(0, y, scaledLeftWidth, true);
        group[1].configure(this.worldConfig.width - scaledRightWidth, y, scaledRightWidth, true);
      } else {
        const width = this.progression < 1 ? this.randomProgressiveWidth() : this.randomWidth();
        const x = requestedType === 'WALL'
          ? (Math.random() < 0.5 ? 0 : this.worldConfig.width - width)
          : Math.random() < 0.5
            ? this.randomPlatformX(width)
          : this.reachableX(lowestPlatform, width, gap);
        group[0].configure(x, y, width, true);
      }
      const type = requestedType;
      this.configurePatternContent(group, type);
      this.registerPattern(type);
      group.forEach((platform) => { platform.recycledThisFrame = true; });
    }
  }

  createPortalPair() {
    const candidates = this.groups
      .filter((group) => group.length === 1 && group[0].active)
      .sort((first, second) => second[0].y - first[0].y);
    if (candidates.length < 2) return null;

    const firstGroup = candidates[0];
    const secondGroup = candidates[1];
    const first = firstGroup[0];
    const second = secondGroup[0];
    const candidateY = Math.max(first.y, second.y);
    const previousY = this.groups.reduce((nearest, group) => {
      if (group === firstGroup || group === secondGroup || !group.every((platform) => platform.active)) {
        return nearest;
      }
      const groupY = Math.max(...group.map((platform) => platform.y));
      return groupY < candidateY && groupY > nearest ? groupY : nearest;
    }, -Infinity);
    const baseY = Number.isFinite(previousY)
      ? previousY + this.config.height + randomBetween(this.config.minGap, this.config.maxGap)
      : candidateY;
    first.beforeRecycle?.();
    second.beforeRecycle?.();
    first.portalPlatform = true;
    second.portalPlatform = true;
    first.spawnContent = { enemy: false, crystals: false, chest: false };
    second.spawnContent = { enemy: false, crystals: false, chest: false };
    const portalWidthRatio = Math.max(0.2, Math.min(0.49, this.config.hubPortal?.platformWidthRatio || 0.4));
    const leftWidth = Math.floor(this.worldConfig.width * portalWidthRatio);
    const rightWidth = Math.floor(this.worldConfig.width * portalWidthRatio);
    first.configure(0, baseY, leftWidth, true);
    second.configure(this.worldConfig.width - rightWidth, baseY, rightWidth, true);
    first.recycledThisFrame = true;
    second.recycledThisFrame = true;

    const firstIndex = this.groups.indexOf(firstGroup);
    const secondIndex = this.groups.indexOf(secondGroup);
    const insertIndex = Math.min(firstIndex, secondIndex);
    this.groups = this.groups.filter((group) => group !== firstGroup && group !== secondGroup);
    const pair = [first, second];
    pair.isPortalPair = true;
    this.groups.splice(insertIndex, 0, pair);
    return pair;
  }

  randomWidth() {
    const scale = this.currentPlatformScale();
    const minimum = Math.max(8, Math.floor(this.config.minWidth));
    const maximum = Math.max(minimum, Math.floor(this.config.maxWidth * scale));
    return Math.floor(randomBetween(minimum, maximum + 1));
  }

  randomPlatformX(width) {
    const maximumX = this.worldConfig.width - width;
    const clearance = this.config.edgeClearance;
    if (maximumX <= clearance * 2 || Math.random() < 0.35) {
      return Math.random() < 0.5 ? 0 : maximumX;
    }
    return Math.floor(randomBetween(clearance, maximumX - clearance + 1));
  }

  randomEarlyWidth() {
    return Math.floor(randomBetween(this.config.earlyWideMinWidth, this.config.earlyWideMaxWidth + 1));
  }

  setProgression(elapsedSeconds) {
    this.activeRunTime = Math.max(0, elapsedSeconds);
    this.progression = Math.min(1, elapsedSeconds / this.config.platformProgressionDuration);
    this.pairProgression = Math.min(1, elapsedSeconds / this.config.pairedPlatformDuration);
  }

  currentPlatformScale() {
    const size = this.config.platformSize || {};
    const startScale = Number.isFinite(size.startScale) ? size.startScale : 1;
    const minScale = Number.isFinite(size.minScale) ? size.minScale : 0.55;
    const duration = Number.isFinite(size.shrinkDurationSeconds) ? size.shrinkDurationSeconds : 0;
    if (duration > 0) {
      const progress = Math.min(1, this.activeRunTime / duration);
      return startScale + (minScale - startScale) * progress;
    }
    const shrink = Number.isFinite(size.shrinkPerPattern) ? size.shrinkPerPattern : 0;
    return Math.max(minScale, startScale - this.patternCount * shrink);
  }

  choosePatternType() {
    const weights = this.config.patternWeights || { SINGLE: 1, WALL: 0, DOUBLE: 0 };
    const candidates = ['SINGLE', 'WALL', 'DOUBLE'];
    let available = candidates.filter((type) => type !== 'DOUBLE' || this.config.enablePairedPlatforms);
    if (this.lastPatternType && this.patternRepeatCount >= (this.config.maxPatternRepeat ?? 2)) {
      available = available.filter((type) => type !== this.lastPatternType);
    }
    const total = available.reduce((sum, type) => sum + Math.max(0, Number(weights[type]) || 0), 0);
    if (!total) return available[0] || 'SINGLE';
    let roll = Math.random() * total;
    for (const type of available) {
      roll -= Math.max(0, Number(weights[type]) || 0);
      if (roll <= 0) return type;
    }
    return available[available.length - 1];
  }

  registerPattern(type) {
    this.patternCount += 1;
    if (this.lastPatternType === type) this.patternRepeatCount += 1;
    else {
      this.lastPatternType = type;
      this.patternRepeatCount = 1;
    }
  }

  configurePatternContent(group, type) {
    const content = this.config.content?.[type] || {};
    if (type === 'DOUBLE') {
      const variants = content.variants?.length ? content.variants : [{ weight: 1, enemy: { guaranteed: true, side: 'random' }, oppositeSide: {} }];
      const total = variants.reduce((sum, variant) => sum + Math.max(0, Number(variant.weight) || 0), 0);
      let roll = Math.random() * (total || 1);
      let variant = variants[0];
      for (const candidate of variants) {
        roll -= Math.max(0, Number(candidate.weight) || 0);
        if (roll <= 0) { variant = candidate; break; }
      }
      const enemySide = variant.enemy?.side === 'left' ? 0 : variant.enemy?.side === 'right' ? 1 : Math.random() < 0.5 ? 0 : 1;
      const opposite = variant.oppositeSide || {};
      const chest = Math.random() < (Number(opposite.chestChance) || 0);
      const crystal = !chest && Math.random() < (Number(opposite.crystalChanceIfNoChest) || 0);
      group.forEach((platform, index) => {
        platform.patternType = type;
        platform.spawnContent = { enemy: Boolean(variant.enemy?.guaranteed) && index === enemySide, crystals: crystal && index !== enemySide, chest: chest && index !== enemySide };
      });
      return;
    }
    const enemy = Math.random() < (Number(content.enemyChance) || 0);
    const crystals = Math.random() < (Number(content.crystalChance) || 0);
    const chest = Math.random() < (Number(content.chestChance) || 0);
    for (const platform of group) {
      platform.patternType = type;
      platform.spawnContent = { enemy, crystals, chest };
    }
  }

  randomProgressiveWidth() {
    const scale = this.currentPlatformScale();
    const minWidth = Math.max(this.config.minWidth, (this.config.earlySingleMinWidth + (this.config.minWidth - this.config.earlySingleMinWidth) * this.progression) * scale);
    const maxWidth = Math.max(minWidth, (this.config.earlySingleMaxWidth + (this.config.maxWidth - this.config.earlySingleMaxWidth) * this.progression) * scale);
    return Math.floor(randomBetween(minWidth, maxWidth + 1));
  }

  reachableX(previousPlatform, width, gap) {
    const fallTime = Math.sqrt((2 * gap) / this.playerConfig.gravity);
    const maximumReach = this.playerConfig.maxHorizontalSpeed * fallTime + 8;
    const previousCenter = previousPlatform.x + previousPlatform.width / 2;
    const targetCenter = previousCenter + randomBetween(-maximumReach, maximumReach);
    const maximumX = this.worldConfig.width - width;
    const candidate = Math.max(0, Math.min(maximumX, targetCenter - width / 2));
    const margin = this.config.wallMargin;

    if (candidate < margin) {
      return 0;
    }

    if (candidate > maximumX - margin) {
      return maximumX;
    }

    return candidate;
  }
}
