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

  initialize() {
    let previousPlatform = null;
    let y = this.config.startY;
    this.initialStates.length = 0;
    this.groups = [];

    for (let index = 0; index < this.items.length; index += 1) {
      const startPlatformIndex = this.playerConfig.startPlatformIndex;
      const wouldPairStartPlatform = index === startPlatformIndex || index + 1 === startPlatformIndex;
      const canPair = index < this.items.length - 1
        && index % 2 === 0
        && !wouldPairStartPlatform
        && this.config.enablePairedPlatforms
        && Math.random() < this.config.pairedPlatformChance * (1 - this.pairProgression);
      if (canPair) {
        if (previousPlatform) {
          y -= randomBetween(this.config.minGap, this.config.maxGap);
        }
        const leftWidth = Math.floor(randomBetween(28, 58));
        const rightWidth = Math.floor(randomBetween(28, 58));
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
        const x = isEarly && !useSmall
          ? this.randomPlatformX(width)
          : this.reachableX(previousPlatform, width, gap);
        platform.configure(x, y, width, true);
      } else {
        const x = this.randomPlatformX(width);
        platform.configure(x, y, width, true);
      }

      previousPlatform = platform;
      this.initialStates.push({
        x: platform.x,
        y: platform.y,
        width: platform.width,
      });
      this.groups.push([platform]);
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
      const group = this.groups.find(isOffscreen);
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
      group.forEach((platform) => platform.beforeRecycle?.());
      group.forEach((platform) => {
        platform.hubEntryOnly = false;
        platform.portalPlatform = false;
      });
      if (group.length > 1) {
        if (this.pairProgression >= 1 && !group.isPortalPair) {
          const first = group[0];
          const second = group[1];
          const firstWidth = this.randomWidth();
          const secondWidth = this.randomWidth();
          first.configure(this.reachableX(lowestPlatform, firstWidth, gap), y, firstWidth, true);
          const secondY = y + this.config.height + this.config.minGap;
          second.configure(this.reachableX(first, secondWidth, this.config.minGap), secondY, secondWidth, true);
          first.recycledThisFrame = true;
          second.recycledThisFrame = true;
          this.groups.splice(groupIndex, 1, [first], [second]);
          continue;
        }
        const leftWidth = Math.floor(randomBetween(28, 58));
        const rightWidth = Math.floor(randomBetween(28, 58));
        const scale = Math.min(1, (this.worldConfig.width - 16) / (leftWidth + rightWidth));
        const scaledLeftWidth = Math.floor(leftWidth * scale);
        const scaledRightWidth = Math.floor(rightWidth * scale);
        group[0].configure(0, y, scaledLeftWidth, true);
        group[1].configure(this.worldConfig.width - scaledRightWidth, y, scaledRightWidth, true);
      } else {
        const width = this.progression < 1 ? this.randomProgressiveWidth() : this.randomWidth();
        const x = Math.random() < 0.5
          ? this.randomPlatformX(width)
          : this.reachableX(lowestPlatform, width, gap);
        group[0].configure(x, y, width, true);
      }
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
    const leftWidth = this.randomWidth();
    const rightWidth = this.randomWidth();
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
    return Math.floor(randomBetween(this.config.minWidth, this.config.maxWidth + 1));
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
    this.progression = Math.min(1, elapsedSeconds / this.config.platformProgressionDuration);
    this.pairProgression = Math.min(1, elapsedSeconds / this.config.pairedPlatformDuration);
  }

  randomProgressiveWidth() {
    const minWidth = this.config.earlySingleMinWidth + (this.config.minWidth - this.config.earlySingleMinWidth) * this.progression;
    const maxWidth = this.config.earlySingleMaxWidth + (this.config.maxWidth - this.config.earlySingleMaxWidth) * this.progression;
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
