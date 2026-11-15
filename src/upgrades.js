import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';

const STATION_CONFIG = {
  speed: { title: 'SPEED', color: 0x5ad7ff, firstCost: 25, costMultiplier: 1.2, increment: 5, maximum: 100 },
  damage: { title: 'DAMAGE', color: 0xff8a5a, firstCost: 25, costMultiplier: 1.2, increment: 1, maximum: 6 },
};

class UpgradeStation {
  constructor(manager, type, localX, frames) {
    this.manager = manager;
    this.type = type;
    this.localX = localX;
    this.config = STATION_CONFIG[type];
    this.firstPassDirection = 0;
    this.passWindow = 0;
    this.passCount = 0;
    this.requiredPasses = 3;
    this.passWindowSeconds = 0.5;
    this.previousPlayerCenter = null;
    this.level = 0;
    this.node = new Container({ label: `upgrade-${type}` });
    this.node.position.set(localX, 0);
    this.frames = frames;
    this.sprite = new Sprite(frames[0]);
    this.sprite.anchor.set(0.5, 1);
    this.sprite.position.set(0, 0);
    this.panel = new Graphics()
      .roundRect(-17, -50, 34, 25, 2)
      .fill({ color: 0x17171d, alpha: 0.92 })
      .stroke({ width: 0.75, color: this.config.color, alpha: 0.9 });
    this.titleText = this.createText(this.config.title, this.config.color, 5, -47);
    this.valueText = this.createText('', 0xffffff, 5, -41);
    this.costText = this.createText('', 0xffffff, 5, -35);
    this.bonusText = this.createText('', 0xc7a8a4, 5, -29);
    this.node.addChild(this.panel, this.titleText, this.valueText, this.costText, this.bonusText, this.sprite);
    manager.parent.addChild(this.node);
    this.updateInfo();
  }

  createText(text, fill, fontSize, y) {
    const node = new Text({
      text,
      resolution: 4,
      roundPixels: true,
      style: { fill, fontFamily: 'monospace', fontSize, fontWeight: 'bold', align: 'center' },
    });
    node.anchor.set(0.5);
    node.position.set(0, y);
    return node;
  }

  getCurrentValue() {
    return this.type === 'speed'
      ? this.manager.game.config.player.maxHorizontalSpeed
      : this.manager.game.player.damage;
  }

  updateInfo() {
    const current = this.getCurrentValue();
    const cost = this.getCost();
    const isMaxed = current >= this.config.maximum;
    const hasEnough = this.manager.game.crystalManager?.count >= cost;
    this.valueText.text = isMaxed ? `${current}  MAX` : `${current} / ${this.config.maximum}`;
    this.costText.text = isMaxed ? 'MAXED' : `COST ${cost} CR`;
    this.bonusText.text = isMaxed ? '' : `NEXT +${this.config.increment}`;
    this.costText.style.fill = isMaxed || hasEnough ? 0xffffff : 0xff6b6b;
  }

  getCost() {
    return Math.round(STATION_CONFIG.speed.firstCost * (STATION_CONFIG.speed.costMultiplier ** this.manager.upgradeCount));
  }

  activate() {
    if (this.getCurrentValue() >= this.config.maximum) return false;
    const cost = this.getCost();
    const crystals = this.manager.game.crystalManager;
    if (!crystals || crystals.count < cost) {
      this.manager.game.audio.deny();
      return false;
    }
    crystals.count -= cost;
    crystals.updateCounter();
    this.manager.upgradeCount += 1;
    this.manager.game.audio.reward();
    if (this.type === 'speed') {
      const nextSpeed = Math.min(
        this.config.maximum,
        this.manager.game.config.player.maxHorizontalSpeed + this.config.increment,
      );
      this.manager.game.config.player.maxHorizontalSpeed = nextSpeed;
      this.manager.game.applySpeedUpgrade(nextSpeed);
    } else {
      this.manager.game.player.damage = Math.min(
        this.config.maximum,
        this.manager.game.player.damage + this.config.increment,
      );
    }
    this.level += 1;
    this.updateInfo();
    this.sprite.texture = this.frames[1];
    window.setTimeout(() => { this.sprite.texture = this.frames[0]; }, 140);
    return true;
  }

  update(deltaSeconds) {
    this.updateInfo();
    if (this.passWindow > 0) {
      this.passWindow = Math.max(0, this.passWindow - deltaSeconds);
      if (this.passWindow === 0) {
        this.firstPassDirection = 0;
        this.passCount = 0;
      }
    }
    const player = this.manager.game.player;
    const platform = this.manager.platform;
    if (this.manager.game.mode !== 'hub' || !this.manager.parent.visible || !platform.active) {
      this.previousPlayerCenter = null;
      return;
    }
    const playerCenter = player.x + player.width * 0.5;
    const stationCenter = platform.x + this.localX;
    const verticallyAligned = Math.abs((player.y + player.height) - platform.y) <= 8;
    if (this.previousPlayerCenter === null) {
      this.previousPlayerCenter = playerCenter;
      return;
    }
    const crossed = verticallyAligned
      && (this.previousPlayerCenter - stationCenter) * (playerCenter - stationCenter) <= 0
      && this.previousPlayerCenter !== playerCenter;
    if (!crossed) {
      this.previousPlayerCenter = playerCenter;
      return;
    }
    const direction = Math.sign(playerCenter - this.previousPlayerCenter);
    if (!this.firstPassDirection || this.passWindow <= 0 || this.passCount === 0) {
      this.firstPassDirection = direction;
      this.passCount = 1;
      this.passWindow = this.passWindowSeconds;
    } else {
      const expectedDirection = this.passCount % 2 === 0
        ? this.firstPassDirection
        : -this.firstPassDirection;
      if (direction !== expectedDirection) {
        this.firstPassDirection = direction;
        this.passCount = 1;
        this.passWindow = this.passWindowSeconds;
      } else {
        this.passCount += 1;
        this.passWindow = this.passWindowSeconds;
        if (this.passCount >= this.requiredPasses) {
          this.activate();
          this.firstPassDirection = 0;
          this.passCount = 0;
          this.passWindow = 0;
        }
      }
    }
    this.previousPlayerCenter = playerCenter;
  }
}

export class UpgradeManager {
  constructor(game, parent, platform, texture) {
    this.game = game;
    this.parent = parent;
    this.platform = platform;
    this.upgradeCount = 0;
    this.baseSpeed = game.config.player.maxHorizontalSpeed;
    this.baseDamage = game.player.damage;
    const frameWidth = Math.floor(texture.width / 2);
    this.frames = [0, 1].map((index) => new Texture({
      source: texture.source,
      frame: new Rectangle(index * frameWidth, 0, frameWidth, texture.height),
    }));
    this.stations = [
      new UpgradeStation(this, 'speed', 24, this.frames),
      new UpgradeStation(this, 'damage', 62, this.frames),
    ];
  }

  reset(resetUpgrades = true) {
    if (resetUpgrades) {
      this.game.config.player.maxHorizontalSpeed = this.baseSpeed;
      this.game.player.damage = this.baseDamage;
      this.upgradeCount = 0;
    }
    for (const station of this.stations) {
      station.firstPassDirection = 0;
      station.passWindow = 0;
      station.passCount = 0;
      station.previousPlayerCenter = null;
      station.wasNear = false;
      station.updateInfo();
    }
  }

  update(deltaSeconds) {
    for (const station of this.stations) station.update(deltaSeconds);
  }
}
