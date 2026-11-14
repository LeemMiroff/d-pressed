import { Container, Graphics } from 'pixi.js';
import { PlatformEntity } from './platform-pool.js';

function overlaps(first, second) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

class PortalEntity {
  constructor(platform, side) {
    this.platform = platform;
    this.side = side;
    this.node = new Graphics({ label: `portal-${side}` });
    this.node.rect(0, 0, 4, 10).fill({ color: 0x9f6cff, alpha: 0.9 });
    this.node.rect(1, 1, 2, 8).fill({ color: 0x271d4b, alpha: 0.95 });
    this.syncPosition();
    platform.node.addChild(this.node);
  }

  syncPosition() {
    const maximumLocalX = Math.max(0, this.platform.width - 4);
    const maximumWorldX = Math.max(0, this.platform.worldWidth - this.platform.x - 4);
    const localX = this.side === 'left' ? 0 : Math.min(maximumLocalX, maximumWorldX);
    this.node.position.set(localX, -10);
  }

  getBounds() {
    this.syncPosition();
    return {
      x: this.platform.x + this.node.x,
      y: this.platform.y + this.node.y,
      width: 4,
      height: 10,
    };
  }

  destroy() {
    this.node.removeFromParent();
  }
}

export class PortalManager {
  constructor(game) {
    this.game = game;
    this.nextPortalTime = 60;
    this.portalPair = null;
    this.hubX = 0;
    this.hubWidth = game.config.world.width * 0.8;
    this.hubY = game.config.world.height * 0.6;
    this.hubNode = new Container({ label: 'hub' });
    this.hubPlatform = new PlatformEntity(
      game.config.platforms,
      game.textures.platformTexture,
      game.config.world.width,
    );
    this.hubNode.addChild(this.hubPlatform.node);
    this.hubPlatform.configure(this.hubX, this.hubY, this.hubWidth, true);
    this.hubNode.visible = false;
    game.worldRoot.addChild(this.hubNode);
    this.hubMoving = false;
    this.hubHiddenPlatforms = new Set();
    this.transitionNode = new Container({ label: 'scene-transition' });
    this.transitionTop = new Graphics();
    this.transitionBottom = new Graphics();
    this.transitionNode.addChild(this.transitionTop, this.transitionBottom);
    this.transitionNode.visible = false;
    game.uiRoot.addChild(this.transitionNode);
    this.transitionPhase = null;
    this.transitionElapsed = 0;
    this.transitionDuration = 0.25;
  }

  reset() {
    this.clearPortalPair();
    this.hubNode.visible = false;
    this.hubMoving = false;
    this.hubHiddenPlatforms.clear();
    this.transitionPhase = null;
    this.transitionNode.visible = false;
    for (const platform of this.game.platformPool.items) platform.node.visible = true;
    this.nextPortalTime = Math.max(60, this.game.difficultyTime + 60);
  }

  resizeWorld(height) {
    this.hubY = height * 0.6;
    this.hubPlatform.configure(this.hubX, this.hubY, this.hubWidth, true);
  }

  startInitialHub() {
    this.clearPortalPair();
    this.prepareHubScene();
    this.game.mode = 'hub';
  }

  update(deltaSeconds) {
    if (this.game.mode === 'transition') {
      this.updateTransition(deltaSeconds);
      return;
    }
    if (this.game.mode === 'hub') {
      this.updateHub(deltaSeconds);
      return;
    }

    this.updateMovingHub(deltaSeconds);

    if (!this.portalPair && this.game.difficultyTime >= this.nextPortalTime) {
      if (this.spawnPortalPair()) this.nextPortalTime += 60;
    }
    if (!this.portalPair) return;
    const player = this.game.player;
    const playerBounds = {
      x: player.x,
      y: player.y,
      width: player.width,
      height: player.height,
    };
    if (this.portalPair.some((portal) => overlaps(playerBounds, portal.getBounds()))) {
      this.startTransitionToHub();
    }
  }

