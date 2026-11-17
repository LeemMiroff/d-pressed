import * as THREE from 'three';
import { CONFIG } from './config.js';
import { CrystalMotion } from './crystal-motion.js';

const STEP = 1 / 60;
const SHADOW_COVERAGE = Object.freeze({
  horizontalMargin: 24,
  topMargin: 48,
  bottomMargin: 88,
  depthMargin: 12,
  projectionPadding: 4,
});
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (from, to, amount) => from + (to - from) * amount;
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const moveTowards = (current, target, amount) => current < target ? Math.min(current + amount, target) : Math.max(current - amount, target);

function createRunSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] || 1;
  }
  return ((Date.now() ^ Math.floor((globalThis.performance?.now?.() || 0) * 1000)) >>> 0) || 1;
}

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
    this.keyLight.target.position.set(config.world.width / 2, config.world.height / 2, 0);
    this.fillLight = new THREE.PointLight(0x9f6cff, 180, 260, 2);
    this.fillLight.position.set(60, 80, 70);
    this.scene.add(this.ambientLight, this.keyLight, this.keyLight.target, this.fillLight);
    this.config.camera = { fov: 52, tiltDegrees: 12, distanceMultiplier: 1, centerOffset: 8, ...(config.camera || {}) };
    this.camera = new THREE.PerspectiveCamera(this.config.camera.fov, 1, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.03;
    this.applyLighting();
    this.input = { held: false };
    this.mode = 'hub';
    this.paused = false;
    this.gameOver = false;
    this.accumulator = 0;
    this.worldHeight = config.world.height;
    this.worldSpeed = config.platforms.initialWorldSpeed;
    this.difficultyTime = 0;
    this.patternCount = 0;
    this.patternHistory = [];
    this.lastPatternType = null;
    this.patternRepeatCount = 0;
    this.lastWallSide = null;
    this.wallSideRepeatCount = 0;
    this.runSeed = 0;
    this.rngState = 0;
    this.activeRunTime = 0;
    this.nextPortalPattern = config.platforms.hubPortal.everyPatterns;
    this.doublePlatformsDisabled = false;
    this.crystalCount = config.crystals.startingCount || 0;
    this.upgradeCount = 0;
    this.damage = 1;
    this.platforms = [];
    this.groups = [];
    this.portals = null;
    this.transitionRemaining = 0;
    this.hubMoving = false;
    this.entities = [];
    this.renderStats = { lastTime: performance.now(), elapsed: 0, frames: 0 };
    this.setRandomSeed();
    this.createBackground();
    this.createPlayer();
    this.createHub();
    this.createPool();
    this.createEntityPool();
    this.createUi();
    this.resize();
    this.restart(false, true);
  }

  setRandomSeed(seed = createRunSeed()) {
    this.runSeed = (seed >>> 0) || 1;
    this.rngState = this.runSeed;
  }

  random() {
    // Mulberry32 keeps a run varied while making a bug reproducible from its seed.
    let value = (this.rngState += 0x6D2B79F5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  randomBetween(min, max) {
    return min + this.random() * (max - min);
  }

  updateShadowCameraCoverage(worldHeight) {
    const shadowCamera = this.keyLight.shadow.camera;
    const shadowMapSize = Math.max(1, this.keyLight.shadow.mapSize.x || 1024);
    const worldWidth = this.config.world.width;
    const configuredPlatformWidth = Number(this.config.platforms.maxWidth);
    const wallEmbedMargin = Math.max(
      SHADOW_COVERAGE.horizontalMargin,
      Number.isFinite(configuredPlatformWidth) ? configuredPlatformWidth : 0,
    );
    const coverageLeft = -wallEmbedMargin;
    const coverageRight = worldWidth + wallEmbedMargin;
    const coverageBottom = -SHADOW_COVERAGE.bottomMargin;
    const coverageTop = worldHeight + SHADOW_COVERAGE.topMargin;
    const lightTarget = new THREE.Vector3(worldWidth / 2, worldHeight / 2, 0);

    // Keep both the light position and its aim unchanged. Only the shadow
    // projection is framed around the visible world and its lower margin.
    this.keyLight.target.position.copy(lightTarget);
    shadowCamera.position.copy(this.keyLight.position);
    shadowCamera.lookAt(lightTarget);
    shadowCamera.updateMatrixWorld(true);

    const depthMin = -8 - SHADOW_COVERAGE.depthMargin;
    const depthMax = 8 + SHADOW_COVERAGE.depthMargin;
    const point = new THREE.Vector3();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const x of [coverageLeft, coverageRight]) {
      for (const y of [coverageBottom, coverageTop]) {
        for (const z of [depthMin, depthMax]) {
          point.set(x, y, z).applyMatrix4(shadowCamera.matrixWorldInverse);
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        }
      }
    }

    const padding = SHADOW_COVERAGE.projectionPadding;
    const projectionWidth = Math.max(1, maxX - minX + padding * 2);
    const projectionHeight = Math.max(1, maxY - minY + padding * 2);
    const texelWidth = projectionWidth / shadowMapSize;
    const texelHeight = projectionHeight / shadowMapSize;
    const snappedCenterX = Math.round(((minX + maxX) / 2) / texelWidth) * texelWidth;
    const snappedCenterY = Math.round(((minY + maxY) / 2) / texelHeight) * texelHeight;

    // Quantizing the orthographic center to shadow texels keeps the projection
    // stable when the viewport is resized or lighting settings are re-applied.
    shadowCamera.left = snappedCenterX - projectionWidth / 2;
    shadowCamera.right = snappedCenterX + projectionWidth / 2;
    shadowCamera.bottom = snappedCenterY - projectionHeight / 2;
    shadowCamera.top = snappedCenterY + projectionHeight / 2;
    shadowCamera.near = 1;
    shadowCamera.far = 800;
    shadowCamera.updateProjectionMatrix();
  }

  applyLighting() {
    const lighting = this.config.lighting || {};
    const worldHeight = Number.isFinite(this.worldHeight) ? this.worldHeight : this.config.world.height;
    this.ambientLight.intensity = Number.isFinite(lighting.ambientIntensity) ? lighting.ambientIntensity : 1.2;
    this.keyLight.position.set(
      Number.isFinite(lighting.keyPositionX) ? lighting.keyPositionX : 28,
      Number.isFinite(lighting.keyPositionY) ? lighting.keyPositionY : 150,
      Number.isFinite(lighting.keyPositionZ) ? lighting.keyPositionZ : 90,
    );
    this.keyLight.intensity = Number.isFinite(lighting.keyIntensity) ? lighting.keyIntensity : 2.4;
    this.updateShadowCameraCoverage(worldHeight);
    this.fillLight.intensity = Number.isFinite(lighting.fillIntensity) ? lighting.fillIntensity : 180;
    this.fillLight.distance = Number.isFinite(lighting.fillDistance) ? lighting.fillDistance : 260;
    this.fillLight.position.set(
      Number.isFinite(lighting.fillPositionX) ? lighting.fillPositionX : 60,
      Number.isFinite(lighting.fillPositionY) ? lighting.fillPositionY : 80,
      Number.isFinite(lighting.fillPositionZ) ? lighting.fillPositionZ : 70,
    );
    const shadowsEnabled = lighting.shadowsEnabled !== false;
    this.renderer.shadowMap.enabled = shadowsEnabled;
    this.keyLight.castShadow = shadowsEnabled;
    this.renderer.shadowMap.needsUpdate = true;
  }

  resizeBackgroundWall() {
    if (!this.backgroundWallSegments?.length) return;
    this.backgroundWallHeight = Math.max(this.worldHeight + 64, 280);
    this.backgroundWallOverlap = 1;
    const drawHeight = this.backgroundWallHeight + this.backgroundWallOverlap;
    this.backgroundWallSegments.forEach((segment, index) => {
      segment.mesh.scale.set(this.config.world.width + 4, drawHeight, 1);
      segment.logicalTop = (index - 1) * this.backgroundWallHeight;
      segment.renderPreviousLogicalTop = segment.logicalTop;
    });
    this.updateBackgroundWallTextureRepeat();
    this.applyBackgroundWallViews();
  }

  resetBackgroundWall() {
    if (!this.backgroundWallSegments?.length) return;
    this.backgroundWallSegments.forEach((segment, index) => {
      segment.logicalTop = (index - 1) * this.backgroundWallHeight;
      segment.renderPreviousLogicalTop = segment.logicalTop;
    });
    this.applyBackgroundWallViews();
  }

  updateBackgroundWall(dt) {
    if (!this.backgroundWallSegments?.length) return;
    for (const segment of this.backgroundWallSegments) segment.logicalTop -= this.worldSpeed * dt;
    const margin = Math.max(this.config.platforms.height * 2, 16);
    const drawHeight = this.backgroundWallHeight + this.backgroundWallOverlap;
    for (const segment of this.backgroundWallSegments) {
      if (segment.logicalTop + drawHeight >= -margin) continue;
      const lowestTop = Math.max(...this.backgroundWallSegments.map((candidate) => candidate.logicalTop));
      segment.logicalTop = lowestTop + this.backgroundWallHeight;
      segment.renderPreviousLogicalTop = segment.logicalTop;
    }
  }

  applyBackgroundWallViews(alpha = 1) {
    if (!this.backgroundWallSegments?.length) return;
    for (const [index, segment] of this.backgroundWallSegments.entries()) {
      const previousTop = Number.isFinite(segment.renderPreviousLogicalTop) ? segment.renderPreviousLogicalTop : segment.logicalTop;
      const renderTop = lerp(previousTop, segment.logicalTop, alpha);
      segment.mesh.position.set(this.config.world.width / 2, this.logicalY(renderTop + (this.backgroundWallHeight + this.backgroundWallOverlap) / 2), index * 0.001);
    }
  }

  createBackground() {
    this.sideWallWidth = 3;
    this.sideWallCenterOffset = 2;
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x2c1d2a, roughness: 0.84, metalness: 0.05 });
    this.background = new THREE.Mesh(new THREE.BoxGeometry(this.config.world.width + 24, this.config.world.height + 24, 4), wallMaterial);
    this.background.receiveShadow = true;
    this.background.position.z = -8;
    this.leftWall = new THREE.Mesh(new THREE.BoxGeometry(this.sideWallWidth, this.config.world.height + 24, 8), wallMaterial);
    this.rightWall = new THREE.Mesh(new THREE.BoxGeometry(this.sideWallWidth, this.config.world.height + 24, 8), wallMaterial);
    this.leftWall.receiveShadow = true;
    this.rightWall.receiveShadow = true;
    this.leftWall.position.set(-this.sideWallCenterOffset, this.config.world.height / 2, -2);
    this.rightWall.position.set(this.config.world.width + this.sideWallCenterOffset, this.config.world.height / 2, -2);
    this.backgroundWallGroup = new THREE.Group();
    this.backgroundWallGroup.position.z = -2.4;
    this.backgroundWallSegments = [0, 1].map(() => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 2),
        new THREE.MeshStandardMaterial({ color: this.config.render.gameBackgroundColor || 0x351f28, roughness: 1, metalness: 0 }),
      );
      mesh.receiveShadow = true;
      this.backgroundWallGroup.add(mesh);
      return { mesh, logicalTop: 0, renderPreviousLogicalTop: 0 };
    });
    this.world.add(this.background);
    this.world.add(this.leftWall, this.rightWall);
    this.world.add(this.backgroundWallGroup);
    this.resizeBackgroundWall();
    this.loadBackgroundWallTexture();
  }

  loadBackgroundWallTexture() {
    const loader = new THREE.TextureLoader();
    loader.load('./assets/wall-brick.png', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.anisotropy = 1;
      texture.needsUpdate = true;
      this.backgroundWallTexture = texture;
      for (const segment of this.backgroundWallSegments) {
        segment.mesh.material.map = texture;
        segment.mesh.material.color.set(0xffffff);
        segment.mesh.material.needsUpdate = true;
      }
      this.updateBackgroundWallTextureRepeat();
    }, undefined, (error) => {
      console.warn('D-PRESSED wall texture failed to load', error);
    });
  }

  updateBackgroundWallTextureRepeat() {
    if (!this.backgroundWallTexture || !this.backgroundWallHeight) return;
    const drawHeight = this.backgroundWallHeight + this.backgroundWallOverlap;
    const wallWidth = this.config.world.width + 4;
    this.backgroundWallTexture.repeat.set(1, drawHeight / wallWidth);
    this.backgroundWallTexture.needsUpdate = true;
  }

  createPlayer() {
    this.player = { x: 0, y: 0, width: this.config.player.width, height: this.config.player.height, vx: 0, vy: 0, groundedOn: null, renderPreviousX: 0, renderPreviousY: 0 };
    this.playerView = new THREE.Mesh(
      new THREE.BoxGeometry(this.config.player.width, this.config.player.height, 6),
      new THREE.MeshStandardMaterial({ color: 0xff7a45, roughness: 0.4, metalness: 0.1 }),
    );
    this.playerView.castShadow = true;
    this.playerView.receiveShadow = true;
    this.world.add(this.playerView);
  }

  createHub() {
    this.hub = { x: 0, y: this.hubTopY(), width: this.config.world.width * 0.8, height: this.config.platforms.height, active: true, renderPreviousY: this.hubTopY() };
    this.hubGroup = new THREE.Group();
    this.hubMesh = this.makePlatformMesh(1, this.hub.height, 0x8e6874);
    this.hubMesh.position.x = this.hub.width / 2;
    this.hubGroup.add(this.hubMesh);
    this.hubLanding = { x: this.config.world.width - this.config.world.width * 0.34, y: this.hub.y + this.hub.height + 28, width: this.config.world.width * 0.34, height: this.config.platforms.height, active: true, previousY: this.hub.y + this.hub.height + 28, renderPreviousY: this.hub.y + this.hub.height + 28 };
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
    body.castShadow = true;
    body.receiveShadow = true;
    head.castShadow = true;
    head.receiveShadow = true;
    body.position.set(localX, 6, 1);
    head.position.set(localX, 10, 1);
    const station = {
      label,
      localX,
      node,
      passes: 0,
      passWindow: 0,
      firstDirection: 0,
      previousCenter: null,
      level: 0,
      labelView: this.makeStationLabel(label, color),
    };
    station.labelView.sprite.position.set(localX, 26, 2);
    node.add(body, head, station.labelView.sprite);
    this.updateStationLabel(station);
    return station;
  }

  makeStationLabel(label, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 144;
    const context = canvas.getContext('2d');
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const labelTexture = new THREE.CanvasTexture(canvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    labelTexture.magFilter = THREE.NearestFilter;
    labelTexture.minFilter = THREE.NearestFilter;
    const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false }));
    labelSprite.scale.set(22, 12, 1);
    return { label, color, canvas, context, texture: labelTexture, sprite: labelSprite, state: '' };
  }

  getUpgradeCost() {
    const upgrades = this.config.upgrades;
    return Math.round(upgrades.firstCost * (upgrades.costMultiplier ** this.upgradeCount));
  }

  getStationValue(station) {
    return station.label === 'SPEED' ? this.config.player.maxHorizontalSpeed : this.damage;
  }

  updateStationLabel(station) {
    if (!station?.labelView) return;
    const upgrades = this.config.upgrades;
    const current = this.getStationValue(station);
    const maximum = station.label === 'SPEED' ? upgrades.speedMaximum : upgrades.damageMaximum;
    const increment = station.label === 'SPEED' ? upgrades.speedIncrement : upgrades.damageIncrement;
    const isMaxed = current >= maximum;
    const cost = this.getUpgradeCost();
    const hasEnough = this.crystalCount >= cost;
    const state = `${current}|${maximum}|${increment}|${cost}|${isMaxed}|${hasEnough}`;
    if (station.labelView.state === state) return;
    station.labelView.state = state;

    const { context, canvas, color, texture } = station.labelView;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#17171d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.lineWidth = 5;
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);

    context.font = 'bold 27px monospace';
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.fillText(station.label, canvas.width / 2, 20);
    context.font = 'bold 22px monospace';
    context.fillStyle = '#ffffff';
    context.fillText(isMaxed ? `${current}  MAX` : `${current} / ${maximum}`, canvas.width / 2, 54);
    context.fillStyle = isMaxed || hasEnough ? '#ffffff' : '#ff6b6b';
    context.fillText(isMaxed ? 'MAXED' : `COST ${cost} CR`, canvas.width / 2, 88);
    context.fillStyle = '#c7a8a4';
    if (!isMaxed) context.fillText(`NEXT +${increment}`, canvas.width / 2, 122);
    texture.needsUpdate = true;
  }

  updateStationLabels() {
    for (const station of this.stations || []) this.updateStationLabel(station);
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
      this.platforms.push({ node, mesh, x: 0, y: 0, width: 1, height: this.config.platforms.height, active: false, previousY: 0, renderPreviousX: 0, renderPreviousY: 0, patternType: 'SINGLE', spawnContent: {}, portalPlatform: false, hubEntryOnly: false, recycledThisFrame: false, enemy: null, crystals: [], crystalsSpawned: false, chest: null });
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
      enemyView.castShadow = true;
      enemyView.receiveShadow = true;
      chestView.castShadow = true;
      chestView.receiveShadow = true;
      this.world.add(enemyView, chestView);
      enemyView.visible = false;
      chestView.visible = false;
      this.entities.push({ kind: 'enemy', view: enemyView, platform: null, x: 0, y: 0, width: 8, height: 8, defeated: false, active: false, health: 3, hitTimer: 0, hitFlightTimer: 0, lastHitDirection: 0, renderOffsetX: 0, renderOffsetY: 0, rotation: 0, renderPreviousX: 0, renderPreviousY: 0, renderPreviousOffsetX: 0, renderPreviousOffsetY: 0, renderPreviousRotation: 0, dying: false, deathVelocityX: 0, deathVelocityY: 0, deathRotation: 0 });
      this.entities.push({ kind: 'chest', view: chestView, platform: null, x: 0, y: 0, width: 10, height: 8, active: false, opened: false, triggerOnly: true, solid: false, renderPreviousX: 0, renderPreviousY: 0, renderPreviousOffsetX: 0, renderPreviousOffsetY: 0, renderPreviousRotation: 0 });
      for (const side of [0, 1]) {
        const crystalView = new THREE.Mesh(crystalGeometry, crystalMaterial);
        this.world.add(crystalView);
        crystalView.castShadow = true;
        crystalView.receiveShadow = true;
        crystalView.visible = false;
        crystalView.position.z = 2;
        const crystal = { kind: 'crystal', view: crystalView, platform: null, x: 0, y: 0, width: 6, height: 6, active: false, collecting: false, phase: 'idle', floorY: 0, velocityX: 0, velocityY: 0, elapsed: 0, startX: 0, startY: 0, renderPreviousX: 0, renderPreviousY: 0, renderPreviousOffsetX: 0, renderPreviousOffsetY: 0, renderPreviousRotation: 0 };
        crystal.motion = new CrystalMotion(this, crystal);
        this.entities.push(crystal);
      }
    }
    for (let index = 0; index < 48; index += 1) {
      const view = new THREE.Mesh(crystalGeometry, crystalMaterial);
      this.world.add(view);
      view.castShadow = true;
      view.receiveShadow = true;
      view.visible = false;
      const burst = { kind: 'burst', view, platform: null, x: 0, y: 0, width: 6, height: 6, active: false, phase: 'burst', floorY: 0, velocityX: 0, velocityY: 0, bounces: 0, elapsed: 0, startX: 0, startY: 0, counted: false, renderPreviousX: 0, renderPreviousY: 0, renderPreviousOffsetX: 0, renderPreviousOffsetY: 0, renderPreviousRotation: 0 };
      burst.motion = new CrystalMotion(this, burst);
      this.entities.push(burst);
    }
  }

  createUi() {
    this.ui = document.createElement('div');
    this.ui.className = 'three-ui';
    this.ui.innerHTML = '<div class="three-ui__counter">CRYSTALS <strong data-crystals>0</strong></div><div class="three-ui__stats" aria-live="off">FPS <strong data-fps>--</strong><br>TRIANGLES <strong data-triangles>--</strong><br>VERTICES <strong data-vertices>--</strong></div><div class="three-ui__hint">HOLD / D TO MOVE RIGHT · R TO RESTART</div><div class="three-ui__gameover" data-gameover hidden>GAME OVER<br><button type="button" data-restart>RESTART</button></div>';
    document.body.append(this.ui);
    this.counter = this.ui.querySelector('[data-crystals]');
    this.fpsCounter = this.ui.querySelector('[data-fps]');
    this.trianglesCounter = this.ui.querySelector('[data-triangles]');
    this.verticesCounter = this.ui.querySelector('[data-vertices]');
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
    this.applyLighting();
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
    this.resizeBackgroundWall();
    this.leftWall.scale.y = this.worldHeight / 240;
    this.rightWall.scale.y = this.worldHeight / 240;
    this.leftWall.position.set(-this.sideWallCenterOffset, this.worldHeight / 2, -2);
    this.rightWall.position.set(this.config.world.width + this.sideWallCenterOffset, this.worldHeight / 2, -2);
    this.hub.y = this.hubTopY();
    this.hubLanding.y = this.hub.y + this.hub.height + this.config.platforms.minGap;
    this.hubLanding.previousY = this.hubLanding.y;
    this.hubLanding.active = true;
    this.applyHubView();
    this.applyHubLandingView();
    if (this.mode === 'hub') this.updateHubRouteVisibility();
    this.applyAllViews();
    this.resetRenderInterpolation();
  }

  logicalY(value) { return this.worldHeight - value; }

  hubTopY() {
    const configuredRatio = Number(this.config.platforms.hubTopRatio);
    const ratio = Number.isFinite(configuredRatio) ? clamp(configuredRatio, 0.2, 0.8) : 0.4;
    return this.worldHeight * ratio;
  }

  applyAllViews() {
    for (const platform of this.platforms) {
      this.applyPlatformView(platform);
    }
    this.applyBackgroundWallViews();
    this.applyHubView();
    this.hubGroup.position.set(0, this.logicalY(this.hub.y + this.hub.height / 2), 0);
    this.applyHubLandingView();
    this.playerView.position.set(this.player.x + this.player.width / 2, this.logicalY(this.player.y + this.player.height / 2), 1);
    for (const entity of this.entities) this.applyEntityView(entity);
  }

  captureRenderState() {
    this.player.renderPreviousX = this.player.x;
    this.player.renderPreviousY = this.player.y;
    this.hub.renderPreviousY = this.hub.y;
    this.hubLanding.renderPreviousY = this.hubLanding.y;
    for (const platform of this.platforms) {
      platform.renderPreviousX = platform.x;
      platform.renderPreviousY = platform.y;
    }
    for (const segment of this.backgroundWallSegments || []) segment.renderPreviousLogicalTop = segment.logicalTop;
    for (const entity of this.entities) this.captureEntityRenderState(entity);
  }

  captureEntityRenderState(entity) {
    entity.renderPreviousX = entity.x;
    entity.renderPreviousY = entity.y;
    entity.renderPreviousOffsetX = entity.renderOffsetX || 0;
    entity.renderPreviousOffsetY = entity.renderOffsetY || 0;
    entity.renderPreviousRotation = Number.isFinite(entity.rotation) ? entity.rotation : entity.view?.rotation.z || 0;
  }

  resetRenderInterpolation() {
    this.captureRenderState();
    for (const platform of this.platforms) {
      platform.renderPreviousX = platform.x;
      platform.renderPreviousY = platform.y;
    }
    for (const entity of this.entities) this.captureEntityRenderState(entity);
  }

  applyInterpolatedViews(alpha) {
    const blend = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
    for (const platform of this.platforms) {
      this.applyPlatformView(
        platform,
        lerp(platform.renderPreviousX ?? platform.x, platform.x, blend),
        lerp(platform.renderPreviousY ?? platform.y, platform.y, blend),
      );
    }
    this.applyBackgroundWallViews(blend);
    this.applyHubView();
    const hubY = lerp(this.hub.renderPreviousY ?? this.hub.y, this.hub.y, blend);
    this.hubGroup.position.set(0, this.logicalY(hubY + this.hub.height / 2), 0);
    this.applyHubLandingView(lerp(this.hubLanding.renderPreviousY ?? this.hubLanding.y, this.hubLanding.y, blend));
    this.playerView.position.set(
      lerp(this.player.renderPreviousX ?? this.player.x, this.player.x, blend) + this.player.width / 2,
      this.logicalY(lerp(this.player.renderPreviousY ?? this.player.y, this.player.y, blend) + this.player.height / 2),
      1,
    );
    for (const entity of this.entities) this.applyInterpolatedEntityView(entity, blend);
  }

  wallPlatformExtensions(platform) {
    if (!platform) return { left: 0, right: 0 };
    const worldWidth = this.config.world.width;
    const leftWallOuterEdge = this.leftWall.position.x - (this.sideWallWidth * this.leftWall.scale.x) / 2;
    const rightWallOuterEdge = this.rightWall.position.x + (this.sideWallWidth * this.rightWall.scale.x) / 2;
    const configuredMaxWidth = Number(this.config.platforms.maxWidth);
    const embedLimit = Number.isFinite(configuredMaxWidth) && configuredMaxWidth > 0 ? configuredMaxWidth : platform.width;
    const embedDepth = Math.max(this.sideWallWidth * 2, Math.min(platform.width, embedLimit));
    const left = platform.x <= 0.001 ? Math.max(-leftWallOuterEdge, embedDepth) : 0;
    const right = platform.x + platform.width >= worldWidth - 0.001 ? Math.max(rightWallOuterEdge - worldWidth, embedDepth) : 0;
    return { left, right };
  }

  applyPlatformView(platform, renderX = platform.x, renderY = platform.y) {
    const { left, right } = this.wallPlatformExtensions(platform);
    const renderWidth = platform.width + left + right;
    platform.node.position.set(renderX - left + renderWidth / 2, this.logicalY(renderY + platform.height / 2), 0);
    platform.mesh.scale.set(renderWidth, 1, 1);
  }

  applyHubView() {
    const { left, right } = this.wallPlatformExtensions(this.hub);
    const renderWidth = this.hub.width + left + right;
    this.hubMesh.position.x = this.hub.x - left + renderWidth / 2;
    this.hubMesh.scale.set(renderWidth, 1, 1);
  }

  applyHubLandingView(renderY = this.hubLanding.y) {
    const { left, right } = this.wallPlatformExtensions(this.hubLanding);
    const renderWidth = this.hubLanding.width + left + right;
    this.hubLandingGroup.position.set(this.hubLanding.x - left + renderWidth / 2, this.logicalY(renderY + this.hubLanding.height / 2), 0);
    this.hubLandingMesh.scale.set(renderWidth / this.hubLanding.width, 1, 1);
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
    platform.hubEntryOnly = false;
    platform.portalPlatform = false;
    platform.active = true;
    platform.node.visible = true;
    platform.renderPreviousX = platform.x;
    platform.renderPreviousY = platform.y;
    this.applyPlatformView(platform);
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
      if (entity.kind === 'enemy') { entity.rotation = 0; entity.view.rotation.z = 0; }
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
    if (type === 'DOUBLE') return { enemy: true, crystals: this.random() < 0.6, chest: this.random() < 0.3 };
    return { enemy: this.random() < (rule.enemyChance || 0), crystals: this.random() < (rule.crystalChance || 0), chest: this.random() < (rule.chestChance || 0) };
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
      candidates = this.random() < changeChance ? candidates.filter((type) => type !== 'SINGLE') : ['SINGLE'];
    } else if ((this.lastPatternType === 'WALL' || this.lastPatternType === 'DOUBLE') && candidates.includes('SINGLE')) {
      const changeChance = Number.isFinite(transitions.wallOrDoubleToSingleChance) ? transitions.wallOrDoubleToSingleChance : 0.9;
      candidates = this.random() < changeChance ? candidates.filter((type) => type !== this.lastPatternType) : candidates.filter((type) => type === this.lastPatternType);
    }
    const diversified = candidates.filter((type) => !this.wouldRepeatPattern(type));
    if (diversified.length) candidates = diversified;
    const total = candidates.reduce((sum, type) => sum + Math.max(0, Number(weights[type]) || 0), 0);
    let roll = this.random() * (total || 1);
    for (const type of candidates) {
      roll -= Math.max(0, Number(weights[type]) || 0);
      if (roll <= 0) return type;
    }
    return candidates.at(-1) || 'SINGLE';
  }

  wouldRepeatPattern(candidate) {
    const history = [...this.patternHistory, candidate];
    const maximumPeriod = Math.min(4, Math.floor(history.length / 2));
    for (let period = 2; period <= maximumPeriod; period += 1) {
      let repeats = true;
      for (let offset = 0; offset < period; offset += 1) {
        const current = history.length - 1 - offset;
        if (history[current] !== history[current - period]) {
          repeats = false;
          break;
        }
      }
      if (repeats) return true;
    }
    return false;
  }

  registerPattern(type, count = true) {
    if (count) this.patternCount += 1;
    if (this.lastPatternType === type) this.patternRepeatCount += 1;
    else { this.lastPatternType = type; this.patternRepeatCount = 1; }
    this.patternHistory.push(type);
    if (this.patternHistory.length > 24) this.patternHistory.shift();
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
    return Math.floor(this.randomBetween(minimum, maximum + 1));
  }

  randomProgressiveWidth() {
    const scale = this.currentPlatformScale();
    const minimum = Math.max(this.config.platforms.minWidth, (this.config.platforms.earlySingleMinWidth + (this.config.platforms.minWidth - this.config.platforms.earlySingleMinWidth) * Math.min(1, this.activeRunTime / this.config.platforms.platformProgressionDuration)) * scale);
    const maximum = Math.max(minimum, (this.config.platforms.earlySingleMaxWidth + (this.config.platforms.maxWidth - this.config.platforms.earlySingleMaxWidth) * Math.min(1, this.activeRunTime / this.config.platforms.platformProgressionDuration)) * scale);
    return Math.floor(this.randomBetween(minimum, maximum + 1));
  }

  randomPlatformX(width) {
    const maximumX = this.config.world.width - width;
    const clearance = Math.max(this.config.platforms.edgeClearance, this.player.width);
    if (maximumX <= clearance * 2 || this.random() < 0.35) return this.random() < 0.5 ? 0 : maximumX;
    return Math.floor(this.randomBetween(clearance, maximumX - clearance + 1));
  }

  randomWallX(width) {
    let side;
    if (!this.lastWallSide) { side = this.random() < 0.5 ? 'left' : 'right'; this.wallSideRepeatCount = 1; }
    else {
      const sameSideChance = this.wallSideRepeatCount >= 2 ? 0.1 : 0.25;
      side = this.random() < sameSideChance ? this.lastWallSide : this.lastWallSide === 'left' ? 'right' : 'left';
      this.wallSideRepeatCount = side === this.lastWallSide ? this.wallSideRepeatCount + 1 : 1;
    }
    this.lastWallSide = side;
    return side === 'left' ? 0 : this.config.world.width - width;
  }

  reachableX(previousPlatform, width, gap) {
    const fallTime = Math.sqrt((2 * gap) / this.config.player.gravity);
    const maximumReach = this.config.player.maxHorizontalSpeed * fallTime + 8;
    const previousCenter = previousPlatform.x + previousPlatform.width / 2;
    const targetCenter = previousCenter + this.randomBetween(-maximumReach, maximumReach);
    const maximumX = this.config.world.width - width;
    const candidate = clamp(targetCenter - width / 2, 0, maximumX);
    const margin = Math.max(this.config.platforms.wallMargin, this.player.width);
    if (candidate < margin) return 0;
    if (candidate > maximumX - margin) return maximumX;
    return candidate;
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

  generateInitial(preserveProgression = false) {
    let y = this.config.platforms.startY;
    let previous = null;
    this.groups = [];
    if (!preserveProgression) {
      this.patternCount = 0;
      this.patternHistory = [];
      this.lastPatternType = null;
      this.patternRepeatCount = 0;
      this.lastWallSide = null;
      this.wallSideRepeatCount = 0;
    }
    for (let index = 0; index < this.platforms.length; index += 1) {
      const type = this.choosePattern();
      const gap = previous ? this.randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap) : 0;
      y -= gap;
      const startPlatformIndex = this.config.player.startPlatformIndex;
      const wouldPairStartPlatform = index === startPlatformIndex || index + 1 === startPlatformIndex;
      if (type === 'DOUBLE' && index < this.platforms.length - 1 && index % 2 === 0 && !wouldPairStartPlatform) {
        const leftWidth = Math.floor(this.randomBetween(this.config.platforms.minWidth, this.config.platforms.maxWidth));
        const rightWidth = Math.floor(this.randomBetween(this.config.platforms.minWidth, this.config.platforms.maxWidth));
        const pairGap = this.pairedPlatformGap();
        const widthScale = Math.min(1, (this.config.world.width - pairGap) / (leftWidth + rightWidth));
        const scaledLeftWidth = Math.floor(leftWidth * widthScale);
        const scaledRightWidth = Math.floor(rightWidth * widthScale);
        this.configurePlatform(this.platforms[index], 0, y, scaledLeftWidth, 'DOUBLE');
        this.configurePlatform(this.platforms[index + 1], this.config.world.width - scaledRightWidth, y, scaledRightWidth, 'DOUBLE');
        const group = [this.platforms[index], this.platforms[index + 1]];
        this.groups.push(group);
        this.configureGroupContent(group, 'DOUBLE');
        previous = this.platforms[index + 1];
        index += 1;
        this.registerPattern('DOUBLE', !preserveProgression);
      } else {
        const width = this.activeRunTime < this.config.platforms.platformProgressionDuration ? this.randomProgressiveWidth() : this.randomWidth();
        const x = type === 'WALL' ? this.randomWallX(width) : previous ? this.reachableX(previous, width, gap) : this.randomPlatformX(width);
        const patternType = type === 'WALL' ? 'WALL' : 'SINGLE';
        this.configurePlatform(this.platforms[index], x, y, width, patternType);
        const group = [this.platforms[index]];
        this.groups.push(group);
        this.configureGroupContent(group, patternType);
        previous = this.platforms[index];
        this.registerPattern(patternType, !preserveProgression);
      }
    }
    this.assignSlots();
  }

  assignSlots() {
    const start = this.platforms[this.config.player.startPlatformIndex];
    const slot = this.config.platforms.height + this.config.platforms.minGap;
    const startGroup = this.groups.findIndex((group) => group.includes(start));
    this.groups.forEach((group, index) => group.forEach((platform) => {
      platform.y = this.config.platforms.startY - (index - startGroup + 1) * slot;
      platform.previousY = platform.y;
      platform.renderPreviousX = platform.x;
      platform.renderPreviousY = platform.y;
    }));
  }

  restart(preserveProgression = false, startInHub = true) {
    this.input.held = false;
    this.transitionRemaining = 0;
    if (!preserveProgression) {
      this.setRandomSeed();
      this.difficultyTime = 0;
      this.activeRunTime = 0;
      this.doublePlatformsDisabled = false;
      this.patternCount = 0;
      this.patternHistory = [];
      this.lastPatternType = null;
      this.patternRepeatCount = 0;
      this.lastWallSide = null;
      this.wallSideRepeatCount = 0;
      this.worldSpeed = this.config.platforms.initialWorldSpeed;
      this.crystalCount = this.config.crystals.startingCount || 0;
      this.damage = 1;
      this.upgradeCount = 0;
      this.nextPortalPattern = Math.max(1, this.config.platforms.hubPortal.everyPatterns);
      this.stations.forEach((station) => { station.level = 0; station.passes = 0; station.passWindow = 0; station.firstDirection = 0; station.previousCenter = null; });
    }
    this.gameOver = false;
    this.gameOverPanel.hidden = true;
    this.mode = 'run';
    this.rebuildRoute(preserveProgression);
    const start = this.platforms[this.config.player.startPlatformIndex];
    this.player.groundedOn = start;
    this.player.x = start.x + (start.width - this.player.width) / 2;
    this.player.y = start.y - this.player.height;
    this.player.vx = 0;
    this.player.vy = 0;
    if (startInHub) this.enterHub();
    this.updateCounter();
    this.resetRenderInterpolation();
    this.applyAllViews();
  }

  rebuildRoute(preserveProgression = true) {
    this.player.groundedOn = null;
    this.player.vx = 0;
    this.player.vy = 0;
    this.mode = 'run';
    this.hubMoving = false;
    this.hubGroup.visible = false;
    this.hub.y = this.hubTopY();
    this.hubLanding.y = this.hub.y + this.hub.height + this.config.platforms.minGap;
    this.hubLanding.previousY = this.hubLanding.y;
    this.hubLanding.active = true;
    this.resetBackgroundWall();
    this.clearEntities();
    this.generateInitial(preserveProgression);
    this.prepareRouteBelowHub();
  }

  enterHub() {
    this.mode = 'hub';
    this.hubGroup.visible = true;
    this.hubLandingGroup.visible = true;
    this.hub.y = this.hubTopY();
    this.hubLanding.y = this.hub.y + this.hub.height + this.config.platforms.minGap;
    this.hubLanding.previousY = this.hubLanding.y;
    this.updateHubRouteVisibility();
    this.hubLandingGroup.visible = true;
    this.player.groundedOn = this.hub;
    this.player.x = 2;
    this.player.y = this.hub.y - this.player.height;
    this.player.vx = 0;
    this.player.vy = 0;
    for (const station of this.stations) {
      station.passes = 0;
      station.passWindow = 0;
      station.firstDirection = 0;
      station.previousCenter = null;
    }
    this.hubMoving = false;
    this.resetRenderInterpolation();
  }

  updateHubRouteVisibility() {
    const routeStartY = this.hubLanding.y + this.hubLanding.height;
    for (const platform of this.platforms) {
      platform.node.visible = platform.active && platform.y >= routeStartY;
    }
  }

  enterHubFromPortal() {
    this.transitionRemaining = 0;
    this.rebuildRoute(true);
    this.enterHub();
    this.resetRenderInterpolation();
    this.applyAllViews();
  }

  prepareRouteBelowHub() {
    this.hubLanding.y = this.hub.y + this.hub.height + this.config.platforms.minGap;
    this.hubLanding.previousY = this.hubLanding.y;
    this.hubLandingGroup.visible = true;
    const activeGroups = this.groups.filter((group) => group.every((platform) => platform.active));
    const entryGroup = activeGroups.find((group) => group.length === 1) || activeGroups[0];
    if (!entryGroup) return;

    // PixelG always starts the generated route with one guaranteed landing
    // on the right wall. The normal pattern generator begins only after it.
    let previousPlatform = this.hubLanding;
    const entryGap = this.randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap);
    const entryY = this.nextRouteY(previousPlatform, entryGap);
    const entry = entryGroup[0];
    const entryWidth = Math.floor(this.randomBetween(this.config.platforms.earlyWideMinWidth || 96, this.config.platforms.earlyWideMaxWidth || 98));
    this.configurePlatform(entry, 0, entryY, Math.min(this.config.world.width, entryWidth), 'SINGLE');
    this.configureGroupContent([entry], 'SINGLE');
    entry.hubEntryOnly = true;
    entry.node.visible = true;
    previousPlatform = entry;

    for (const group of activeGroups) {
      if (group === entryGroup) continue;
      const gap = this.randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap);
      const nextY = this.nextRouteY(previousPlatform, gap);
      group.isPortalPair = false;
      if (group.length > 1) {
        const leftWidth = this.randomWidth();
        const rightWidth = this.randomWidth();
        const pairGap = this.pairedPlatformGap();
        const scale = Math.min(1, (this.config.world.width - pairGap) / (leftWidth + rightWidth));
        this.configurePlatform(group[0], 0, nextY, Math.floor(leftWidth * scale), 'DOUBLE');
        this.configurePlatform(group[1], this.config.world.width - Math.floor(rightWidth * scale), nextY, Math.floor(rightWidth * scale), 'DOUBLE');
        this.configureGroupContent(group, 'DOUBLE');
        previousPlatform = group[1];
      } else {
        const platform = group[0];
        const type = platform.patternType === 'WALL' ? 'WALL' : 'SINGLE';
        const width = this.activeRunTime < this.config.platforms.platformProgressionDuration ? this.randomProgressiveWidth() : this.randomWidth();
        const x = type === 'WALL' ? this.randomWallX(width) : this.reachableX(previousPlatform, width, gap);
        this.configurePlatform(platform, x, nextY, width, type);
        this.configureGroupContent([platform], type);
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
      if (entity.kind === 'enemy') { entity.rotation = 0; entity.view.rotation.z = 0; }
      if (entity.view) entity.view.visible = false;
    }
    for (const platform of this.platforms) { platform.enemy = null; platform.crystals = []; platform.crystalsSpawned = false; platform.chest = null; platform.portalPlatform = false; platform.hubEntryOnly = false; }
    for (const group of this.groups) group.isPortalPair = false;
    this.clearPortals();
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
    this.render(this.gameOver ? 1 : this.accumulator / STEP);
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
    this.captureRenderState();
    if (this.mode === 'hub') {
      this.updateHorizontal(dt);
      this.player.y = this.hub.y - this.player.height;
      this.updateStations(dt);
      // Keep the player grounded while any part of the hitbox is over the Hub.
      // Start the run only after the player has completely crossed its edge.
      if (this.player.x >= this.hub.x + this.hub.width) this.exitHub();
      this.applyAllViews();
      return;
    }
    if (this.mode === 'transition') {
      this.transitionRemaining = Math.max(0, this.transitionRemaining - dt);
      if (this.transitionRemaining === 0) this.enterHubFromPortal();
      return;
    }
    this.difficultyTime += dt;
    this.activeRunTime += dt;
    if (this.config.platforms.useFlowProgression) this.worldSpeed = Math.min(this.config.platforms.initialWorldSpeed + ((this.config.platforms.targetWorldSpeed - this.config.platforms.initialWorldSpeed) / this.config.platforms.targetWorldSpeedTime) * this.difficultyTime, this.config.platforms.targetWorldSpeed);
    if (!this.doublePlatformsDisabled && this.difficultyTime >= this.config.platforms.doublePlatformsDuration) this.doublePlatformsDisabled = true;
    for (const platform of this.platforms) { if (!platform.active) continue; platform.previousY = platform.y; platform.y -= this.worldSpeed * dt; }
    this.updateBackgroundWall(dt);
    if (this.hubMoving) {
      this.hub.y -= this.worldSpeed * dt;
      this.hubLanding.previousY = this.hubLanding.y;
      this.hubLanding.y -= this.worldSpeed * dt;
      const offscreenMargin = this.getPlatformOffscreenMargin();
      if (this.hub.y + this.hub.height < -offscreenMargin) {
        this.hubGroup.visible = false;
      }
      if (this.hubLanding.y + this.hubLanding.height < -offscreenMargin) {
        this.hubLandingGroup.visible = false;
        this.hubLanding.active = false;
      }
      if (!this.hubGroup.visible && !this.hubLandingGroup.visible) {
        this.hubMoving = false;
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

  applySpeedUpgrade(speed) {
    const direction = Math.sign(this.player.vx) || (this.input.held ? 1 : -1);
    this.player.vx = direction * speed;
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

  getPlatformOffscreenMargin() {
    const platformHeight = Math.max(0, Number(this.config.platforms.height) || 0);
    const segmentGap = Math.max(
      0,
      Number(this.config.platforms.maxGap) || Number(this.config.platforms.minGap) || 0,
    );
    // Keep a platform alive for one full inter-platform gap after it clears
    // the visible area so its cast shadow can leave the screen naturally.
    return Math.max(platformHeight * 2, platformHeight + segmentGap);
  }

  isGroupOffscreen(group) {
    return Boolean(group?.length)
      && !group.isPortalPair
      && group.every((platform) => platform.active && platform.y + platform.height < -this.getPlatformOffscreenMargin());
  }

  findLowestPlatform(excludedGroups = new Set()) {
    return this.groups.reduce((result, group) => {
      if (excludedGroups.has(group) || !group.every((platform) => platform.active)) return result;
      const lowest = group.reduce((candidate, platform) => (!candidate || platform.y > candidate.y ? platform : candidate), null);
      return !result || (lowest && lowest.y > result.y) ? lowest : result;
    }, null);
  }

  configureDoubleGroup(group, y) {
    const leftWidth = this.randomWidth();
    const rightWidth = this.randomWidth();
    const pairGap = this.pairedPlatformGap();
    const scale = Math.min(1, (this.config.world.width - pairGap) / (leftWidth + rightWidth));
    const scaledLeftWidth = Math.max(this.player.width + 2, Math.floor(leftWidth * scale));
    const scaledRightWidth = Math.max(this.player.width + 2, Math.floor(rightWidth * scale));
    this.configurePlatform(group[0], 0, y, scaledLeftWidth, 'DOUBLE');
    this.configurePlatform(group[1], this.config.world.width - scaledRightWidth, y, scaledRightWidth, 'DOUBLE');
    this.configureGroupContent(group, 'DOUBLE');
  }

  configureSingleGroup(group, y, type, previousPlatform, gap) {
    const width = this.activeRunTime < this.config.platforms.platformProgressionDuration
      ? this.randomProgressiveWidth()
      : this.randomWidth();
    const x = type === 'WALL'
      ? this.randomWallX(width)
      : previousPlatform
        ? this.reachableX(previousPlatform, width, gap)
        : this.randomPlatformX(width);
    this.configurePlatform(group[0], x, y, width, type);
    this.configureGroupContent(group, type);
  }

  recyclePlatforms() {
    // Keep the flag set until fixedUpdate has checked whether the player was
    // standing on a group that just moved to the bottom of the stream.
    for (const platform of this.platforms) platform.recycledThisFrame = false;

    let safety = this.groups.length + this.platforms.length + 4;
    while (safety > 0) {
      safety -= 1;
      const originalGroup = this.groups.find((group) => this.isGroupOffscreen(group));
      if (!originalGroup) break;

      let group = originalGroup;
      let lowest = this.findLowestPlatform(new Set([group]));
      let requestedType = this.choosePattern();
      if (!this.config.platforms.enablePairedPlatforms || this.doublePlatformsDisabled) {
        if (requestedType === 'DOUBLE') requestedType = 'SINGLE';
      }

      if (group.length === 1 && requestedType === 'DOUBLE') {
        const partner = this.groups.find((candidate) => (
          candidate !== group
          && candidate.length === 1
          && this.isGroupOffscreen(candidate)
        ));
        if (partner) {
          const firstIndex = this.groups.indexOf(group);
          const secondIndex = this.groups.indexOf(partner);
          const insertIndex = Math.min(firstIndex, secondIndex);
          const pair = [group[0], partner[0]];
          pair.isPortalPair = false;
          this.groups = this.groups.filter((candidate) => candidate !== group && candidate !== partner);
          this.groups.splice(insertIndex, 0, pair);
          group = pair;
          lowest = this.findLowestPlatform(new Set([group]));
        } else {
          requestedType = 'SINGLE';
        }
      }

      const gap = this.randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap);
      const previousPlatform = lowest || (this.hubLanding.active ? this.hubLanding : null);
      const y = this.nextRouteY(previousPlatform, gap);

      if (group.length > 1 && requestedType !== 'DOUBLE') {
        const first = group[0];
        const second = group[1];
        const firstGroup = [first];
        const secondGroup = [second];
        const firstIndex = this.groups.indexOf(group);
        const firstGap = gap;
        const secondGap = this.randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap);
        this.configureSingleGroup(firstGroup, y, requestedType, previousPlatform, firstGap);
        const secondY = this.nextRouteY(first, secondGap);
        this.configureSingleGroup(secondGroup, secondY, requestedType, first, secondGap);
        this.groups.splice(firstIndex, 1, firstGroup, secondGroup);
        first.recycledThisFrame = true;
        second.recycledThisFrame = true;
        this.registerPattern(requestedType);
        this.registerPattern(requestedType);
        continue;
      }

      if (group.length > 1) this.configureDoubleGroup(group, y);
      else this.configureSingleGroup(group, y, requestedType, previousPlatform, gap);
      group.isPortalPair = false;
      group.forEach((platform) => { platform.recycledThisFrame = true; });
      this.registerPattern(group.length > 1 ? 'DOUBLE' : requestedType);
    }
  }

  nextRouteY(previousPlatform = null, gap = this.randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap)) {
    return (previousPlatform ? previousPlatform.y : this.worldHeight) + this.config.platforms.height + gap;
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
      if (entity.kind === 'enemy' && entity.active && !entity.dying && !entity.defeated && !entity.platform) {
        // An enemy can outlive its pooled platform for one frame during a
        // recycle or route rebuild. Do not let that stale object enter combat.
        entity.active = false;
        entity.view.visible = false;
        continue;
      }
      if (entity.kind === 'enemy' && entity.dying) {
        entity.deathVelocityY += 440 * dt;
        entity.x += entity.deathVelocityX * dt;
        entity.y += entity.deathVelocityY * dt;
        entity.rotation += entity.deathRotation * dt;
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
    entity.rotation = 0;
    view.rotation.z = 0;
    entity.lastHitDirection = 0;
    entity.renderOffsetX = 0;
    entity.renderOffsetY = 0;
    this.captureEntityRenderState(entity);
    view.visible = true;
    platform.enemy = entity;
  }

  hitEnemy(enemy, stomp = false) {
    if (!enemy || !enemy.active || enemy.defeated || enemy.hitTimer > 0 || enemy.hitFlightTimer > 0) return;
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
      if (deathPlatform?.spawnContent) deathPlatform.spawnContent.enemy = false;
      if (deathPlatform?.enemy === enemy) deathPlatform.enemy = null;
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
      this.captureEntityRenderState(entity);
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
    this.captureEntityRenderState(entity);
    entity.view.visible = true;
    platform.chest = entity;
  }
  spawnBurst(x, floorY, count, platform = null) {
    for (let index = 0; index < count; index += 1) {
      const entity = this.entities.find((candidate) => candidate.kind === 'burst' && !candidate.active);
      if (!entity) continue;
      entity.motion.startBurst(x, floorY, index, count, platform);
      this.captureEntityRenderState(entity);
    }
  }

  updatePortals() {
    if (this.portals) {
      const stale = this.portals.some(({ platform }) => (
        !platform.active
        || !platform.portalPlatform
        || platform.y + platform.height < -Math.max(this.config.platforms.height * 2, 16)
      ));
      if (stale) this.clearPortals();
    }
    if (this.portals || !this.config.platforms.hubPortal.enabled || this.patternCount < this.nextPortalPattern) return;
    const existingPair = this.groups.find((group) => group.length === 2 && group.every((platform) => platform.active && platform.y > this.worldHeight));
    const pair = existingPair || this.createPortalPair();
    if (!pair) return;
    pair.isPortalPair = true;
    if (existingPair) this.configurePortalPair(pair);
    this.portals = pair.map((platform, index) => {
      this.clearPlatformEntities(platform);
      platform.portalPlatform = true;
      platform.spawnContent = { enemy: false, crystals: false, chest: false };
      const view = new THREE.Mesh(new THREE.TorusGeometry(3, 0.8, 8, 18), new THREE.MeshStandardMaterial({ color: 0x9f6cff, emissive: 0x4b1f80, emissiveIntensity: 1.8, roughness: 0.3 }));
      view.castShadow = true;
      view.receiveShadow = true;
      view.renderOrder = 5;
      this.world.add(view);
      return { platform, view, side: index };
    });
    this.nextPortalPattern += Math.max(1, this.config.platforms.hubPortal.everyPatterns);
  }

  configurePortalPair(pair, baseY = Math.max(pair[0].y, pair[1].y)) {
    const [first, second] = pair;
    const pairGap = this.pairedPlatformGap();
    const maximumRatio = Math.min(0.49, Math.max(0.2, (this.config.world.width - pairGap) / (2 * this.config.world.width)));
    const configuredRatio = Number(this.config.platforms.hubPortal.platformWidthRatio);
    const ratio = clamp(Number.isFinite(configuredRatio) ? configuredRatio : 0.4, 0.2, maximumRatio);
    const width = Math.max(this.player.width + 2, Math.floor(this.config.world.width * ratio));
    this.configurePlatform(first, 0, baseY, width, 'DOUBLE');
    this.configurePlatform(second, this.config.world.width - width, baseY, width, 'DOUBLE');
    first.spawnContent = { enemy: false, crystals: false, chest: false };
    second.spawnContent = { enemy: false, crystals: false, chest: false };
  }

  createPortalPair() {
    const candidates = this.groups
      .filter((group) => group.length === 1 && group[0].active && group[0].y > this.worldHeight)
      .sort((first, second) => second[0].y - first[0].y);
    if (candidates.length < 2) return null;

    const firstGroup = candidates[0];
    const secondGroup = candidates[1];
    const first = firstGroup[0];
    const second = secondGroup[0];

    const selected = new Set([first, second]);
    const lowest = this.groups
      .flat()
      .filter((platform) => platform.active && !selected.has(platform))
      .reduce((candidate, platform) => !candidate || platform.y > candidate.y ? platform : candidate, null);
    const baseY = this.nextRouteY(lowest);
    const insertIndex = Math.min(this.groups.indexOf(firstGroup), this.groups.indexOf(secondGroup));
    this.groups = this.groups.filter((group) => group !== firstGroup && group !== secondGroup);
    const pair = [first, second];
    pair.isPortalPair = true;
    this.groups.splice(insertIndex, 0, pair);
    this.configurePortalPair(pair, baseY);
    return pair;
  }

  checkPortalEntry() {
    if (!this.portals) return;
    const entered = this.portals.some((portal) => overlap(this.player, { x: portal.platform.x + (portal.side ? portal.platform.width - 4 : 0), y: portal.platform.y - 10, width: 4, height: 10 }));
    if (entered) {
      this.clearPortals();
      this.mode = 'transition';
      this.input.held = false;
      this.transitionRemaining = 0.25;
    }
  }

  clearPortals() {
    if (!this.portals) return;
    const group = this.groups.find((candidate) => this.portals.every(({ platform }) => candidate.includes(platform)));
    if (group) group.isPortalPair = false;
    for (const portal of this.portals) {
      portal.platform.portalPlatform = false;
      this.world.remove(portal.view);
      portal.view.geometry.dispose();
      portal.view.material.dispose();
    }
    this.portals = null;
  }

  updateStations(dt) {
    this.updateStationLabels();
    for (const station of this.stations) {
      station.passWindow = Math.max(0, station.passWindow - dt);
      const center = this.player.x + this.player.width / 2;
      if (Math.abs(this.player.y + this.player.height - this.hub.y) > 8) continue;
      if (station.previousCenter === null) { station.previousCenter = center; continue; }
      const crossed = (station.previousCenter - station.localX) * (center - station.localX) <= 0 && station.previousCenter !== center;
      if (!crossed) {
        station.previousCenter = center;
        continue;
      }

      const direction = Math.sign(center - station.previousCenter);
      if (!station.firstDirection || station.passWindow === 0 || station.passes === 0) {
        station.firstDirection = direction;
        station.passes = 1;
      } else {
        const expectedDirection = station.passes % 2 === 0
          ? station.firstDirection
          : -station.firstDirection;
        if (direction !== expectedDirection) {
          station.firstDirection = direction;
          station.passes = 1;
        } else {
          station.passes += 1;
        }
      }
      station.passWindow = this.config.upgrades.passWindowSeconds;
      if (station.passes >= this.config.upgrades.requiredPasses) {
        this.activateStation(station);
        station.passes = 0;
        station.firstDirection = 0;
        station.passWindow = 0;
      }
      station.previousCenter = center;
    }
  }

  activateStation(station) {
    const upgrades = this.config.upgrades;
    const current = this.getStationValue(station);
    const maximum = station.label === 'SPEED' ? upgrades.speedMaximum : upgrades.damageMaximum;
    if (current >= maximum) return false;
    const cost = this.getUpgradeCost();
    if (this.crystalCount < cost) return false;
    this.crystalCount -= cost;
    this.upgradeCount += 1;
    station.level += 1;
    if (station.label === 'SPEED') {
      const nextSpeed = Math.min(upgrades.speedMaximum, this.config.player.maxHorizontalSpeed + upgrades.speedIncrement);
      this.config.player.maxHorizontalSpeed = nextSpeed;
      this.applySpeedUpgrade(nextSpeed);
    } else {
      this.damage = Math.min(upgrades.damageMaximum, this.damage + upgrades.damageIncrement);
    }
    this.updateCounter();
    return true;
  }

  setGameOver() { this.gameOver = true; this.mode = 'game-over'; this.gameOverPanel.hidden = false; this.input.held = false; }
  updateCounter() {
    this.counter.textContent = String(this.crystalCount);
    this.updateStationLabels();
  }
  updateRenderStats() {
    const now = performance.now();
    this.renderStats.frames += 1;
    this.renderStats.elapsed += now - this.renderStats.lastTime;
    this.renderStats.lastTime = now;
    if (this.renderStats.elapsed < 250) return;
    const fps = this.renderStats.frames * 1000 / this.renderStats.elapsed;
    const info = this.renderer.info.render;
    let vertices = 0;
    this.scene.traverseVisible((object) => {
      if (!object.geometry?.attributes?.position) return;
      const geometryVertices = object.geometry.attributes.position.count;
      vertices += object.isInstancedMesh ? geometryVertices * object.count : geometryVertices;
    });
    this.fpsCounter.textContent = String(Math.round(fps));
    this.trianglesCounter.textContent = String(Math.round(info.triangles));
    this.verticesCounter.textContent = String(vertices);
    this.renderStats.frames = 0;
    this.renderStats.elapsed = 0;
  }
  applyEntityView(entity) {
    if (!entity.view) return;
    if (entity.platform && entity.kind !== 'burst' && !entity.collecting) entity.y = entity.platform.y;
    if (Number.isFinite(entity.rotation)) entity.view.rotation.z = entity.rotation;
    const offsetX = entity.renderOffsetX || 0;
    const offsetY = entity.renderOffsetY || 0;
    const renderLayer = entity.kind === 'crystal' || entity.kind === 'burst' ? (entity.phase === 'counter' ? 4 : 2) : 1;
    entity.view.position.set(entity.x + (entity.width || 0) / 2 + offsetX, this.logicalY(entity.y - (entity.height || 0) / 2 - offsetY), renderLayer);
    const platformVisible = !entity.platform || entity.platform.node.visible;
    entity.view.visible = entity.active !== false && (!entity.defeated || entity.dying) && platformVisible;
  }

  applyInterpolatedEntityView(entity, alpha) {
    if (!entity.view) return;
    const x = lerp(entity.renderPreviousX ?? entity.x, entity.x, alpha);
    const y = lerp(entity.renderPreviousY ?? entity.y, entity.y, alpha);
    const offsetX = lerp(entity.renderPreviousOffsetX ?? 0, entity.renderOffsetX || 0, alpha);
    const offsetY = lerp(entity.renderPreviousOffsetY ?? 0, entity.renderOffsetY || 0, alpha);
    const currentRotation = Number.isFinite(entity.rotation) ? entity.rotation : entity.view.rotation.z;
    const rotation = lerp(entity.renderPreviousRotation ?? currentRotation, currentRotation, alpha);
    const renderLayer = entity.kind === 'crystal' || entity.kind === 'burst' ? (entity.phase === 'counter' ? 4 : 2) : 1;
    entity.view.position.set(x + (entity.width || 0) / 2 + offsetX, this.logicalY(y - (entity.height || 0) / 2 - offsetY), renderLayer);
    entity.view.rotation.z = rotation;
    const platformVisible = !entity.platform || entity.platform.node.visible;
    entity.view.visible = entity.active !== false && (!entity.defeated || entity.dying) && platformVisible;
  }

  render(alpha = 1) {
    this.checkPortalEntry();
    this.applyInterpolatedViews(alpha);
    if (this.portals) {
      this.portals.forEach((portal) => {
        const platform = portal.platform;
        const platformX = lerp(platform.renderPreviousX ?? platform.x, platform.x, alpha);
        const platformY = lerp(platform.renderPreviousY ?? platform.y, platform.y, alpha);
        portal.view.position.set(platformX + (portal.side ? platform.width - 2 : 2), this.logicalY(platformY - 5), 6);
      });
    }
    this.renderer.render(this.scene, this.camera);
    this.updateRenderStats();
  }
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
