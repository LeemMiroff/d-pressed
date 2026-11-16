import * as THREE from 'three';
import { CONFIG } from './config.js';
import { CrystalMotion } from './crystal-motion.js';

const STEP = 1 / 60;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomBetween = (min, max) => min + Math.random() * (max - min);
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const moveTowards = (current, target, amount) => current < target ? Math.min(current + amount, target) : Math.max(current - amount, target);

function applySettings(config, saved) {
  for (const [path, value] of Object.entries(saved || {})) {
    if (typeof value !== 'number' && typeof value !== 'boolean') continue;
    const keys = path.split('.');
    let target = config;
    for (let index = 0; index < keys.length - 1; index += 1) target = target?.[keys[index]];
    const key = keys.at(-1);
    if (target && key in target) target[key] = value;
  }
}

function sprite(texture, width, height) {
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const node = new THREE.Sprite(material);
  node.scale.set(width, height, 1);
  return node;
}

export class ThreeGame {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(config.render.outerBackgroundColor);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.keyLight = new THREE.DirectionalLight(0xffe3cc, 2.4);
    this.keyLight.position.set(28, 150, 90);
    this.fillLight = new THREE.PointLight(0x9f6cff, 180, 260, 2);
    this.fillLight.position.set(60, 80, 70);
    this.scene.add(this.ambientLight, this.keyLight, this.fillLight);
    this.config.camera = { fov: 52, tiltDegrees: 12, distanceMultiplier: 1, centerOffset: 8, ...(config.camera || {}) };
    this.camera = new THREE.PerspectiveCamera(this.config.camera.fov, 1, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.keyLight.castShadow = true;
    this.input = { held: false };
    this.mode = 'hub';
    this.paused = false;
    this.gameOver = false;
    this.accumulator = 0;
    this.worldHeight = config.world.height;
    this.worldSpeed = config.platforms.initialWorldSpeed;
    this.difficultyTime = 0;
    this.patternCount = 0;
    this.lastPatternType = null;
    this.patternRepeatCount = 0;
    this.lastWallSide = null;
    this.wallSideRepeatCount = 0;
    this.activeRunTime = 0;
    this.nextPortalPattern = config.platforms.hubPortal.everyPatterns;
    this.doublePlatformsDisabled = false;
    this.crystalCount = config.crystals.startingCount || 0;
    this.upgradeCount = 0;
    this.damage = 1;
    this.platforms = [];
    this.groups = [];
    this.portals = null;
    this.hubMoving = false;
    this.entities = [];
    this.createBackground();
    this.createPlayer();
    this.createHub();
    this.createPool();
    this.createEntityPool();
    this.createUi();
    this.resize();
    this.restart(false, true);
  }