  prepareForPlatformRecycle() {
    if (!this.portalPair) return;
    if (this.portalPair.every((portal) => portal.platform.y + portal.platform.height < 0)) {
      this.clearPortalPair();
    }
  }

  spawnPortalPair() {
    const group = this.game.platformPool.groups.find((candidate) => (
      candidate.length === 2
      && candidate.every((platform) => platform.active)
      && candidate.every((platform) => platform.y > this.game.config.world.height)
    )) || this.game.platformPool.createPortalPair();
    if (!group) return false;
    group.isPortalPair = true;
    this.portalPair = group.map((platform, index) => new PortalEntity(platform, index === 0 ? 'left' : 'right'));
    return true;
  }

  clearPortalPair() {
    if (!this.portalPair) return;
    const platforms = this.portalPair.map((portal) => portal.platform);
    for (const portal of this.portalPair) portal.destroy();
    for (const platform of platforms) platform.portalPlatform = false;
    this.portalPair = null;
  }

  startTransitionToHub() {
    this.clearPortalPair();
    this.game.mode = 'transition';
    this.transitionPhase = 'closing';
    this.transitionElapsed = 0;
    this.transitionNode.visible = true;
    this.updateTransitionBars(0);
  }

  enterHubScene() {
    this.prepareHubScene();
  }

  prepareHubScene() {
    this.hubMoving = false;
    this.game.platformPool.prepareRouteBelow(this.hubY);
    this.hubHiddenPlatforms.clear();
    // The route is laid out once, relative to the hub. Keep every platform
    // active and visible; platforms below the viewport naturally enter from
    // off-screen as the world scrolls.
    for (const platform of this.game.platformPool.items) {
      platform.node.visible = platform.active;
    }
    this.hubPlatform.configure(this.hubX, this.hubY, this.hubWidth, true);
    this.game.player.groundedOn = this.hubPlatform;
    this.game.player.x = this.hubX + 2;
    this.game.player.y = this.hubY - this.game.player.height;
    this.game.player.vx = 0;
    this.game.player.vy = 0;
    this.hubNode.visible = true;
  }


  updateTransition(deltaSeconds) {
    this.transitionElapsed += deltaSeconds;
    const progress = Math.min(1, this.transitionElapsed / this.transitionDuration);
    if (this.transitionPhase === 'closing') {
      this.updateTransitionBars(progress);
      if (progress >= 1) {
        this.enterHubScene();
        this.transitionPhase = 'opening';
        this.transitionElapsed = 0;
      }
      return;
    }

    this.updateTransitionBars(1 - progress);
    if (progress >= 1) {
      this.transitionPhase = null;
      this.transitionNode.visible = false;
      this.game.mode = 'hub';
    }
  }

  updateTransitionBars(progress) {
    const worldWidth = this.game.config.world.width;
    const worldHeight = this.game.config.world.height;
    const halfHeight = worldHeight * 0.5 * progress;
    this.transitionTop.clear().rect(0, 0, worldWidth, halfHeight).fill(0x000000);
    this.transitionBottom.clear()
      .rect(0, worldHeight - halfHeight, worldWidth, halfHeight)
      .fill(0x000000);
  }

  updateHub(deltaSeconds) {
    if (this.game.player.x >= this.hubX + this.hubWidth - this.game.player.width - 1) {
      this.exitHub();
    }
  }

  exitHub() {
    this.game.mode = 'game';
    this.hubMoving = true;
    this.game.player.groundedOn = null;
    this.game.player.y = this.hubY - this.game.player.height;
    this.game.player.vy = 0;
  }

  updateMovingHub(deltaSeconds) {
    if (!this.hubMoving) return;
    if (this.hubNode.visible) {
      this.hubPlatform.moveTo(
        this.hubPlatform.x,
        this.hubPlatform.y - this.game.worldSpeed * deltaSeconds,
      );
    }
    if (this.hubPlatform.y + this.hubPlatform.height < 0) {
      this.hubNode.visible = false;
    }
    if (!this.hubNode.visible) this.hubMoving = false;
  }
}
