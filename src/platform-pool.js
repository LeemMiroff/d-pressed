import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

class PlatformEntity {
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
  }

  configure(x, y, width) {
    let spawnX = Math.round(x);
    const spawnY = Math.round(y);
    const maximumX = this.worldWidth - width;
    if (spawnX > 0 && spawnX < this.config.wallMargin) {
      spawnX = 0;
    } else if (spawnX < maximumX && spawnX > maximumX - this.config.wallMargin) {
      spawnX = maximumX;
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

    for (let index = 0; index < this.items.length; index += 1) {
      const canPair = index < this.items.length - 1
        && index % 2 === 0
        && Math.random() < this.config.pairedPlatformChance;
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
        leftPlatform.configure(0, y, scaledLeftWidth);
        rightPlatform.configure(this.worldConfig.width - scaledRightWidth, y, scaledRightWidth);
        this.initialStates.push(
          { x: leftPlatform.x, y: leftPlatform.y, width: leftPlatform.width },
          { x: rightPlatform.x, y: rightPlatform.y, width: rightPlatform.width },
        );
        previousPlatform = rightPlatform;
        index += 1;
        continue;
      }
      const platform = this.items[index];
      const isEarly = index < this.config.earlyPlatformCount;
      const useSmall = isEarly && Math.random() < this.config.earlySmallChance;
      const width = isEarly && !useSmall ? this.randomEarlyWidth() : this.randomWidth();

      if (previousPlatform) {
        const gap = randomBetween(this.config.minGap, this.config.maxGap);
        y -= gap;
        const x = isEarly && !useSmall
          ? (index % 2 === 0 ? 0 : this.worldConfig.width - width)
          : this.reachableX(previousPlatform, width, gap);
        platform.configure(x, y, width);
      } else {
        const x = Math.floor(randomBetween(0, this.worldConfig.width - width));
        platform.configure(x, y, width);
      }

      previousPlatform = platform;
      this.initialStates.push({
        x: platform.x,
        y: platform.y,
        width: platform.width,
      });
    }
    this.rebuildGroups();
    this.normalizeGroupSpacing();
  }

  rebuildGroups() {
    const groupsByY = new Map();
    for (const platform of this.items) {
      const key = platform.y;
      if (!groupsByY.has(key)) groupsByY.set(key, []);
      groupsByY.get(key).push(platform);
    }
    this.groups = [...groupsByY.values()];
    for (const group of this.groups) {
      if (group.length < 2) continue;
      group.sort((first, second) => first.x - second.x);
      group[0].moveTo(0, group[0].y);
      group[1].moveTo(this.worldConfig.width - group[1].width, group[1].y);
      const firstState = this.initialStates[this.items.indexOf(group[0])];
      const secondState = this.initialStates[this.items.indexOf(group[1])];
      if (firstState) firstState.x = group[0].x;
      if (secondState) secondState.x = group[1].x;
    }
  }

  normalizeGroupSpacing() {
    const sortedGroups = [...this.groups].sort((first, second) => second[0].y - first[0].y);
    if (sortedGroups.length === 0) return;
    const anchorY = sortedGroups[0][0].y;
    const slotHeight = this.config.height + this.config.minGap;
    for (let index = 0; index < sortedGroups.length; index += 1) {
      const targetY = anchorY - index * slotHeight;
      for (const platform of sortedGroups[index]) {
        platform.moveTo(platform.x, targetY);
        const state = this.initialStates[this.items.indexOf(platform)];
        if (state) state.y = targetY;
      }
    }
  }

  reset() {
    for (let index = 0; index < this.items.length; index += 1) {
      const platform = this.items[index];
      const initialState = this.initialStates[index];
      platform.configure(initialState.x, initialState.y, initialState.width);
      platform.recycledThisFrame = false;
    }
    this.rebuildGroups();
    this.normalizeGroupSpacing();
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

  recycleOffscreen() {
    const activeGroups = this.groups.filter((group) => group.some((platform) => platform.active && platform.y + platform.height >= 0));
    const lowestGroup = activeGroups.reduce((result, group) => {
      const lowest = group.reduce((candidate, platform) => (!candidate || platform.y > candidate.y ? platform : candidate), null);
      return !result || lowest.y > result.y ? lowest : result;
    }, null);
    for (const group of this.groups) {
      if (!group.every((platform) => platform.active && platform.y + platform.height < 0)) continue;
      if (!lowestGroup) {
        group.forEach((platform) => platform.deactivate());
        continue;
      }
      const gap = randomBetween(this.config.minGap, this.config.maxGap);
      const y = lowestGroup.y + this.config.height + gap;
      if (group.length > 1) {
        const leftWidth = Math.floor(randomBetween(28, 58));
        const rightWidth = Math.floor(randomBetween(28, 58));
        const scale = Math.min(1, (this.worldConfig.width - 16) / (leftWidth + rightWidth));
        const scaledLeftWidth = Math.floor(leftWidth * scale);
        const scaledRightWidth = Math.floor(rightWidth * scale);
        group[0].configure(0, y, scaledLeftWidth);
        group[1].configure(this.worldConfig.width - scaledRightWidth, y, scaledRightWidth);
      } else {
        const width = Math.random() < 0.32 ? Math.floor(randomBetween(34, 52)) : this.randomWidth();
        const x = this.reachableX(lowestGroup, width, gap);
        group[0].configure(x, y, width);
      }
      group.forEach((platform) => { platform.recycledThisFrame = true; });
    }
  }

  randomWidth() {
    return Math.floor(randomBetween(this.config.minWidth, this.config.maxWidth + 1));
  }

  randomEarlyWidth() {
    return Math.floor(randomBetween(this.config.earlyWideMinWidth, this.config.earlyWideMaxWidth + 1));
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