  createBackground() {
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x2c1d2a, roughness: 0.84, metalness: 0.05 });
    this.background = new THREE.Mesh(new THREE.BoxGeometry(this.config.world.width + 24, this.config.world.height + 24, 4), wallMaterial);
    this.background.position.z = -8;
    this.leftWall = new THREE.Mesh(new THREE.BoxGeometry(3, this.config.world.height + 24, 8), wallMaterial);
    this.rightWall = new THREE.Mesh(new THREE.BoxGeometry(3, this.config.world.height + 24, 8), wallMaterial);
    this.leftWall.position.set(-2, this.config.world.height / 2, -2);
    this.rightWall.position.set(this.config.world.width + 2, this.config.world.height / 2, -2);
    this.world.add(this.background);
    this.world.add(this.leftWall, this.rightWall);
  }

  createPlayer() {
    this.player = { x: 0, y: 0, width: this.config.player.width, height: this.config.player.height, vx: 0, vy: 0, groundedOn: null };
    this.playerView = new THREE.Mesh(
      new THREE.BoxGeometry(this.config.player.width, this.config.player.height, 6),
      new THREE.MeshStandardMaterial({ color: 0xff7a45, roughness: 0.4, metalness: 0.1 }),
    );
    this.playerView.castShadow = true;
    this.world.add(this.playerView);
  }

  createHub() {
    this.hub = { x: 0, y: this.config.world.height * 0.6, width: this.config.world.width * 0.8, height: this.config.platforms.height, active: true };
    this.hubGroup = new THREE.Group();
    this.hubMesh = this.makePlatformMesh(1, this.hub.height, 0x8e6874);
    this.hubMesh.position.x = this.hub.width / 2;
    this.hubGroup.add(this.hubMesh);
    this.hubLanding = { x: this.config.world.width - this.config.world.width * 0.34, y: this.hub.y + this.hub.height + 28, width: this.config.world.width * 0.34, height: this.config.platforms.height, active: true, previousY: this.hub.y + this.hub.height + 28 };
    this.hubLandingMesh = this.makePlatformMesh(this.hubLanding.width, this.hubLanding.height, 0x72505c);
    this.hubLandingGroup = new THREE.Group();
    this.hubLandingGroup.add(this.hubLandingMesh);
    this.world.add(this.hubLandingGroup);
    this.stations = [this.makeStation('SPEED', 24, 0x5ad7ff), this.makeStation('DAMAGE', 62, 0xff8a5a)];
    this.stations.forEach((station) => this.hubGroup.add(station.node));
    this.world.add(this.hubGroup);
  }

  makeStation(label, localX, color) {
    const node = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 4), new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15 }));
    const head = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf0d3a2, roughness: 0.6 }));
    body.position.set(localX, 6, 1);
    head.position.set(localX, 10, 1);
    node.add(body, head, this.makeStationLabel(label, color));
    return { label, localX, node, passes: 0, passWindow: 0, firstDirection: 0, previousCenter: null, level: 0 };
  }

  makeStationLabel(label, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    context.fillStyle = '#17171d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.lineWidth = 5;
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    context.fillStyle = '#ffffff';
    context.font = 'bold 30px monospace';
    context.textAlign = 'center';
    context.fillText(label, canvas.width / 2, 40);
    context.font = 'bold 22px monospace';
    context.fillText(label === 'SPEED' ? '+5 SPEED' : '+1 DAMAGE', canvas.width / 2, 72);
    const labelTexture = new THREE.CanvasTexture(canvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false }));
    labelSprite.scale.set(22, 8, 1);
    labelSprite.position.set(label === 'SPEED' ? 24 : 62, 25, 2);
    return labelSprite;
  }

  makePlatformMesh(width, height, color = 0xc7a8a4) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, 9),
      new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.08 }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  createPool() {
    const platformGeometry = new THREE.BoxGeometry(1, this.config.platforms.height, 9);
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0xc7a8a4, roughness: 0.72, metalness: 0.08 });
    for (let index = 0; index < this.config.platforms.poolSize; index += 1) {
      const node = new THREE.Group();
      const mesh = new THREE.Mesh(platformGeometry, platformMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      node.add(mesh);
      node.visible = false;
      this.world.add(node);
      this.platforms.push({ node, mesh, x: 0, y: 0, width: 1, height: this.config.platforms.height, active: false, previousY: 0, patternType: 'SINGLE', spawnContent: {}, portalPlatform: false, hubEntryOnly: false, recycledThisFrame: false, enemy: null, crystals: [], crystalsSpawned: false, chest: null });
    }
  }

  createEntityPool() {
    const enemyGeometry = new THREE.BoxGeometry(8, 8, 6);
    const chestGeometry = new THREE.BoxGeometry(10, 8, 6);
    const crystalGeometry = new THREE.OctahedronGeometry(3.2, 0);
    const chestMaterial = new THREE.MeshStandardMaterial({ color: 0xff8a5a, roughness: 0.42, metalness: 0.18 });
    const crystalMaterial = new THREE.MeshStandardMaterial({ color: 0x5ad7ff, emissive: 0x0b5575, emissiveIntensity: 1.6, roughness: 0.22, metalness: 0.25 });
    for (const platform of this.platforms) {
      const enemyView = new THREE.Mesh(enemyGeometry, new THREE.MeshStandardMaterial({ color: 0x9fcf42, roughness: 0.48, metalness: 0.05 }));
      const chestView = new THREE.Mesh(chestGeometry, chestMaterial);
      this.world.add(enemyView, chestView);
      enemyView.visible = false;
      chestView.visible = false;
      this.entities.push({ kind: 'enemy', view: enemyView, platform: null, x: 0, y: 0, width: 8, height: 8, defeated: false, active: false, health: 3, hitTimer: 0, hitFlightTimer: 0, lastHitDirection: 0, renderOffsetX: 0, renderOffsetY: 0, dying: false, deathVelocityX: 0, deathVelocityY: 0, deathRotation: 0 });
      this.entities.push({ kind: 'chest', view: chestView, platform: null, x: 0, y: 0, width: 10, height: 8, active: false, opened: false, triggerOnly: true, solid: false });
      for (const side of [0, 1]) {
        const crystalView = new THREE.Mesh(crystalGeometry, crystalMaterial);
        this.world.add(crystalView);
        crystalView.visible = false;
        crystalView.position.z = 2;
        const crystal = { kind: 'crystal', view: crystalView, platform: null, x: 0, y: 0, width: 6, height: 6, active: false, collecting: false, phase: 'idle', floorY: 0, velocityX: 0, velocityY: 0, elapsed: 0, startX: 0, startY: 0 };
        crystal.motion = new CrystalMotion(this, crystal);
        this.entities.push(crystal);
      }
    }
    for (let index = 0; index < 48; index += 1) {
      const view = new THREE.Mesh(crystalGeometry, crystalMaterial);
      this.world.add(view);
      view.visible = false;
      const burst = { kind: 'burst', view, platform: null, x: 0, y: 0, width: 6, height: 6, active: false, phase: 'burst', floorY: 0, velocityX: 0, velocityY: 0, bounces: 0, elapsed: 0, startX: 0, startY: 0, counted: false };
      burst.motion = new CrystalMotion(this, burst);
      this.entities.push(burst);
    }
  }

  createUi() {
    this.ui = document.createElement('div');
    this.ui.className = 'three-ui';
    this.ui.innerHTML = '<div class="three-ui__counter">CRYSTALS <strong data-crystals>0</strong></div><div class="three-ui__hint">HOLD / D TO MOVE RIGHT · R TO RESTART</div><div class="three-ui__gameover" data-gameover hidden>GAME OVER<br><button type="button" data-restart>RESTART</button></div>';
    document.body.append(this.ui);
    this.counter = this.ui.querySelector('[data-crystals]');
    this.gameOverPanel = this.ui.querySelector('[data-gameover]');
    this.ui.querySelector('[data-restart]').addEventListener('click', () => this.restart());
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const viewportWidth = Math.min(width, Math.round(height * 0.5));
    const viewportLeft = Math.round((width - viewportWidth) / 2);
    this.canvas.style.width = `${viewportWidth}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = `${viewportLeft}px`;
    this.canvas.style.top = '0';
    this.worldHeight = Math.max(240, height / (viewportWidth / this.config.world.width));
    this.config.world.height = this.worldHeight;
    this.config.platforms.startY = this.worldHeight - 24;
    const aspect = viewportWidth / height;
    const targetY = this.worldHeight / 2 + this.config.camera.centerOffset;
    const fovRadians = THREE.MathUtils.degToRad(this.config.camera.fov);
    const horizontalDistance = this.config.world.width / (2 * Math.tan(fovRadians / 2) * aspect);
    const distance = horizontalDistance * this.config.camera.distanceMultiplier;
    const tilt = THREE.MathUtils.degToRad(this.config.camera.tiltDegrees);
    this.camera.aspect = aspect;
    this.camera.fov = this.config.camera.fov;
    this.camera.position.set(this.config.world.width / 2, targetY + Math.sin(tilt) * distance, Math.cos(tilt) * distance);
    this.camera.lookAt(this.config.world.width / 2, targetY, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(viewportWidth, height, false);
    this.background.scale.set(1, this.worldHeight / 240, 1);
    this.background.position.set(this.config.world.width / 2, this.worldHeight / 2, -4);
    this.leftWall.scale.y = this.worldHeight / 240;
    this.rightWall.scale.y = this.worldHeight / 240;
    this.leftWall.position.set(-2, this.worldHeight / 2, -2);
    this.rightWall.position.set(this.config.world.width + 2, this.worldHeight / 2, -2);
    this.hub.y = this.worldHeight * 0.6;
    this.hubLanding.y = this.hub.y + this.hub.height + this.config.platforms.minGap;
    this.hubLanding.previousY = this.hubLanding.y;
    this.hubLanding.active = true;
    this.hubMesh.scale.set(this.hub.width, 1, 1);
    this.hubMesh.position.x = this.hub.width / 2;
    this.hubLandingGroup.position.set(this.hubLanding.x + this.hubLanding.width / 2, this.logicalY(this.hubLanding.y + this.hubLanding.height / 2), 0);
    this.applyAllViews();
  }

  logicalY(value) { return this.worldHeight - value; }

  applyAllViews() {
    for (const platform of this.platforms) {
      platform.node.position.set(platform.x + platform.width / 2, this.logicalY(platform.y + platform.height / 2), 0);
      platform.mesh.scale.set(platform.width, 1, 1);
    }
    this.hubGroup.position.set(0, this.logicalY(this.hub.y + this.hub.height / 2), 0);
    this.hubLandingGroup.position.set(this.hubLanding.x + this.hubLanding.width / 2, this.logicalY(this.hubLanding.y + this.hubLanding.height / 2), 0);
    this.playerView.position.set(this.player.x + this.player.width / 2, this.logicalY(this.player.y + this.player.height / 2), 1);
    for (const entity of this.entities) this.applyEntityView(entity);
  }

  configurePlatform(platform, x, y, width, type = 'SINGLE') {
    this.clearPlatformEntities(platform);
    const maximumX = this.config.world.width - width;
    let spawnX = clamp(Math.round(x), 0, maximumX);
    platform.x = spawnX;
    platform.y = Math.round(y);
    platform.previousY = platform.y;
    platform.width = width;
    platform.patternType = type;
    platform.active = true;
    platform.node.visible = true;
    platform.mesh.scale.set(width, 1, 1);
    platform.spawnContent = this.spawnContent(type);
  }

  pairedPlatformGap() {
    const edgeClearance = Math.max(0, Number(this.config.platforms.edgeClearance) || 0);
    return Math.max(16, this.player.width + edgeClearance * 2);
  }

  clearPlatformEntities(platform) {
    for (const entity of this.entities) {
      if (entity.platform !== platform) continue;
      entity.active = false;
      entity.defeated = false;
      entity.hitTimer = 0;
      entity.hitFlightTimer = 0;
      entity.renderOffsetX = 0;
      entity.renderOffsetY = 0;
      if (entity.kind === 'enemy') entity.view.rotation.z = 0;
      entity.dying = false;
      entity.deathVelocityX = 0;
      entity.deathVelocityY = 0;
      entity.deathRotation = 0;
      entity.collecting = false;
      entity.phase = 'idle';
      entity.view?.parent?.remove(entity.view);
      if (entity.view && entity.kind !== 'burst') this.world.add(entity.view);
      if (entity.view) entity.view.visible = false;
      entity.platform = null;
    }
    platform.enemy = null;
    platform.crystals = [];
    platform.crystalsSpawned = false;
    platform.chest = null;
  }

  spawnContent(type) {
    const rule = this.config.platforms.content[type] || {};
    if (type === 'DOUBLE') return { enemy: true, crystals: Math.random() < 0.6, chest: Math.random() < 0.3 };
    return { enemy: Math.random() < (rule.enemyChance || 0), crystals: Math.random() < (rule.crystalChance || 0), chest: Math.random() < (rule.chestChance || 0) };
  }

  choosePattern() {
    const weights = this.config.platforms.patternWeights || { SINGLE: 1, WALL: 0, DOUBLE: 0 };
    let candidates = ['SINGLE', 'WALL', 'DOUBLE'].filter((type) => type !== 'DOUBLE' || (this.config.platforms.enablePairedPlatforms && !this.doublePlatformsDisabled));
    const openingPatterns = this.config.platforms.openingPatterns || [];
    if (this.patternCount < openingPatterns.length) {
      const openingType = openingPatterns[this.patternCount];
      if (candidates.includes(openingType)) return openingType;
      if (openingType === 'DOUBLE') return 'SINGLE';
    }
    if (this.lastPatternType && this.patternRepeatCount >= (this.config.platforms.maxPatternRepeat ?? 2)) candidates = candidates.filter((type) => type !== this.lastPatternType);
    const transitions = this.config.platforms.patternTransitions || {};
    if (this.lastPatternType === 'SINGLE' && candidates.includes('SINGLE')) {
      const changeChance = Number.isFinite(transitions.singleToOtherChance) ? transitions.singleToOtherChance : 0.75;
      candidates = Math.random() < changeChance ? candidates.filter((type) => type !== 'SINGLE') : ['SINGLE'];
    } else if ((this.lastPatternType === 'WALL' || this.lastPatternType === 'DOUBLE') && candidates.includes('SINGLE')) {
      const changeChance = Number.isFinite(transitions.wallOrDoubleToSingleChance) ? transitions.wallOrDoubleToSingleChance : 0.9;
      candidates = Math.random() < changeChance ? candidates.filter((type) => type !== this.lastPatternType) : candidates.filter((type) => type === this.lastPatternType);
    }
    const total = candidates.reduce((sum, type) => sum + Math.max(0, Number(weights[type]) || 0), 0);
    let roll = Math.random() * (total || 1);
    for (const type of candidates) {
      roll -= Math.max(0, Number(weights[type]) || 0);
      if (roll <= 0) return type;
    }
    return candidates.at(-1) || 'SINGLE';
  }

  registerPattern(type) {
    this.patternCount += 1;
    if (this.lastPatternType === type) this.patternRepeatCount += 1;
    else { this.lastPatternType = type; this.patternRepeatCount = 1; }
  }

  currentPlatformScale() {
    const size = this.config.platforms.platformSize || {};
    const startScale = Number.isFinite(size.startScale) ? size.startScale : 1;
    const minScale = Number.isFinite(size.minScale) ? size.minScale : 0.55;
    const duration = Number.isFinite(size.shrinkDurationSeconds) ? size.shrinkDurationSeconds : 0;
    if (duration > 0) return startScale + (minScale - startScale) * Math.min(1, this.activeRunTime / duration);
    const shrink = Number.isFinite(size.shrinkPerPattern) ? size.shrinkPerPattern : 0;
    return Math.max(minScale, startScale - this.patternCount * shrink);
  }

  randomWidth() {
    const scale = this.currentPlatformScale();
    const minimum = Math.max(8, Math.floor(this.config.platforms.minWidth));
    const maximum = Math.max(minimum, Math.floor(this.config.platforms.maxWidth * scale));
    return Math.floor(randomBetween(minimum, maximum + 1));
  }

  randomProgressiveWidth() {
    const scale = this.currentPlatformScale();
    const minimum = Math.max(this.config.platforms.minWidth, (this.config.platforms.earlySingleMinWidth + (this.config.platforms.minWidth - this.config.platforms.earlySingleMinWidth) * Math.min(1, this.activeRunTime / this.config.platforms.platformProgressionDuration)) * scale);
    const maximum = Math.max(minimum, (this.config.platforms.earlySingleMaxWidth + (this.config.platforms.maxWidth - this.config.platforms.earlySingleMaxWidth) * Math.min(1, this.activeRunTime / this.config.platforms.platformProgressionDuration)) * scale);
    return Math.floor(randomBetween(minimum, maximum + 1));
  }

  randomPlatformX(width) {
    const maximumX = this.config.world.width - width;
    const clearance = Math.max(this.config.platforms.edgeClearance, this.player.width);
    if (maximumX <= clearance * 2 || Math.random() < 0.35) return Math.random() < 0.5 ? 0 : maximumX;
    return Math.floor(randomBetween(clearance, maximumX - clearance + 1));
  }

  randomWallX(width) {
    let side;
    if (!this.lastWallSide) { side = Math.random() < 0.5 ? 'left' : 'right'; this.wallSideRepeatCount = 1; }
    else {
      const sameSideChance = this.wallSideRepeatCount >= 2 ? 0.1 : 0.25;
      side = Math.random() < sameSideChance ? this.lastWallSide : this.lastWallSide === 'left' ? 'right' : 'left';
      this.wallSideRepeatCount = side === this.lastWallSide ? this.wallSideRepeatCount + 1 : 1;
    }
    this.lastWallSide = side;
    return side === 'left' ? 0 : this.config.world.width - width;
  }

  reachableX(previousPlatform, width, gap) {
    const fallTime = Math.sqrt((2 * gap) / this.config.player.gravity);
    const maximumReach = this.config.player.maxHorizontalSpeed * fallTime + 8;
    const previousCenter = previousPlatform.x + previousPlatform.width / 2;
    const targetCenter = previousCenter + randomBetween(-maximumReach, maximumReach);
    const maximumX = this.config.world.width - width;
    const candidate = clamp(targetCenter - width / 2, 0, maximumX);
    const margin = Math.max(this.config.platforms.wallMargin, this.player.width);
    if (candidate < margin) return 0;
    if (candidate > maximumX - margin) return maximumX;
    return candidate;
  }

  generateInitial(preserveProgression = false) {
    let y = this.config.platforms.startY;
    let previous = null;
    this.groups = [];
    if (!preserveProgression) {
      this.patternCount = 0;
      this.lastPatternType = null;
      this.patternRepeatCount = 0;
      this.lastWallSide = null;
      this.wallSideRepeatCount = 0;
    }
    for (let index = 0; index < this.platforms.length; index += 1) {
      const type = this.choosePattern();
      y -= previous ? randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap) : 0;
      if (type === 'DOUBLE' && index < this.platforms.length - 1 && index % 2 === 0 && index !== this.config.player.startPlatformIndex) {
        const leftWidth = Math.floor(randomBetween(this.config.platforms.minWidth, this.config.platforms.maxWidth));
        const rightWidth = Math.floor(randomBetween(this.config.platforms.minWidth, this.config.platforms.maxWidth));
        const pairGap = this.pairedPlatformGap();
        const widthScale = Math.min(1, (this.config.world.width - pairGap) / (leftWidth + rightWidth));
        const scaledLeftWidth = Math.floor(leftWidth * widthScale);
        const scaledRightWidth = Math.floor(rightWidth * widthScale);
        this.configurePlatform(this.platforms[index], 0, y, scaledLeftWidth, 'DOUBLE');
        this.configurePlatform(this.platforms[index + 1], this.config.world.width - scaledRightWidth, y, scaledRightWidth, 'DOUBLE');
        this.groups.push([this.platforms[index], this.platforms[index + 1]]);
        previous = this.platforms[index + 1];
        index += 1;
        this.registerPattern('DOUBLE');
      } else {
        const width = this.activeRunTime < this.config.platforms.platformProgressionDuration ? this.randomProgressiveWidth() : this.randomWidth();
        const gap = previous ? randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap) : 0;
        const x = type === 'WALL' ? this.randomWallX(width) : previous ? this.reachableX(previous, width, gap) : this.randomPlatformX(width);
        this.configurePlatform(this.platforms[index], x, y, width, type === 'WALL' ? 'WALL' : 'SINGLE');
        this.groups.push([this.platforms[index]]);
        previous = this.platforms[index];
        this.registerPattern(type === 'WALL' ? 'WALL' : 'SINGLE');
      }
    }
    this.assignSlots();
  }

  assignSlots() {
    const start = this.platforms[this.config.player.startPlatformIndex];
    const slot = this.config.platforms.height + this.config.platforms.minGap;
    const startGroup = this.groups.findIndex((group) => group.includes(start));
    this.groups.forEach((group, index) => group.forEach((platform) => { platform.y = this.config.platforms.startY - (index - startGroup + 1) * slot; platform.previousY = platform.y; }));
  }

  restart(preserveProgression = false, startInHub = true) {
    this.input.held = false;
    if (!preserveProgression) {
      this.difficultyTime = 0;
      this.activeRunTime = 0;
      this.doublePlatformsDisabled = false;
      this.lastPatternType = null;
      this.patternRepeatCount = 0;
      this.lastWallSide = null;
      this.wallSideRepeatCount = 0;
      this.worldSpeed = this.config.platforms.initialWorldSpeed;
      this.crystalCount = this.config.crystals.startingCount || 0;
      this.damage = 1;
      this.upgradeCount = 0;
      this.stations.forEach((station) => { station.level = 0; station.passes = 0; });
    }
    this.gameOver = false;
    this.gameOverPanel.hidden = true;
    this.mode = 'run';
    this.hubMoving = false;
    this.hub.y = this.worldHeight * 0.6;
    this.hubLanding.y = this.hub.y + this.hub.height + this.config.platforms.minGap;
    this.hubLanding.previousY = this.hubLanding.y;
    this.hubLanding.active = true;
    this.hubGroup.visible = false;
    this.clearEntities();
    this.generateInitial(preserveProgression);
    this.prepareRouteBelowHub();
    const start = this.platforms[this.config.player.startPlatformIndex];
    this.player.groundedOn = start;
    this.player.x = start.x + (start.width - this.player.width) / 2;
    this.player.y = start.y - this.player.height;
    this.player.vx = 0;
    this.player.vy = 0;
    if (startInHub) this.enterHub();
    this.updateCounter();
    this.applyAllViews();
  }

  enterHub() {
    this.mode = 'hub';
    this.hubGroup.visible = true;
    this.hubLandingGroup.visible = true;
    this.hub.y = this.worldHeight * 0.6;
    this.hubLanding.y = this.hub.y + this.hub.height + this.config.platforms.minGap;
    this.hubLanding.previousY = this.hubLanding.y;
    for (const platform of this.platforms) {
      platform.node.visible = platform.active && platform.y >= this.hubLanding.y + this.hubLanding.height;
    }
    this.hubLandingGroup.visible = true;
    this.player.groundedOn = this.hub;
    this.player.x = 2;
    this.player.y = this.hub.y - this.player.height;
    this.hubMoving = false;
  }

  prepareRouteBelowHub() {
    this.hubLanding.y = this.hub.y + this.hub.height + this.config.platforms.minGap;
    this.hubLanding.previousY = this.hubLanding.y;
    this.hubLandingGroup.visible = true;
    let nextY = this.hubLanding.y + this.hubLanding.height;
    const activeGroups = this.groups.filter((group) => group.every((platform) => platform.active));
    const entryGroup = activeGroups.find((group) => group.length === 1) || activeGroups[0];
    if (!entryGroup) return;

    // PixelG always starts the generated route with one guaranteed landing
    // on the right wall. The normal pattern generator begins only after it.
    nextY += randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap);
    const entry = entryGroup[0];
    const entryWidth = Math.floor(randomBetween(this.config.platforms.earlyWideMinWidth || 96, this.config.platforms.earlyWideMaxWidth || 98));
    this.configurePlatform(entry, 0, nextY, Math.min(this.config.world.width, entryWidth), 'SINGLE');
    entry.hubEntryOnly = true;
    entry.node.visible = true;

    let previousPlatform = entry;
    for (const group of activeGroups) {
      if (group === entryGroup) continue;
      const gap = randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap);
      nextY += gap;
      if (group.length > 1) {
        const leftWidth = this.randomWidth();
        const rightWidth = this.randomWidth();
        const pairGap = this.pairedPlatformGap();
        const scale = Math.min(1, (this.config.world.width - pairGap) / (leftWidth + rightWidth));
        this.configurePlatform(group[0], 0, nextY, Math.floor(leftWidth * scale), 'DOUBLE');
        this.configurePlatform(group[1], this.config.world.width - Math.floor(rightWidth * scale), nextY, Math.floor(rightWidth * scale), 'DOUBLE');
        previousPlatform = group[1];
      } else {
        const platform = group[0];
        const type = platform.patternType === 'WALL' ? 'WALL' : 'SINGLE';
        const width = this.activeRunTime < this.config.platforms.platformProgressionDuration ? this.randomProgressiveWidth() : this.randomWidth();
        const x = type === 'WALL' ? this.randomWallX(width) : this.randomPlatformX(width);
        this.configurePlatform(platform, x, nextY, width, type);
        previousPlatform = platform;
      }
      group.forEach((platform) => { platform.node.visible = platform.active; platform.previousY = platform.y; });
    }
    this.applyAllViews();
  }

  exitHub() {
    this.mode = 'run';
    this.hubMoving = true;
    this.hubLandingGroup.visible = true;
    for (const platform of this.platforms) platform.node.visible = platform.active;
    this.player.groundedOn = null;
    this.player.y = this.hub.y - this.player.height;
    this.player.vy = 0;
  }

  clearEntities() {
    for (const entity of this.entities) {
      entity.active = false;
      entity.defeated = false;
      entity.hitTimer = 0;
      entity.hitFlightTimer = 0;
      entity.dying = false;
      entity.collecting = false;
      entity.phase = 'idle';
      entity.bounces = 0;
      entity.platform = null;
      entity.renderOffsetX = 0;
      entity.renderOffsetY = 0;
      if (entity.kind === 'enemy') entity.view.rotation.z = 0;
      if (entity.view) entity.view.visible = false;
    }
    for (const platform of this.platforms) { platform.enemy = null; platform.crystals = []; platform.crystalsSpawned = false; platform.chest = null; platform.portalPlatform = false; }
    if (this.portals) this.portals.forEach((portal) => this.world.remove(portal.view));
    this.portals = null;
  }

  update(dt) {
    if (this.paused) return;
    if (dt > 0.5) {
      this.accumulator = 0;
      dt = 0;
    }
    this.accumulator += Math.min(dt, 0.1);
    let steps = 0;
    while (this.accumulator >= STEP && steps < 16) { this.fixedUpdate(STEP); this.accumulator -= STEP; steps += 1; }
    this.render();
  }

  pause() {
    this.paused = true;
    this.accumulator = 0;
    this.input.held = false;
  }

  resume() {
    this.paused = false;
    this.accumulator = 0;
  }

  fixedUpdate(dt) {
    if (this.gameOver) return;
    if (this.mode === 'hub') {
      this.updateHorizontal(dt);
      this.player.y = this.hub.y - this.player.height;
      this.updateStations(dt);
      this.updateEntities(dt);
      // Keep the player grounded while any part of the hitbox is over the Hub.
      // Start the run only after the player has completely crossed its edge.
      if (this.player.x >= this.hub.x + this.hub.width) this.exitHub();
      this.applyAllViews();
      return;
    }
    if (this.mode === 'transition') return;
    this.difficultyTime += dt;
    this.activeRunTime += dt;
    if (this.config.platforms.useFlowProgression) this.worldSpeed = Math.min(this.config.platforms.initialWorldSpeed + ((this.config.platforms.targetWorldSpeed - this.config.platforms.initialWorldSpeed) / this.config.platforms.targetWorldSpeedTime) * this.difficultyTime, this.config.platforms.targetWorldSpeed);
    if (!this.doublePlatformsDisabled && this.difficultyTime >= this.config.platforms.doublePlatformsDuration) { this.doublePlatformsDisabled = true; this.config.platforms.enablePairedPlatforms = false; }
    for (const platform of this.platforms) { if (!platform.active) continue; platform.previousY = platform.y; platform.y -= this.worldSpeed * dt; }
    if (this.hubMoving) {
      this.hub.y -= this.worldSpeed * dt;
      this.hubLanding.previousY = this.hubLanding.y;
      this.hubLanding.y -= this.worldSpeed * dt;
      if (this.hub.y + this.hub.height < 0) {
        this.hubMoving = false;
        this.hubGroup.visible = false;
        this.hubLandingGroup.visible = false;
        this.hubLanding.active = false;
      }
    }
    this.recyclePlatforms();
    if (this.player.groundedOn?.recycledThisFrame) this.player.groundedOn = null;
    this.updateHorizontal(dt);
    this.updateVertical(dt);
    this.updateEntities(dt);
    this.updatePortals();
    if (this.player.y + this.player.height < 0 || this.player.y > this.worldHeight) this.setGameOver();
    this.applyAllViews();
  }

  updateHorizontal(dt) {
    const direction = this.input.held ? 1 : -1;
    const target = direction * this.config.player.maxHorizontalSpeed;
    const turning = this.player.vx !== 0 && Math.sign(this.player.vx) !== direction;
    this.player.vx = moveTowards(this.player.vx, target, (turning ? this.config.player.braking : this.config.player.acceleration) * dt);
    this.player.x = clamp(this.player.x + this.player.vx * dt, 0, this.config.world.width - this.player.width);
  }

  updateVertical(dt) {
    const grounded = this.player.groundedOn;
    if (grounded?.active === false) this.player.groundedOn = null;
    if (grounded?.active !== false && grounded) { this.player.y = grounded.y - this.player.height; this.player.vy = 0; if (grounded !== this.hub && !this.isOnPlatform(grounded)) this.player.groundedOn = null; }
    if (this.player.groundedOn) return;
    const previousBottom = this.player.y + this.player.height;
    this.player.vy += this.config.player.gravity * dt;
    const nextY = this.player.y + this.player.vy * dt;
    const nextBottom = nextY + this.player.height;
    let landing = null;
    const collisionPlatforms = this.hubLanding.active ? [...this.platforms, this.hubLanding] : this.platforms;
    for (const platform of collisionPlatforms) {
      if (!platform.active) continue;
      const crossed = previousBottom <= platform.previousY && nextBottom >= platform.y;
      const horizontal = this.player.x < platform.x + platform.width && this.player.x + this.player.width > platform.x;
      if (crossed && horizontal && platform.y < (landing?.y ?? Infinity)) landing = platform;
    }
    if (landing) {
      this.player.y = landing.y - this.player.height;
      this.player.vy = 0;
      this.player.groundedOn = landing;
      this.handleEnemyLanding(landing);
    } else this.player.y = nextY;
  }

  handleEnemyLanding(platform) {
    const enemy = platform.enemy;
    if (!enemy || enemy.defeated) return;
    const enemyBounds = { x: enemy.x, y: enemy.y - enemy.height, width: enemy.width, height: enemy.height };
    if (!overlap(this.player, enemyBounds)) return;
    this.hitEnemy(enemy, true);
  }

  isOnPlatform(platform) { return this.player.x + this.player.width > platform.x && this.player.x < platform.x + platform.width; }

  recyclePlatforms() {
    for (const group of this.groups) {
      const offscreen = group.every((platform) => platform.active && platform.y + platform.height < -this.config.platforms.height);
      if (!offscreen) continue;
      const lowest = this.groups.flat().filter((platform) => platform.active && !group.includes(platform)).reduce((candidate, platform) => !candidate || platform.y > candidate.y ? platform : candidate, null);
      const gap = randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap);
      const y = (lowest ? lowest.y : this.worldHeight) + this.config.platforms.height + gap;
      const type = group.length === 2 ? 'DOUBLE' : this.choosePattern();
      const previousPlatform = lowest || this.hubLanding;
      if (group.length === 2) {
        const leftWidth = this.randomWidth();
        const rightWidth = this.randomWidth();
        const pairGap = this.pairedPlatformGap();
        const scale = Math.min(1, (this.config.world.width - pairGap) / (leftWidth + rightWidth));
        group[0].recycledThisFrame = true;
        group[1].recycledThisFrame = true;
        this.configurePlatform(group[0], 0, y, Math.floor(leftWidth * scale), 'DOUBLE');
        this.configurePlatform(group[1], this.config.world.width - Math.floor(rightWidth * scale), y, Math.floor(rightWidth * scale), 'DOUBLE');
      } else {
        const width = this.activeRunTime < this.config.platforms.platformProgressionDuration ? this.randomProgressiveWidth() : this.randomWidth();
        const x = type === 'WALL' ? this.randomWallX(width) : this.reachableX(previousPlatform, width, gap);
        group[0].recycledThisFrame = true;
        this.configurePlatform(group[0], x, y, width, type);
      }
      this.registerPattern(type);
    }
    for (const platform of this.platforms) platform.recycledThisFrame = false;
  }

  updateEntities(dt) {
    for (const platform of this.platforms) {
      if (!platform.active || platform.portalPlatform || platform.hubEntryOnly) continue;
      if (platform.spawnContent.enemy && !platform.enemy) this.spawnEnemy(platform);
      if (platform.spawnContent.crystals && !platform.crystalsSpawned) this.spawnCrystals(platform);
      if (platform.spawnContent.chest && !platform.chest) this.spawnChest(platform);
    }
    let collectedCrystalThisFrame = false;
    for (const entity of this.entities) {
      if (entity.kind === 'enemy' && entity.dying) {
        entity.deathVelocityY += 440 * dt;
        entity.x += entity.deathVelocityX * dt;
        entity.y += entity.deathVelocityY * dt;
        entity.view.rotation.z += entity.deathRotation * dt;
        if (entity.y - entity.height > this.worldHeight + 24) {
          entity.dying = false;
          entity.active = false;
          entity.platform = null;
          entity.view.visible = false;
        }
      } else if (entity.kind === 'enemy' && !entity.defeated) {
        const wasHitFlight = entity.hitFlightTimer > 0;
        entity.hitTimer = Math.max(0, entity.hitTimer - dt);
        entity.hitFlightTimer = Math.max(0, entity.hitFlightTimer - dt);
        if (entity.hitFlightTimer > 0) {
          const progress = 1 - entity.hitFlightTimer / 0.18;
          entity.renderOffsetX = entity.hitFlightOffsetX * progress;
          entity.renderOffsetY = 4 * 4 * progress * (1 - progress);
        } else {
          if (wasHitFlight && entity.hitFlightOffsetX && entity.platform) {
            const minX = entity.platform.x + 1;
            const maxX = entity.platform.x + entity.platform.width - entity.width - 1;
            entity.x = clamp(entity.x + entity.hitFlightOffsetX, minX, Math.max(minX, maxX));
          }
          entity.renderOffsetX = 0;
          entity.renderOffsetY = 0;
        }
        if (entity.hitTimer === 0 && entity.hitFlightTimer === 0 && overlap(this.player, { x: entity.x, y: entity.y - entity.height, width: entity.width, height: entity.height })) {
          const stomp = this.player.vy > 0 && this.player.y + this.player.height <= entity.y + 2;
          this.hitEnemy(entity, stomp);
        }
        if ((entity.hitTimer > 0 || entity.hitFlightTimer > 0) && entity.view.material?.emissive) entity.view.material.emissive.setHex(0xffd66b);
        else if (entity.view.material?.emissive) entity.view.material.emissive.setHex(0x000000);
      }
      if (!collectedCrystalThisFrame && entity.kind === 'crystal' && entity.active && !entity.collecting && overlap(this.player, { x: entity.x, y: entity.y - entity.height, width: entity.width, height: entity.height })) {
        entity.motion.collect();
        collectedCrystalThisFrame = true;
      }
      if (entity.kind === 'crystal' && entity.collecting) entity.motion.update(dt);
      if (entity.kind === 'chest' && entity.active && overlap(this.player, { x: entity.x, y: entity.y - entity.height, width: entity.width, height: entity.height })) { entity.active = false; entity.view.visible = false; this.spawnBurst(entity.x + entity.width / 2, entity.y, this.config.crystals.chestCoinCount, entity.platform); }
      if (entity.kind === 'burst' && entity.active) entity.motion.update(dt);
      this.applyEntityView(entity);
    }
    this.updateCounter();
  }

  spawnEnemy(platform) {
    const entity = this.entities.find((candidate) => candidate.kind === 'enemy' && !candidate.active && !candidate.platform);
    if (!entity) return;
    const view = entity.view;
    view.castShadow = true;
    entity.platform = platform;
    entity.x = platform.x + platform.width / 2 - 4;
    entity.y = platform.y;
    entity.defeated = false;
    entity.active = true;
    entity.health = 3;
    entity.hitTimer = 0;
    entity.hitFlightTimer = 0;
    entity.dying = false;
    entity.deathVelocityX = 0;
    entity.deathVelocityY = 0;
    entity.deathRotation = 0;
    view.rotation.z = 0;
    entity.lastHitDirection = 0;
    entity.renderOffsetX = 0;
    entity.renderOffsetY = 0;
    view.visible = true;
    platform.enemy = entity;
  }

  hitEnemy(enemy, stomp = false) {
    if (enemy.defeated || enemy.hitTimer > 0 || enemy.hitFlightTimer > 0) return;
    const direction = Math.sign(this.player.vx) || (this.player.x < enemy.x ? 1 : -1);
    if (!stomp && enemy.lastHitDirection === direction) return;
    if (stomp) enemy.health = 0;
    else enemy.health -= Math.max(1, this.damage);
    enemy.hitTimer = 0.08;
    enemy.hitFlightTimer = 0.18;
    enemy.hitFlightOffsetX = direction * 2;
    enemy.lastHitDirection = direction;
    if (enemy.health <= 0) {
      enemy.defeated = true;
      const deathPlatform = enemy.platform;
      enemy.platform.spawnContent.enemy = false;
      enemy.platform.enemy = null;
      enemy.dying = true;
      enemy.deathVelocityX = direction > 0 ? 30 : -30;
      enemy.deathVelocityY = -156;
      enemy.deathRotation = direction > 0 ? 18 : -18;
      enemy.platform = null;
      this.spawnBurst(enemy.x + enemy.width / 2, enemy.y, 3, deathPlatform);
    }
    if (stomp) {
      this.player.groundedOn = null;
      this.player.vy = -Math.sqrt(this.config.player.gravity * 16);
    }
  }
  spawnCrystals(platform) {
    const available = this.entities.filter((candidate) => candidate.kind === 'crystal' && !candidate.active && !candidate.platform).slice(0, 2);
    if (available.length < 2) return;
    for (const side of [0, 1]) {
      const entity = available[side];
      const view = entity.view;
      entity.platform = platform;
      entity.x = side === 0 ? platform.x + 3 : platform.x + platform.width - 9;
      entity.y = platform.y - 1;
      entity.active = true;
      view.visible = true;
      platform.crystals.push(entity);
    }
    platform.crystalsSpawned = true;
  }
  spawnChest(platform) {
    const entity = this.entities.find((candidate) => candidate.kind === 'chest' && !candidate.active && !candidate.platform);
    if (!entity) return;
    entity.platform = platform;
    entity.x = platform.x + platform.width / 2 - 5;
    entity.y = platform.y - 1;
    entity.active = true;
    entity.opened = false;
    entity.view.visible = true;
    platform.chest = entity;
  }
  spawnBurst(x, floorY, count, platform = null) {
    for (let index = 0; index < count; index += 1) {
      const entity = this.entities.find((candidate) => candidate.kind === 'burst' && !candidate.active);
      if (!entity) continue;
      entity.motion.startBurst(x, floorY, index, count, platform);
    }
  }

  updatePortals() {
    if (this.portals || !this.config.platforms.hubPortal.enabled || this.patternCount < this.nextPortalPattern) return;
    const pair = this.groups.find((group) => group.length === 2 && group.every((platform) => platform.active && platform.y > this.worldHeight));
    if (!pair) return;
    this.portals = pair.map((platform, index) => {
      platform.portalPlatform = true;
      const view = new THREE.Mesh(new THREE.TorusGeometry(3, 0.8, 8, 18), new THREE.MeshStandardMaterial({ color: 0x9f6cff, emissive: 0x4b1f80, emissiveIntensity: 1.8, roughness: 0.3 }));
      view.rotation.x = Math.PI / 2;
      this.world.add(view);
      return { platform, view, side: index };
    });
    this.nextPortalPattern += Math.max(1, this.config.platforms.hubPortal.everyPatterns);
  }

  checkPortalEntry() {
    if (!this.portals) return;
    const entered = this.portals.some((portal) => overlap(this.player, { x: portal.platform.x + (portal.side ? portal.platform.width - 4 : 0), y: portal.platform.y - 10, width: 4, height: 10 }));
    if (entered) { this.portals.forEach((portal) => this.world.remove(portal.view)); this.portals = null; this.mode = 'transition'; window.setTimeout(() => this.enterHub(), 250); }
  }

  updateStations(dt) {
    for (const station of this.stations) {
      station.passWindow = Math.max(0, station.passWindow - dt);
      const center = this.player.x + this.player.width / 2;
      if (Math.abs(this.player.y + this.player.height - this.hub.y) > 8) continue;
      if (station.previousCenter === null) { station.previousCenter = center; continue; }
      const crossed = (station.previousCenter - station.localX) * (center - station.localX) <= 0 && station.previousCenter !== center;
      if (crossed) { const direction = Math.sign(center - station.previousCenter); const expected = station.passes % 2 === 0 ? station.firstDirection : -station.firstDirection; if (!station.firstDirection || station.passWindow === 0 || station.passes === 0 || direction !== expected) { station.firstDirection = direction; station.passes = 1; } else station.passes += 1; station.passWindow = 0.5; if (station.passes >= 3) { this.activateStation(station); station.passes = 0; station.firstDirection = 0; } }
      station.previousCenter = center;
    }
  }

  activateStation(station) {
    const cost = Math.round(25 * (1.2 ** this.upgradeCount));
    if (this.crystalCount < cost) return;
    this.crystalCount -= cost;
    this.upgradeCount += 1;
    station.level += 1;
    if (station.label === 'SPEED') this.config.player.maxHorizontalSpeed = Math.min(100, this.config.player.maxHorizontalSpeed + 5);
    else this.damage = Math.min(6, this.damage + 1);
  }

  setGameOver() { this.gameOver = true; this.mode = 'game-over'; this.gameOverPanel.hidden = false; this.input.held = false; }
  updateCounter() { this.counter.textContent = String(this.crystalCount); }
  applyEntityView(entity) {
    if (!entity.view) return;
    if (entity.platform && entity.kind !== 'burst' && !entity.collecting) entity.y = entity.platform.y;
    const offsetX = entity.renderOffsetX || 0;
    const offsetY = entity.renderOffsetY || 0;
    const renderLayer = entity.kind === 'crystal' || entity.kind === 'burst' ? (entity.phase === 'counter' ? 4 : 2) : 1;
    entity.view.position.set(entity.x + (entity.width || 0) / 2 + offsetX, this.logicalY(entity.y - (entity.height || 0) / 2 - offsetY), renderLayer);
    const platformVisible = !entity.platform || entity.platform.node.visible;
    entity.view.visible = entity.active !== false && (!entity.defeated || entity.dying) && platformVisible;
  }

  render() { this.checkPortalEntry(); this.playerView.position.set(this.player.x + this.player.width / 2, this.logicalY(this.player.y + this.player.height / 2), 1); if (this.portals) this.portals.forEach((portal) => portal.view.position.set(portal.platform.x + (portal.side ? portal.platform.width - 2 : 2), this.logicalY(portal.platform.y - 5), 1)); this.renderer.render(this.scene, this.camera); }
}

export async function loadThreeConfig() {
  const config = structuredClone(CONFIG);
  let serverSettings = null;
  try {
    const response = await fetch(`./settings.json?load=${Date.now()}`, { cache: 'no-store' });
    if (response.ok) serverSettings = await response.json();
  } catch { /* try local storage below */ }
  let localSettings = null;
  try { localSettings = JSON.parse(localStorage.getItem('d-pressed-inspector-settings') || 'null'); } catch { /* unavailable storage */ }
  const serverTime = Number(serverSettings?._savedAt) || 0;
  const localTime = Number(localSettings?._savedAt) || 0;
  if (serverSettings && (!localSettings || !serverTime || serverTime >= localTime)) applySettings(config, serverSettings);
  else if (localSettings) applySettings(config, localSettings);
  return config;
}
