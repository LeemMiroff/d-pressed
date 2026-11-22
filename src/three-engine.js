import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { CONFIG } from './config.js';
import { CrystalMotion } from './crystal-motion.js';
import { loadConfig } from './config-store.js';
import { createRunSeed, SeededRandom } from './rng.js';
import { PlatformGenerator } from './platform-generator.js';
import { GAME_STATES, GameSession } from './game-session.js';
import { ENEMY_HIT_FLIGHT_SECONDS, updateCollectibleEntity, updateEnemyEntity } from './entity-systems.js';
import { CARD_PRICE, CARD_PRICE_MULTIPLIER, REROLL_PRICE, drawRunCards } from './run-cards.js';
import { PlayerFacing } from './player-facing.js';
import { WindStreaks } from './wind-streaks.js';
import { PlatformFoliage } from './platform-foliage.js';
import { ENEMY_COLORS, createEnemyTexture, createChestTexture, mapBoxFront } from './entity-textures.js';
import { fitStonePlatform } from './stone-platform.js';
import { CliffBackground } from './cliff-background.js';
import { maximumCliffRecess, ProceduralCliffs } from './procedural-cliffs.js';

const STEP = 1 / 60;
const PORTAL_CLOSE_TIME = 0.3;
const PORTAL_OPEN_TIME = 0.34;
const PORTAL_COVERED_TIME = 0.1;
const PLATFORM_RESERVE = 2;
const PLATFORM_SHADOW_LAYER = 2;
const SHADOW_COVERAGE = Object.freeze({
  horizontalMargin: 24,
  topMargin: 48,
  bottomMargin: 88,
  depthMargin: 12,
  projectionPadding: 4,
});
const MIN_PLATFORM_EDGE_EXTENSION = 7;
const CRYSTAL_WIDTH = 6;
const CRYSTAL_SPACING = CRYSTAL_WIDTH * 1.25;
const BASE_CRYSTAL_RADIUS = 3.2;
const CRYSTAL_SCALE = 1.2;
const CRYSTAL_RADIUS = BASE_CRYSTAL_RADIUS * CRYSTAL_SCALE;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (from, to, amount) => from + (to - from) * amount;
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const moveTowards = (current, target, amount) => current < target ? Math.min(current + amount, target) : Math.max(current - amount, target);

function sprite(texture, width, height) {
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const node = new THREE.Sprite(material);
  node.scale.set(width, height, 1);
  return node;
}

function createCrystalGeometry() {
  const geometry = new THREE.OctahedronGeometry(CRYSTAL_RADIUS, 0);
  const { normal } = geometry.attributes;
  const pink = [0xf95d9d, 0xea4b8b, 0xff6ba8, 0xf25498];
  const raspberry = [0xc02969, 0xa82460, 0xb52b67, 0xc93275];
  const tint = new THREE.Color();
  const colors = [];
  for (let i = 0; i < normal.count; i += 1) {
    const quadrant = normal.getX(i) > 0 ? (normal.getZ(i) > 0 ? 0 : 1) : (normal.getZ(i) < 0 ? 2 : 3);
    tint.setHex((normal.getY(i) > 0 ? pink : raspberry)[quadrant]);
    colors.push(tint.r, tint.g, tint.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

export class ThreeGame {
  constructor(canvas, config, assets) {
    this.assets = assets;
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
    this.keyLight.shadow.camera.layers.enable(PLATFORM_SHADOW_LAYER);
    this.trailingPlatformShadows = [];
    this.applyLighting();
    this.input = { held: false };
    this.session = new GameSession();
    this.mode = this.session.state;
    this.paused = false;
    this.gameOver = false;
    this.accumulator = 0;
    this.maximumMode = false;
    this.worldHeight = config.world.height;
    this.worldSpeed = config.platforms.initialWorldSpeed;
    this.playerMixer = null;
    this.playerFacing = new PlayerFacing();
    this.playerRunAction = null;
    this.playerModel = null;
    this.playerModelBounds = null;
    this.playerModelBaseScale = 1;
    this.difficultyTime = 0;
    this.patternCount = 0;
    this.patternHistory = [];
    this.lastPatternType = null;
    this.patternRepeatCount = 0;
    this.lastWallSide = null;
    this.wallSideRepeatCount = 0;
    this.runSeed = 0;
    this.rngState = 0;
    this.rng = new SeededRandom();
    this.enemyRng = new SeededRandom();
    this.crystalRng = new SeededRandom();
    this.cardRng = new SeededRandom();
    this.activeRunTime = 0;
    this.runDepth = 0;
    this.nextPortalPattern = config.platforms.hubPortal.everyPatterns;
    this.doublePlatformsDisabled = false;
    this.crystalCount = config.crystals.startingCount || 0;
    this.upgradeCount = 0;
    this.speedUpgrade = 0;
    this.damage = 1;
    this.cardLevels = {};
    this.choosingCard = false;
    this.platforms = [];
    this.groups = [];
    this.portals = null;
    this.transitionRemaining = 0;
    this.portalOpening = false;
    this.hubMoving = false;
    this.entities = [];
    this.renderStats = { lastTime: performance.now(), elapsed: 0, frames: 0 };
    this.setRandomSeed();
    this.createBackground();
    this.proceduralCliffs = new ProceduralCliffs(this.world, assets.cliffWear);
    this.windStreaks = new WindStreaks(this.world, this.config.world.width, this.camera);
    this.platformFoliage = assets.platform && assets.foliage
      ? new PlatformFoliage(assets.platform.material, assets.foliage)
      : null;
    this.applyFoliageWindSettings();
    this.createPlayer();
    this.platformGenerator = new PlatformGenerator({
      config: this.config,
      player: this.player,
      random: () => this.random(),
      randomBetween: (min, max) => this.randomBetween(min, max),
      getPlayerSpeed: () => this.getPlayerHorizontalSpeed(),
    });
    this.createHub();
    this.createPool();
    this.createEntityPool();
    this.createUi();
    this.resize();
    this.restart(false, true);
  }

  setRandomSeed(seed = createRunSeed()) {
    this.rng.setSeed(seed);
    this.enemyRng.setSeed(seed ^ 0x9e3779b9);
    this.crystalRng.setSeed(seed ^ 0x85ebca6b);
    this.cardRng.setSeed(seed ^ 0xc2b2ae35);
    this.runSeed = this.rng.seed;
    this.rngState = this.rng.state;
  }

  random() {
    const value = this.rng.next();
    this.rngState = this.rng.state;
    return value;
  }

  randomBetween(min, max) {
    return min + this.random() * (max - min);
  }

  setMode(nextState) {
    this.mode = this.session.transition(nextState);
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
    this.keyLight.shadow.bias = Number.isFinite(lighting.shadowBias) ? lighting.shadowBias : -0.0005;
    this.keyLight.shadow.normalBias = Number.isFinite(lighting.shadowNormalBias) ? lighting.shadowNormalBias : 0.03;
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

  applyCliffSettings() {
    this.cliffBackground?.resize(this.config.world.width, this.worldHeight, this.config.platforms.depth, this.config.cliffs);
  }

  applyAtmosphereSettings() {
    this.cliffBackground?.setAtmosphere(this.config.atmosphere);
  }

  applyFoliageWindSettings() {
    this.platformFoliage?.setWind(this.config.foliageWind);
  }

  resizeBackgroundWall() {
    if (this.cliffBackground) {
      this.applyCliffSettings();
      return;
    }
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
    if (this.cliffBackground) {
      this.cliffBackground.reset();
      this.cliffBackground.render();
      return;
    }
    if (!this.backgroundWallSegments?.length) return;
    this.backgroundWallSegments.forEach((segment, index) => {
      segment.logicalTop = (index - 1) * this.backgroundWallHeight;
      segment.renderPreviousLogicalTop = segment.logicalTop;
    });
    this.applyBackgroundWallViews();
  }

  updateBackgroundWall(dt) {
    if (this.cliffBackground) {
      this.cliffBackground.advance(this.worldSpeed * dt);
      return;
    }
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
    if (this.cliffBackground) {
      this.cliffBackground.render(alpha);
      return;
    }
    if (!this.backgroundWallSegments?.length) return;
    for (const [index, segment] of this.backgroundWallSegments.entries()) {
      const previousTop = Number.isFinite(segment.renderPreviousLogicalTop) ? segment.renderPreviousLogicalTop : segment.logicalTop;
      const renderTop = lerp(previousTop, segment.logicalTop, alpha);
      segment.mesh.position.set(this.config.world.width / 2, this.logicalY(renderTop + (this.backgroundWallHeight + this.backgroundWallOverlap) / 2), index * 0.001);
    }
  }

  createBackground() {
    if (this.assets.cliff) {
      this.cliffBackground = new CliffBackground(this.assets.cliff.geometry, this.config.atmosphere, this.assets.cliffWear);
      this.world.add(this.cliffBackground.group);
      this.resizeBackgroundWall();
      return;
    }

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x2c1d2a, roughness: 0.84, metalness: 0.05 });
    this.background = new THREE.Mesh(new THREE.BoxGeometry(this.config.world.width + 24, this.config.world.height + 24, 4), wallMaterial);
    this.background.receiveShadow = true;
    this.background.position.z = -8;
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
    this.world.add(this.backgroundWallGroup);
    this.resizeBackgroundWall();
    this.loadBackgroundWallTexture();
  }

  loadBackgroundWallTexture() {
    const loader = new THREE.TextureLoader();
    loader.load(this.assets.wall, (texture) => {
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
    this.playerView = new THREE.Group();
    this.playerFallbackView = new THREE.Mesh(
      new THREE.BoxGeometry(this.config.player.width, this.config.player.height, 6),
      new THREE.MeshStandardMaterial({ color: 0xff7a45, roughness: 0.4, metalness: 0.1 }),
    );
    this.playerFallbackView.castShadow = true;
    this.playerFallbackView.receiveShadow = true;
    this.playerView.add(this.playerFallbackView);
    this.world.add(this.playerView);
    this.loadPlayerModel();
  }

  loadPlayerModel() {
    const { model: playerModelUrl, character: playerTextureUrl } = this.assets;
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => /^(blob:|data:)/.test(url) ? url : playerTextureUrl);
    const loader = new FBXLoader(manager);
    loader.load(
      playerModelUrl,
      (model) => {
        const bounds = new THREE.Box3().setFromObject(model);
        const sourceSize = bounds.getSize(new THREE.Vector3());
        const targetHeight = Math.max(1, Number(this.config.player.visualHeight) || 11);
        this.playerModel = model;
        this.playerModelBounds = bounds.clone();
        this.playerModelBaseScale = sourceSize.y > 0 ? targetHeight / sourceSize.y : 1;
        model.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = true;
          object.receiveShadow = true;
        });
        this.playerView.add(model);
        this.playerFallbackView.visible = false;
        const characterTexture = new THREE.TextureLoader().load(
          playerTextureUrl,
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
            model.traverse((object) => {
              if (!object.isMesh) return;
              const materials = Array.isArray(object.material) ? object.material : [object.material];
              materials.forEach((material) => {
                if (!material) return;
                material.map = texture;
                if (material.color) material.color.set(0xffffff);
                material.needsUpdate = true;
              });
            });
          },
          undefined,
          (error) => console.warn('D-PRESSED character texture failed to load', error),
        );
        characterTexture.colorSpace = THREE.SRGBColorSpace;
        if (model.animations?.length) {
          const runClip = model.animations.find((clip) => /^run$/i.test(clip.name))
            || model.animations.find((clip) => /free.?running/i.test(clip.name))
            || model.animations.find((clip) => /(^|[^a-z])run([^a-z]|$)/i.test(clip.name))
            || model.animations.find((clip) => /run/i.test(clip.name))
            || model.animations[0];
          this.playerMixer = new THREE.AnimationMixer(model);
          this.playerRunAction = this.playerMixer.clipAction(runClip);
          this.playerRunAction.play();
          this.playerMixer.timeScale = Math.max(0.1, Number(this.config.player.animationSpeed) || 1);
          console.info(`D-PRESSED player animation: ${runClip.name}`);
        } else {
          console.warn('D-PRESSED player model loaded without animation clips');
        }
        this.applyPlayerVisualSettings();
        this.applyAllViews();
      },
      undefined,
      (error) => console.warn('D-PRESSED player model failed to load, using fallback cube', error),
    );
  }

  applyPlayerVisualSettings() {
    const visualScale = clamp(Number(this.config.player.visualScale) || 1, 0.5, 2.5);
    if (this.playerFallbackView) this.playerFallbackView.scale.setScalar(visualScale);
    if (this.playerModel && this.playerModelBounds) {
      const scale = this.playerModelBaseScale * visualScale;
      this.playerModel.scale.setScalar(scale);
      this.playerModel.position.set(
        -((this.playerModelBounds.min.x + this.playerModelBounds.max.x) / 2) * scale,
        -this.player.height / 2 - this.playerModelBounds.min.y * scale,
        -((this.playerModelBounds.min.z + this.playerModelBounds.max.z) / 2) * scale,
      );
      this.playerModel.rotation.y = this.playerFacing.yaw;
    }
    if (this.playerMixer) this.playerMixer.timeScale = Math.max(0.1, Number(this.config.player.animationSpeed) || 1);
  }

  updatePlayerFacing(dt) {
    const playbackDirection = this.playerFacing.updateForPlayer(dt, this.player, this.input.held);
    if (this.playerModel) this.playerModel.rotation.y = this.playerFacing.yaw;
    if (this.playerRunAction) this.playerRunAction.timeScale = playbackDirection;
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
    if (this.assets.supports) {
      this.assets.supports.attach(this.hub, this.hubGroup);
      this.assets.supports.attach(this.hubLanding, this.hubLandingGroup);
      this.configurePlatformSupport(this.hub, 1);
      this.configurePlatformSupport(this.hubLanding, 0);
    }
    this.world.add(this.hubLandingGroup);
    this.stations = [];
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
    return station.label === 'SPEED' ? this.getPlayerHorizontalSpeed() : this.damage;
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
    const source = this.assets.platform;
    const mesh = new THREE.Mesh(
      source ? source.geometry.clone() : new THREE.BoxGeometry(1, 1, 1),
      source?.material ?? new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.08 }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.y = height;
    mesh.scale.z = this.config.platforms.depth;
    this.setPlatformRenderWidth(mesh, width);
    return mesh;
  }

  setPlatformRenderWidth(mesh, width) {
    if (mesh.scale.x === width) return;
    if (this.assets.platform) fitStonePlatform(mesh, this.assets.platform, width);
    mesh.scale.x = width;
  }

  createPool() {
    const height = this.config.platforms.height;
    const fallback = this.assets.platform ? null : this.makePlatformMesh(1, height);
    for (let index = 0; index < this.config.platforms.poolSize + PLATFORM_RESERVE; index += 1) {
      const node = new THREE.Group();
      const mesh = fallback?.clone() ?? this.makePlatformMesh(1, height);
      node.add(mesh);
      node.visible = false;
      this.world.add(node);
      const platform = { node, mesh, x: 0, y: 0, width: 1, height: this.config.platforms.height, active: false, previousY: 0, renderPreviousX: 0, renderPreviousY: 0, patternType: 'SINGLE', spawnContent: {}, portalPlatform: false, recycledThisFrame: false, enemy: null, crystals: [], chest: null };
      this.assets.supports?.attach(platform, node);
      this.platforms.push(platform);
    }
  }

  configurePlatformSupport(platform, fixedVariant) {
    this.assets.supports?.configure(platform, this.config, this.runSeed, fixedVariant);
    platform.support?.layers.set(this.config.platformSupports.procedural ? 1 : 0);
  }

  applyPlatformSupportSettings() {
    if (!this.assets.supports) return;
    for (const platform of [this.hub, this.hubLanding, ...this.platforms]) {
      this.assets.supports.resize(platform, this.config.platformSupports);
    }
    this.applyAllViews();
  }

  applyProceduralCliffSettings() {
    const enabled = this.config.platformSupports.procedural;
    this.proceduralCliffs.group.visible = enabled;
    for (const platform of [this.hub, this.hubLanding, ...this.platforms]) platform.support?.layers.set(enabled ? 1 : 0);
    this.proceduralCliffsDirty = true;
    if (!enabled) this.proceduralCliffs.reset(this.proceduralCliffs.origin);
    else this.applyProceduralCliffView(this.runDepth, true);
  }

  applyProceduralCliffView(scrolled, force = false) {
    if (!this.config.platformSupports.procedural || this.proceduralCliffs.origin == null) return;
    if (this.proceduralCliffsDirty || force) {
      const ledges = this.platforms.filter((platform) => platform.active && platform.node.visible);
      if (this.hubGroup.visible) ledges.push(this.hub);
      if (this.hubLanding.active && this.hubLandingGroup.visible) ledges.push(this.hubLanding);
      this.proceduralCliffs.sync(ledges, this.runDepth, this.config, this.worldHeight, this.runSeed, force);
      this.proceduralCliffsDirty = false;
    }
    this.proceduralCliffs.render(scrolled, this.worldHeight);
  }

  createEntityPool() {
    const enemyGeometry = new THREE.BoxGeometry(8, 8, 6);
    mapBoxFront(enemyGeometry);
    this.enemyTextures = Object.fromEntries(Object.keys(ENEMY_COLORS).map((type) => [type, createEnemyTexture(type)]));
    const spikeGeometry = new THREE.ConeGeometry(0.85, 2.6, 4);
    const spikeMaterial = new THREE.MeshStandardMaterial({ color: 0xffd7ac });
    const chestGeometry = new THREE.BoxGeometry(10, 8, 6);
    const crystalGeometry = createCrystalGeometry();
    mapBoxFront(chestGeometry);
    const chestMaterial = new THREE.MeshStandardMaterial({ map: createChestTexture(), roughness: 0.72 });
    const crystalMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true, emissive: 0x801741, emissiveIntensity: 1.15, roughness: 0.22, metalness: 0.25,
    });
    const makeCrystalView = () => {
      const view = new THREE.Mesh(crystalGeometry, crystalMaterial);
      view.castShadow = true;
      view.receiveShadow = true;
      view.visible = false;
      this.world.add(view);
      return view;
    };
    for (const platform of this.platforms) {
      const enemyView = new THREE.Mesh(enemyGeometry, new THREE.MeshStandardMaterial({ map: this.enemyTextures.static, roughness: 0.65 }));
      const spikes = new THREE.Group();
      for (const x of [-2.5, 0, 2.5]) {
        const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
        spike.position.set(x, 5, 0);
        spikes.add(spike);
      }
      spikes.visible = false;
      enemyView.add(spikes);
      const chestView = new THREE.Mesh(chestGeometry, chestMaterial);
      enemyView.castShadow = true;
      enemyView.receiveShadow = true;
      chestView.castShadow = true;
      chestView.receiveShadow = true;
      this.world.add(enemyView, chestView);
      enemyView.visible = false;
      chestView.visible = false;
      this.entities.push({ kind: 'enemy', view: enemyView, platform: null, x: 0, y: 0, width: 8, height: 8, defeated: false, active: false, health: 3, hitFlightTimer: 0, renderOffsetX: 0, renderOffsetY: 0, renderOffsetZ: 0, rotation: 0, renderPreviousX: 0, renderPreviousY: 0, renderPreviousOffsetX: 0, renderPreviousOffsetY: 0, renderPreviousOffsetZ: 0, renderPreviousRotation: 0, dying: false, deathVelocityX: 0, deathVelocityY: 0, deathVelocityZ: 0, deathDepthRemaining: 0, deathRotation: 0 });
      this.entities.push({ kind: 'chest', view: chestView, platform: null, x: 0, y: 0, width: 10, height: 8, active: false, opened: false, triggerOnly: true, solid: false, renderPreviousX: 0, renderPreviousY: 0, renderPreviousOffsetX: 0, renderPreviousOffsetY: 0, renderPreviousRotation: 0 });
      for (let side = 0; side < 3; side += 1) {
        const crystalView = makeCrystalView();
        const crystal = { kind: 'crystal', view: crystalView, platform: null, x: 0, y: 0, width: 6, height: 6, active: false, collecting: false, phase: 'idle', floorY: 0, velocityX: 0, velocityY: 0, elapsed: 0, startX: 0, startY: 0, platformOffset: this.config.crystals.platformOffset ?? 1, bobPhase: side * Math.PI, rotationSpeed: 0, rotation: 0, renderOffsetX: 0, renderOffsetY: 0, renderPreviousX: 0, renderPreviousY: 0, renderPreviousOffsetX: 0, renderPreviousOffsetY: 0, renderPreviousRotation: 0 };
        crystal.motion = new CrystalMotion(this, crystal);
        this.entities.push(crystal);
      }
    }
    for (let index = 0; index < 48; index += 1) {
      const view = makeCrystalView();
      const burst = { kind: 'burst', view, platform: null, x: 0, y: 0, width: 6, height: 6, active: false, phase: 'burst', floorY: 0, velocityX: 0, velocityY: 0, bounces: 0, elapsed: 0, startX: 0, startY: 0, counted: false, rotation: 0, rotationSpeed: 0, renderPreviousX: 0, renderPreviousY: 0, renderPreviousOffsetX: 0, renderPreviousOffsetY: 0, renderPreviousRotation: 0 };
      burst.motion = new CrystalMotion(this, burst);
      this.entities.push(burst);
    }
  }

  createUi() {
    this.ui = document.createElement('div');
    this.ui.className = 'three-ui';
    this.ui.innerHTML = '<div class="three-ui__counter">CRYSTALS <strong data-crystals>0</strong></div><div class="three-ui__stats" aria-live="off">FPS <strong data-fps>--</strong><br>TRIANGLES <strong data-triangles>--</strong><br>VERTICES <strong data-vertices>--</strong></div><div class="three-ui__player-stats">SPEED <strong data-player-speed>0</strong> / <strong data-player-max-speed>0</strong><br>DAMAGE <strong data-player-damage>0</strong></div><div class="three-ui__hint">HOLD / D TO MOVE RIGHT · R TO RESTART · P FOR MAX MODE</div><div class="three-ui__gameover" data-gameover hidden>GAME OVER<br><button type="button" data-restart>RESTART</button></div>';
    document.body.append(this.ui);
    this.counter = this.ui.querySelector('[data-crystals]');
    this.fpsCounter = this.ui.querySelector('[data-fps]');
    this.trianglesCounter = this.ui.querySelector('[data-triangles]');
    this.verticesCounter = this.ui.querySelector('[data-vertices]');
    this.playerSpeedCounter = this.ui.querySelector('[data-player-speed]');
    this.playerMaxSpeedCounter = this.ui.querySelector('[data-player-max-speed]');
    this.playerDamageCounter = this.ui.querySelector('[data-player-damage]');
    this.gameOverPanel = this.ui.querySelector('[data-gameover]');
    this.ui.querySelector('[data-restart]').addEventListener('click', () => this.restart());
    this.cardPanel = document.createElement('section');
    this.cardPanel.className = 'three-ui__cards';
    this.cardPanel.hidden = true;
    this.cardPanel.setAttribute('role', 'dialog');
    this.cardPanel.setAttribute('aria-modal', 'true');
    this.cardPanel.setAttribute('aria-label', 'Выбор улучшения');
    this.cardPanel.addEventListener('keydown', (event) => {
      const buttons = [...this.cardPanel.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      const tabEnd = event.key === 'Tab' && (event.shiftKey ? index === 0 : index === buttons.length - 1);
      if (!direction && !tabEnd) return;
      event.preventDefault();
      const step = direction || (event.shiftKey ? -1 : 1);
      buttons[(index + step + buttons.length) % buttons.length].focus();
    });
    this.ui.append(this.cardPanel);
    this.portalCurtain = document.createElement('div');
    this.portalCurtain.className = 'three-ui__portal-curtain';
    this.portalCurtain.setAttribute('aria-hidden', 'true');
    this.portalCurtain.hidden = true;
    this.ui.append(this.portalCurtain);
  }

  openCardChoice() {
    const firstOffer = !this.choosingCard;
    if (firstOffer) this.cardReturnFocus = document.activeElement;
    this.choosingCard = true;
    this.cardPanel.removeAttribute('aria-busy');
    const cost = this.getRunCardPrice();
    const offers = drawRunCards(() => this.cardRng.next(), this.cardOffers, this.config.cards);
    this.cardOffers = offers;
    this.cardPanel.innerHTML = '';
    const balance = document.createElement('div');
    balance.textContent = this.crystalCount;
    balance.setAttribute('aria-label', `Кристаллов: ${this.crystalCount}`);
    balance.className = 'three-ui__card-balance';
    this.cardPanel.append(balance);
    const heading = document.createElement('h2');
    heading.textContent = 'Выбери улучшение';
    this.cardPanel.append(heading);
    const row = document.createElement('div');
    row.className = 'three-ui__card-row';
    this.cardPanel.append(row);
    for (const card of offers) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'three-ui__card';
      button.dataset.card = card.id;
      button.setAttribute('aria-pressed', 'false');
      const icon = document.createElement('span');
      icon.className = 'three-ui__card-icon';
      icon.setAttribute('aria-hidden', 'true');
      const title = document.createElement('strong');
      title.textContent = ({ damage: 'Урон', bounty: 'Бонус за победу', stomp: 'Урон сверху', speed: 'Скорость', attackSpeed: 'Темп ударов' })[card.id] ?? card.name;
      const setting = this.config.cards[card.id];
      const bonus = this.cardBonus(card.id);
      const nextBonus = Math.max((this.cardLevels[card.id] || 0) + 1, Number(setting.grantImmediately)) * setting.bonus;
      const gain = nextBonus - bonus;
      const current = this.getRunCardStat(card.id);
      const format = (value) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
      const increment = document.createElement('span');
      increment.className = 'three-ui__card-gain';
      increment.textContent = `+${format(gain)}`;
      const stat = document.createElement('span');
      stat.className = 'three-ui__card-stat';
      stat.textContent = `${format(current)} → ${format(current + gain)}`;
      button.setAttribute('aria-label', `${card.name}. ${card.description(gain)} ${stat.textContent}. Цена ${cost} кристаллов.`);
      const price = document.createElement('span');
      price.className = 'three-ui__card-price';
      price.textContent = cost;
      price.setAttribute('aria-label', `${cost} кристаллов`);
      button.append(icon, title, increment, stat, price);
      button.disabled = this.crystalCount < cost;
      button.addEventListener('click', () => {
        if (this.cardOffers !== offers) return;
        const remaining = this.crystalCount - cost;
        this.animateCardChoice(() => this.chooseRunCard(card), button, remaining >= this.getRunCardPrice(1));
      });
      row.append(button);
    }
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'three-ui__card-skip';
    skip.textContent = 'Пропустить';
    skip.addEventListener('click', () => {
      if (!this.cardPanel.hasAttribute('aria-busy')) this.chooseRunCard();
    });
    const actions = document.createElement('div');
    actions.className = 'three-ui__card-actions';
    const reroll = document.createElement('button');
    reroll.type = 'button';
    reroll.className = 'three-ui__card-skip';
    reroll.textContent = `Обновить · ◆ ${REROLL_PRICE}`;
    reroll.disabled = this.crystalCount < REROLL_PRICE || this.enabledCardCount() <= 3;
    reroll.addEventListener('click', () => {
      if (this.cardOffers === offers) this.animateCardChoice(() => this.rerollRunCards(), null, true);
    });
    actions.append(reroll, skip);
    this.cardPanel.append(actions);
    this.cardPanel.hidden = false;
    this.positionCardChoice();
    if (firstOffer && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.cardPanel.animate([
        { opacity: 0, transform: 'translateY(calc(-50% + 11px))' },
        { opacity: 1, transform: 'translateY(-50%)' },
      ], { duration: 290, easing: 'ease-out' });
    }
    this.cardPanel.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  getRunCardStat(id) {
    if (id === 'speed') return this.getPlayerHorizontalSpeed();
    const base = id === 'damage' ? this.damage : id === 'attackSpeed' ? Math.max(0.5, this.config.player.attacksPerSecond) : 0;
    return base + this.cardBonus(id);
  }

  async animateCardChoice(apply, selected, refresh) {
    const panel = this.cardPanel;
    if (panel.hasAttribute('aria-busy')) return;
    const offers = this.cardOffers;
    panel.setAttribute('aria-busy', 'true');
    selected?.setAttribute('aria-pressed', 'true');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (selected && !reduced) await new Promise((resolve) => setTimeout(resolve, 180));
    if (this.cardOffers !== offers) return;
    if (refresh && !reduced) {
      const cards = [...panel.querySelectorAll('.three-ui__card')];
      await Promise.all(cards.map((card) => card.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(90deg)' }],
        { duration: 160, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {})));
    }
    if (this.cardOffers !== offers) return;
    panel.removeAttribute('aria-busy');
    apply();
    if (refresh && !reduced && this.choosingCard && this.cardOffers !== offers) {
      const newOffers = this.cardOffers;
      panel.setAttribute('aria-busy', 'true');
      const cards = [...panel.querySelectorAll('.three-ui__card')];
      await Promise.all(cards.map((card) => card.animate([{ transform: 'rotateY(-90deg)' }, { transform: 'rotateY(0deg)' }],
        { duration: 185, easing: 'ease-out' }).finished.catch(() => {})));
      if (this.cardOffers === newOffers) panel.removeAttribute('aria-busy');
    }
  }

  positionCardChoice() {
    if (!this.choosingCard) return;
    const viewport = this.canvas.getBoundingClientRect();
    this.cardPanel.style.left = `${viewport.left}px`;
    this.cardPanel.style.width = `${viewport.width}px`;
    this.cardPanel.style.top = `${viewport.top + viewport.height / 2}px`;
  }

  getRunCardPrice(additionalPurchases = 0) {
    const purchases = Object.values(this.cardLevels).reduce((total, level) => total + level, 0);
    return Math.round(CARD_PRICE * CARD_PRICE_MULTIPLIER ** (purchases + additionalPurchases));
  }

  chooseRunCard(card) {
    if (!this.choosingCard) return;
    if (card) {
      const cost = this.getRunCardPrice();
      if (!this.cardOffers.includes(card) || this.crystalCount < cost) return;
      this.crystalCount -= cost;
      this.cardLevels[card.id] = (this.cardLevels[card.id] || 0) + 1;
      this.updateCounter();
      if (this.crystalCount >= this.getRunCardPrice()) {
        this.openCardChoice();
        return;
      }
    }
    this.closeCardChoice();
  }

  rerollRunCards() {
    if (!this.choosingCard || this.crystalCount < REROLL_PRICE || this.enabledCardCount() <= 3) return;
    this.crystalCount -= REROLL_PRICE;
    this.updateCounter();
    this.openCardChoice();
  }

  closeCardChoice() {
    this.choosingCard = false;
    this.cardOffers = [];
    if (this.cardPanel) {
      this.cardPanel.hidden = true;
      this.cardPanel.removeAttribute('aria-busy');
      if (this.cardReturnFocus?.isConnected) this.cardReturnFocus.focus({ preventScroll: true });
      this.cardReturnFocus = null;
    }
    this.input.held = false;
  }

  cardBonus(id) {
    const setting = this.config.cards[id];
    const purchasedLevels = setting.enabled ? this.cardLevels?.[id] || 0 : 0;
    return Math.max(purchasedLevels, Number(setting.grantImmediately)) * setting.bonus;
  }

  enabledCardCount() {
    return Object.values(this.config.cards).filter(({ enabled }) => enabled).length;
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
    this.camera.updateMatrixWorld();
    this.renderer.setSize(viewportWidth, height, false);
    if (this.background) {
      this.background.scale.set(1, this.worldHeight / 240, 1);
      this.background.position.set(this.config.world.width / 2, this.worldHeight / 2, -4);
    }
    this.resizeBackgroundWall();
    this.hub.y = this.hubTopY();
    this.hubLanding.y = this.hub.y + this.hub.height + this.config.platforms.minGap;
    this.hubLanding.previousY = this.hubLanding.y;
    this.hubLanding.active = true;
    this.applyHubView();
    this.applyHubLandingView();
    this.positionCardChoice();
    if (this.mode === 'hub') this.updateHubRouteVisibility();
    this.proceduralCliffsDirty = true;
    this.applyProceduralCliffView(this.runDepth, this.hubGroup.visible || (this.hubMoving && this.hubLandingGroup.visible));
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
    this.applyProceduralCliffView(this.runDepth);
    this.applyHubView();
    this.hubGroup.position.set(0, this.logicalY(this.hub.y + this.hub.height / 2), 0);
    this.applyHubLandingView();
    this.playerView.position.set(this.player.x + this.player.width / 2, this.logicalY(this.player.y + this.player.height / 2), 1);
    for (const entity of this.entities) this.applyEntityView(entity);
  }

  captureRenderState() {
    this.renderPreviousRunDepth = this.runDepth;
    this.player.renderPreviousX = this.player.x;
    this.player.renderPreviousY = this.player.y;
    this.hub.renderPreviousY = this.hub.y;
    this.hubLanding.renderPreviousY = this.hubLanding.y;
    for (const platform of this.platforms) {
      platform.renderPreviousX = platform.x;
      platform.renderPreviousY = platform.y;
    }
    this.cliffBackground?.capture();
    for (const segment of this.backgroundWallSegments || []) segment.renderPreviousLogicalTop = segment.logicalTop;
    for (const entity of this.entities) this.captureEntityRenderState(entity);
  }

  captureEntityRenderState(entity) {
    entity.renderPreviousX = entity.x;
    entity.renderPreviousY = entity.y;
    entity.renderPreviousOffsetX = entity.renderOffsetX || 0;
    entity.renderPreviousOffsetY = entity.renderOffsetY || 0;
    entity.renderPreviousOffsetZ = entity.renderOffsetZ || 0;
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
    const scrolled = lerp(this.renderPreviousRunDepth ?? this.runDepth, this.runDepth, blend);
    this.applyProceduralCliffView(scrolled);
    this.updateTrailingPlatformShadows(scrolled);
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

  platformEdgeExtensions(platform) {
    const worldWidth = this.config.world.width;
    const configuredMaxWidth = Number(this.config.platforms.maxWidth);
    const widthLimit = Number.isFinite(configuredMaxWidth) && configuredMaxWidth > 0 ? configuredMaxWidth : platform.width;
    // Extend the render mesh past the camera edge while keeping the collider inside the world.
    const extension = Math.max(MIN_PLATFORM_EDGE_EXTENSION, Math.min(platform.width, widthLimit) + 1);
    const left = platform.x <= 0.001 ? extension : 0;
    const right = platform.x + platform.width >= worldWidth - 0.001 ? extension : 0;
    return { left, right };
  }

  applyPlatformView(platform, renderX = platform.x, renderY = platform.y) {
    const { left, right } = this.platformEdgeExtensions(platform);
    const renderWidth = platform.width + left + right;
    platform.node.position.set(renderX - left + renderWidth / 2, this.logicalY(renderY + platform.height / 2), 0);
    this.setPlatformRenderWidth(platform.mesh, renderWidth);
    if (platform.active) this.platformFoliage?.fit(platform.mesh, left, platform.width, platform.foliageSeed);
    if (platform.support?.visible) platform.support.position.x = left - renderWidth / 2 + platform.supportOffset;
  }

  applyHubView() {
    const { left, right } = this.platformEdgeExtensions(this.hub);
    const renderWidth = this.hub.width + left + right;
    this.hubMesh.position.x = this.hub.x - left + renderWidth / 2;
    this.setPlatformRenderWidth(this.hubMesh, renderWidth);
    this.platformFoliage?.fit(this.hubMesh, left, this.hub.width, 'hub');
    if (this.hub.support) this.hub.support.position.x = this.hub.x + this.hub.supportOffset;
  }

  applyHubLandingView(renderY = this.hubLanding.y) {
    const { left, right } = this.platformEdgeExtensions(this.hubLanding);
    const renderWidth = this.hubLanding.width + left + right;
    this.hubLandingGroup.position.set(this.hubLanding.x - left + renderWidth / 2, this.logicalY(renderY + this.hubLanding.height / 2), 0);
    this.setPlatformRenderWidth(this.hubLandingMesh, renderWidth);
    this.platformFoliage?.fit(this.hubLandingMesh, left, this.hubLanding.width, 'landing');
    if (this.hubLanding.support) this.hubLanding.support.position.x = left - renderWidth / 2 + this.hubLanding.supportOffset;
  }

  configurePlatform(platform, x, y, width, type = 'SINGLE') {
    this.clearPlatformEntities(platform);
    const maximumX = this.config.world.width - width;
    let spawnX = clamp(Math.round(x), 0, maximumX);
    platform.x = spawnX;
    platform.y = Math.round(y);
    platform.previousY = platform.y;
    platform.width = width;
    // Pool slots move and get reused. Key decoration to the new ledge in route coordinates.
    platform.foliageSeed = this.runSeed
      ^ Math.imul(platform.x, 0x9e3779b1)
      ^ Math.imul(Math.round(this.runDepth + platform.y), 0x85ebca6b);
    platform.patternType = type;
    platform.portalPlatform = false;
    platform.active = true;
    platform.node.visible = true;
    platform.renderPreviousX = platform.x;
    platform.renderPreviousY = platform.y;
    this.configurePlatformSupport(platform);
    this.proceduralCliffsDirty = true;
    this.applyPlatformView(platform);
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
      entity.hitFlightTimer = 0;
      entity.renderOffsetX = 0;
      entity.renderOffsetY = 0;
      entity.renderOffsetZ = 0;
      entity.renderPreviousOffsetZ = 0;
      if (entity.kind === 'enemy') { entity.rotation = 0; entity.view.rotation.z = 0; }
      if (entity.kind === 'crystal' || entity.kind === 'burst') { entity.rotation = 0; entity.rotationSpeed = 0; entity.view.rotation.y = 0; }
      entity.dying = false;
      entity.deathVelocityX = 0;
      entity.deathVelocityY = 0;
      entity.deathVelocityZ = 0;
      entity.deathDepthRemaining = 0;
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
    platform.chest = null;
  }

  choosePattern(canBuildDouble = true) {
    return this.platformGenerator.choosePattern({
      patternCount: this.patternCount,
      patternHistory: this.patternHistory,
      lastPatternType: this.lastPatternType,
      patternRepeatCount: this.patternRepeatCount,
      doublePlatformsDisabled: this.doublePlatformsDisabled || !canBuildDouble,
    });
  }

  wouldRepeatPattern(candidate) {
    return this.platformGenerator.wouldRepeatPattern(this.patternHistory, candidate);
  }

  registerPattern(type, count = true) {
    if (count) this.patternCount += 1;
    if (this.lastPatternType === type) this.patternRepeatCount += 1;
    else { this.lastPatternType = type; this.patternRepeatCount = 1; }
    this.patternHistory.push(type);
    if (this.patternHistory.length > 24) this.patternHistory.shift();
  }

  currentPlatformScale() {
    return this.platformGenerator.currentPlatformScale(this.activeRunTime, this.patternCount);
  }

  randomWidth() {
    if (this.maximumMode) return Math.max(8, Math.floor(this.config.platforms.minWidth));
    return this.platformGenerator.randomWidth(this.activeRunTime, this.patternCount);
  }

  randomProgressiveWidth() {
    return this.platformGenerator.randomProgressiveWidth(this.activeRunTime, this.patternCount);
  }

  randomPlatformX(width) {
    return this.platformGenerator.randomPlatformX(width);
  }

  randomWallX(width, previousPlatform, gap) {
    const result = this.platformGenerator.randomWallX(width, this.lastWallSide, this.wallSideRepeatCount);
    const x = this.platformGenerator.avoidRepeatedWall(previousPlatform, result.x, width, gap);
    const side = x === 0 ? 'left' : 'right';
    this.wallSideRepeatCount = side === this.lastWallSide ? this.wallSideRepeatCount + 1 : 1;
    this.lastWallSide = side;
    return x;
  }

  singleGroupPlacement(type, width, previousPlatform, gap) {
    if (type === 'WALL') return { width, x: this.randomWallX(width, previousPlatform, gap) };
    return this.platformGenerator.singlePlacement(previousPlatform, width, gap);
  }

  configureGroupContent(group, type) {
    this.platformGenerator.configureGroupContent(group, type);
    for (const platform of group) {
      if (platform.spawnContent.enemy) this.spawnEnemy(platform);
      if (platform.spawnContent.crystals) this.spawnCrystals(platform);
      if (platform.spawnContent.chest) this.spawnChest(platform);
    }
  }

  generateInitial(preserveProgression = false) {
    this.groups = [];
    this.patternHistory = [];
    this.lastPatternType = null;
    this.patternRepeatCount = 0;
    this.lastWallSide = null;
    this.wallSideRepeatCount = 0;

    const routeSize = this.platforms.length - PLATFORM_RESERVE;
    for (const platform of this.platforms.slice(routeSize)) {
      platform.active = false;
      platform.node.visible = false;
    }

    let previous = this.hubLanding;
    for (let index = 0; index < routeSize;) {
      const gap = this.randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap);
      const type = this.choosePattern(index + 1 < routeSize);
      const size = type === 'DOUBLE' ? 2 : 1;
      const group = this.platforms.slice(index, index + size);
      const y = this.nextRouteY(previous, gap);
      this.configureRouteGroup(group, y, type, previous, gap);
      this.groups.push(group);
      this.registerPattern(type, !preserveProgression);
      previous = group.at(-1);
      index += size;
    }
  }

  restartWithMaximumMode(enabled) {
    this.maximumMode = enabled;
    this.restart();
  }

  getMaximumWorldSpeed() {
    const flow = this.config.platforms;
    return Math.max(0, Number(flow.initialWorldSpeed) || 0, Number(flow.maxWorldSpeed) || 0, Number(flow.targetWorldSpeed) || 0);
  }

  restart(preserveProgression = false, startInHub = true) {
    this.closeCardChoice();
    this.input.held = false;
    this.transitionRemaining = 0;
    this.portalOpening = false;
    this.setPortalCurtain(0);
    if (!preserveProgression) {
      this.setRandomSeed();
      this.difficultyTime = 0;
      this.activeRunTime = 0;
      this.runDepth = 0;
      this.doublePlatformsDisabled = false;
      this.patternCount = 0;
      this.patternHistory = [];
      this.lastPatternType = null;
      this.patternRepeatCount = 0;
      this.lastWallSide = null;
      this.wallSideRepeatCount = 0;
      this.worldSpeed = this.maximumMode ? this.getMaximumWorldSpeed() : this.config.platforms.initialWorldSpeed;
      this.crystalCount = this.config.crystals.startingCount || 0;
      this.damage = 1;
      this.cardLevels = {};
      this.upgradeCount = 0;
      this.speedUpgrade = 0;
      this.nextPortalPattern = Math.max(1, this.config.platforms.hubPortal.everyPatterns);
      this.stations.forEach((station) => { station.level = 0; station.passes = 0; station.passWindow = 0; station.firstDirection = 0; station.previousCenter = null; });
    }
    this.gameOver = false;
    this.gameOverPanel.hidden = true;
    this.setMode(GAME_STATES.RUN);
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
    this.playerFacing.reset();
    this.attackCooldown = 0;
    this.player.groundedOn = null;
    this.player.vx = 0;
    this.player.vy = 0;
    this.setMode(GAME_STATES.RUN);
    this.hubMoving = false;
    this.hubGroup.visible = false;
    this.hub.y = this.hubTopY();
    this.hubLanding.y = this.hub.y + this.hub.height + this.config.platforms.minGap;
    this.hubLanding.previousY = this.hubLanding.y;
    this.hubLanding.active = true;
    this.proceduralCliffs.reset(this.hub.y + this.runDepth - 104);
    this.proceduralCliffs.group.visible = this.config.platformSupports.procedural;
    this.updateTrailingPlatformShadows(this.runDepth, true);
    this.resetBackgroundWall();
    this.clearEntities();
    this.generateInitial(preserveProgression);
  }

  enterHub() {
    this.setMode(GAME_STATES.HUB);
    this.hubGroup.visible = true;
    this.hubLandingGroup.visible = true;
    this.hub.y = this.hubTopY();
    this.hubLanding.y = this.hub.y + this.hub.height + this.config.platforms.minGap;
    this.hubLanding.previousY = this.hubLanding.y;
    this.updateHubRouteVisibility();
    this.hubLandingGroup.visible = true;
    this.proceduralCliffsDirty = true;
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
    this.rebuildRoute(true);
    this.enterHub();
    this.portalOpening = true;
    this.transitionRemaining = PORTAL_OPEN_TIME + PORTAL_COVERED_TIME;
    this.resetRenderInterpolation();
    this.applyAllViews();
  }

  setPortalCurtain(coverage) {
    if (!this.portalCurtain) return;
    const amount = clamp(coverage, 0, 1);
    this.portalCurtain.hidden = amount === 0;
    this.portalCurtain.style.setProperty('--curtain-offset', `${(1 - amount * amount * (3 - 2 * amount)) * 100}%`);
  }

  exitHub() {
    this.setMode(GAME_STATES.RUN);
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
      entity.hitFlightTimer = 0;
      entity.dying = false;
      entity.collecting = false;
      entity.phase = 'idle';
      entity.bounces = 0;
      entity.platform = null;
      entity.deathVelocityX = 0;
      entity.deathVelocityY = 0;
      entity.deathVelocityZ = 0;
      entity.deathDepthRemaining = 0;
      entity.renderOffsetX = 0;
      entity.renderOffsetY = 0;
      entity.renderOffsetZ = 0;
      entity.renderPreviousOffsetZ = 0;
      if (entity.kind === 'enemy') { entity.rotation = 0; entity.view.rotation.z = 0; }
      if (entity.view) entity.view.visible = false;
    }
    for (const platform of this.platforms) { platform.enemy = null; platform.crystals = []; platform.chest = null; platform.portalPlatform = false; }
    for (const group of this.groups) group.isPortalPair = false;
    this.clearPortals();
  }

  update(dt) {
    if (this.paused) return;
    if (dt > 0.5) {
      this.accumulator = 0;
      dt = 0;
    }
    const frameDelta = Math.min(dt, 0.1);
    this.accumulator += frameDelta;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 16) { this.fixedUpdate(STEP); this.accumulator -= STEP; steps += 1; }
    if (!this.gameOver && !this.choosingCard) this.updatePlayerFacing(frameDelta);
    if (this.playerMixer) this.playerMixer.update(frameDelta);
    this.windStreaks.update(frameDelta, this.worldHeight);
    this.platformFoliage?.update(frameDelta);
    this.playerSpeedCounter.textContent = Math.abs(this.player.vx).toFixed(1);
    this.playerMaxSpeedCounter.textContent = String(this.getPlayerHorizontalSpeed());
    this.playerDamageCounter.textContent = String(this.damage + this.cardBonus('damage'));
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
    if (this.gameOver || this.choosingCard) return;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    if (this.portalOpening || this.mode === GAME_STATES.TRANSITION) {
      this.transitionRemaining = Math.max(0, this.transitionRemaining - dt);
      if (this.portalOpening) {
        this.setPortalCurtain(this.transitionRemaining / PORTAL_OPEN_TIME);
        if (this.transitionRemaining <= 1e-8) {
          this.portalOpening = false;
          this.openCardChoice();
        }
      } else {
        this.setPortalCurtain(1 - this.transitionRemaining / PORTAL_CLOSE_TIME);
        if (this.transitionRemaining <= 1e-8) {
          this.setPortalCurtain(1);
          this.enterHubFromPortal();
        }
      }
      return;
    }
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
    this.difficultyTime += dt;
    this.activeRunTime += dt;
    const flow = this.config.platforms;
    if (this.maximumMode) {
      this.worldSpeed = this.getMaximumWorldSpeed();
    } else if (flow.useFlowProgression) {
      const initialSpeed = Number(flow.initialWorldSpeed) || 0;
      const targetSpeed = Number(flow.targetWorldSpeed) || initialSpeed;
      const duration = Math.max(0.001, Number(flow.targetWorldSpeedTime) || 1);
      const progressedSpeed = initialSpeed + ((targetSpeed - initialSpeed) / duration) * this.difficultyTime;
      this.worldSpeed = targetSpeed >= initialSpeed
        ? Math.min(progressedSpeed, targetSpeed)
        : Math.max(progressedSpeed, targetSpeed);
    } else if (flow.increaseWorldSpeed) {
      const acceleration = Math.max(0, Number(flow.worldSpeedIncrease) || 0);
      const maximumSpeed = Math.max(Number(flow.initialWorldSpeed) || 0, Number(flow.maxWorldSpeed) || 0);
      this.worldSpeed = Math.min(this.worldSpeed + acceleration * dt, maximumSpeed);
    }
    this.runDepth += this.worldSpeed * dt;
    if (!this.doublePlatformsDisabled && this.difficultyTime >= this.config.platforms.doublePlatformsDuration) this.doublePlatformsDisabled = true;
    for (const platform of this.platforms) { if (!platform.active) continue; platform.previousY = platform.y; platform.y -= this.worldSpeed * dt; }
    this.updateBackgroundWall(dt);
    if (this.hubMoving) {
      this.hub.y -= this.worldSpeed * dt;
      this.hubLanding.previousY = this.hubLanding.y;
      this.hubLanding.y -= this.worldSpeed * dt;
      const offscreenMargin = this.getPlatformOffscreenMargin();
      if (this.hub.y + this.hub.height < -offscreenMargin) {
        this.retainPlatformShadow(this.hub, this.hubMesh, this.hubGroup);
        this.hubGroup.visible = false;
      }
      if (this.hubLanding.y + this.hubLanding.height < -offscreenMargin) {
        this.retainPlatformShadow(this.hubLanding, this.hubLandingMesh, this.hubLandingGroup);
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
    if (this.gameOver) return;
    this.updateEntities(dt);
    if (this.gameOver) return;
    this.updatePortals();
    if (this.player.y + this.player.height < 0 || this.player.y > this.worldHeight) this.setGameOver();
    this.applyAllViews();
  }

  updateHorizontal(dt) {
    const direction = this.input.held ? 1 : -1;
    const target = direction * this.getPlayerHorizontalSpeed();
    const turning = this.player.vx !== 0 && Math.sign(this.player.vx) !== direction;
    this.player.vx = moveTowards(this.player.vx, target, (turning ? this.config.player.braking : this.config.player.acceleration) * dt);
    this.player.x = clamp(this.player.x + this.player.vx * dt, 0, this.config.world.width - this.player.width);
  }

  getPlayerHorizontalSpeed() {
    const baseSpeed = Math.max(0, Number(this.config.player.maxHorizontalSpeed) || 0);
    if (this.maximumMode) return Math.max(baseSpeed, Number(this.config.upgrades.speedMaximum) || 0);
    return baseSpeed + this.speedUpgrade + this.cardBonus('speed');
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
    const enemyBounds = { x: enemy.x, y: platform.y - enemy.height, width: enemy.width, height: enemy.height };
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
    // Keep two rows of platforms above the screen so their shadows can scroll out.
    return 2 * (platformHeight + segmentGap);
  }

  getTrailingShadowMargin() {
    // Compare the top of the view at platform depth and at the far end of its shadow.
    const depth = this.config.platforms.depth / 2;
    const recess = maximumCliffRecess(this.config.world.width, this.config.platformSupports);
    const light = this.keyLight.position.clone().sub(this.keyLight.target.position).normalize();
    const topRay = new THREE.Vector3(0, 1, 0.5).unproject(this.camera).sub(this.camera.position);
    const topAt = (z) => this.camera.position.y + (z - this.camera.position.z) * topRay.y / topRay.z;
    const casterZ = light.z >= 0 ? depth : -depth;
    const projectionDepth = light.z >= 0 ? depth * 2 + recess : depth * 2;
    const reach = Math.min(this.keyLight.shadow.camera.far, projectionDepth / Math.max(Math.abs(light.z), 1e-6));
    const shadowTop = topAt(casterZ - reach * light.z) + reach * light.y;
    return Math.max(topAt(casterZ), shadowTop) - this.worldHeight + SHADOW_COVERAGE.projectionPadding;
  }

  retainPlatformShadow(platform, source, node) {
    if (!this.config.platformSupports.procedural || !this.keyLight.castShadow || !source.castShadow || !node.visible) return;
    const bottom = platform.y + platform.height;
    if (-bottom >= this.getTrailingShadowMargin()) return;

    source.updateWorldMatrix(true, false);
    // The route can reuse the platform while the light still sees its old shape.
    // The opaque shadow caster only needs positions and the triangle order.
    const shape = source.geometry;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', shape.getAttribute('position').clone());
    if (shape.index) geometry.setIndex(shape.index.clone());
    geometry.setDrawRange(shape.drawRange.start, shape.drawRange.count);
    geometry.boundingSphere = shape.boundingSphere?.clone() ?? null;
    const mesh = new THREE.Mesh(geometry, source.material);
    source.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.position.y = this.logicalY(platform.y + platform.height / 2) + source.position.y;
    mesh.layers.set(PLATFORM_SHADOW_LAYER);
    mesh.castShadow = true;
    this.world.add(mesh);
    this.trailingPlatformShadows.push({ mesh, bottom, y: mesh.position.y, atDepth: this.runDepth });
  }

  updateTrailingPlatformShadows(scrolled, clear = false) {
    if (this.trailingPlatformShadows.length === 0) return;
    const margin = clear || !this.config.platformSupports.procedural || !this.keyLight.castShadow
      ? -Infinity : this.getTrailingShadowMargin();
    for (let i = this.trailingPlatformShadows.length - 1; i >= 0; i -= 1) {
      const { mesh, bottom, y, atDepth } = this.trailingPlatformShadows[i];
      const offset = scrolled - atDepth;
      if (offset - bottom >= margin) {
        this.world.remove(mesh);
        mesh.geometry.dispose();
        this.trailingPlatformShadows.splice(i, 1);
      } else {
        mesh.position.y = y + offset;
      }
    }
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

  configureRouteGroup(group, y, type, previousPlatform, gap) {
    if (type === 'DOUBLE') this.configureDoubleGroup(group, y);
    else this.configureSingleGroup(group, y, type, previousPlatform, gap);
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
    const width = !this.maximumMode && this.activeRunTime < this.config.platforms.platformProgressionDuration
      ? this.randomProgressiveWidth()
      : this.randomWidth();
    const placement = this.singleGroupPlacement(type, width, previousPlatform, gap);
    this.configurePlatform(group[0], placement.x, y, placement.width, type);
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
      const reserve = this.platforms.filter((platform) => !platform.active);
      const partner = reserve.length ? null : this.groups.find((candidate) => (
        candidate !== group && candidate.length === 1 && this.isGroupOffscreen(candidate)
      ));
      const requestedType = this.choosePattern(group.length > 1 || reserve.length > 0 || Boolean(partner));

      if (group.length === 1 && requestedType === 'DOUBLE') {
        if (reserve.length) {
          const index = this.groups.indexOf(group);
          group = [group[0], reserve[0]];
          this.groups[index] = group;
        } else if (partner) {
          const firstIndex = this.groups.indexOf(group);
          const secondIndex = this.groups.indexOf(partner);
          const insertIndex = Math.min(firstIndex, secondIndex);
          const pair = [group[0], partner[0]];
          pair.isPortalPair = false;
          this.groups = this.groups.filter((candidate) => candidate !== group && candidate !== partner);
          this.groups.splice(insertIndex, 0, pair);
          group = pair;
          lowest = this.findLowestPlatform(new Set([group]));
        }
      }

      const gap = this.randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap);
      const previousPlatform = lowest || (this.hubLanding.active ? this.hubLanding : null);
      const y = this.nextRouteY(previousPlatform, gap);
      for (const platform of group) this.retainPlatformShadow(platform, platform.mesh, platform.node);

      if (group.length > 1 && requestedType !== 'DOUBLE') {
        const first = group[0];
        const second = group[1];
        const firstGroup = [first];
        const secondGroup = [second];
        const firstIndex = this.groups.indexOf(group);
        if (reserve.length < PLATFORM_RESERVE) {
          this.configureSingleGroup(firstGroup, y, requestedType, previousPlatform, gap);
          this.clearPlatformEntities(second);
          second.active = false;
          second.node.visible = false;
          this.groups[firstIndex] = firstGroup;
          first.recycledThisFrame = true;
          second.recycledThisFrame = true;
          this.registerPattern(requestedType);
          continue;
        }
        const firstGap = gap;
        const secondGap = this.randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap);
        this.configureSingleGroup(firstGroup, y, requestedType, previousPlatform, firstGap);
        const secondY = this.nextRouteY(first, secondGap);
        this.registerPattern(requestedType);
        const secondType = this.choosePattern(false);
        this.configureSingleGroup(secondGroup, secondY, secondType, first, secondGap);
        this.groups.splice(firstIndex, 1, firstGroup, secondGroup);
        first.recycledThisFrame = true;
        second.recycledThisFrame = true;
        this.registerPattern(secondType);
        continue;
      }

      this.configureRouteGroup(group, y, requestedType, previousPlatform, gap);
      group.isPortalPair = false;
      group.forEach((platform) => { platform.recycledThisFrame = true; });
      this.registerPattern(group.length > 1 ? 'DOUBLE' : requestedType);
    }
  }

  nextRouteY(previousPlatform = null, gap = this.randomBetween(this.config.platforms.minGap, this.config.platforms.maxGap)) {
    return (previousPlatform ? previousPlatform.y : this.worldHeight) + this.config.platforms.height + gap;
  }

  updateEntities(dt) {
    const entityUpdateState = { collectedCrystalThisFrame: false };
    for (const entity of this.entities) {
      if (entity.kind === 'enemy') updateEnemyEntity(this, entity, dt);
      else updateCollectibleEntity(this, entity, dt, entityUpdateState);
      this.applyEntityView(entity);
    }
    this.updateCounter();
  }

  updateCrystalAnimation(entity, dt) {
    if (!entity.active || (entity.kind !== 'crystal' && entity.kind !== 'burst')) return;
    const crystals = this.config.crystals;
    const rotationSpeed = Number.isFinite(entity.rotationSpeed)
      ? entity.rotationSpeed
      : Number(crystals.rotationSpeed) || 1.8;
    entity.rotation = (entity.rotation || 0) + rotationSpeed * dt;
    if (entity.kind !== 'crystal' || entity.collecting || !entity.platform) {
      entity.renderOffsetY = 0;
      return;
    }
    const bobSpeed = Math.max(0, Number(crystals.idleBobSpeed) || 0);
    const bobHeight = Math.max(0, Number(crystals.idleBobHeight) || 0);
    entity.bobPhase = (entity.bobPhase || 0) + bobSpeed * dt;
    // The lowest visual point stays at the configured platform offset.
    entity.renderOffsetY = bobHeight * (0.5 + 0.5 * Math.sin(entity.bobPhase));
  }

  spawnEnemy(platform) {
    const entity = this.entities.find((candidate) => candidate.kind === 'enemy' && !candidate.active && !candidate.platform);
    if (!entity) return;
    const view = entity.view;
    const { fleeing, spiked } = this.config.enemies;
    const roll = this.enemyRng.next();
    const safeLandingWidth = entity.width + 2 * (this.player.width + 2);
    const spikedChance = this.runDepth >= spiked.minDepth && platform.width >= safeLandingWidth
      ? spiked.chance : 0;
    const fleeingChance = this.runDepth >= fleeing.minDepth ? fleeing.chance : 0;
    entity.enemyType = roll < spikedChance ? 'spiked' : roll < spikedChance + fleeingChance ? 'fleeing' : 'static';
    entity.fleeing = false;
    entity.stompUsed = false;
    view.children[0].visible = entity.enemyType === 'spiked';
    view.material.map = this.enemyTextures[entity.enemyType];
    view.material.emissive.setHex(0);
    view.castShadow = true;
    entity.platform = platform;
    entity.x = platform.x + platform.width / 2 - 4;
    entity.y = platform.y;
    entity.defeated = false;
    entity.active = true;
    entity.health = 3;
    entity.hitFlightTimer = 0;
    entity.dying = false;
    entity.deathVelocityX = 0;
    entity.deathVelocityY = 0;
    entity.deathVelocityZ = 0;
    entity.deathDepthRemaining = 0;
    entity.deathRotation = 0;
    entity.rotation = 0;
    view.rotation.z = 0;
    entity.renderOffsetX = 0;
    entity.renderOffsetY = 0;
    entity.renderOffsetZ = 0;
    entity.renderPreviousOffsetZ = 0;
    this.captureEntityRenderState(entity);
    platform.enemy = entity;
    this.applyEntityView(entity);
  }

  hitEnemy(enemy, stomp = false) {
    if (this.gameOver || !enemy || !enemy.active || enemy.defeated) return;
    if (stomp && enemy.enemyType === 'spiked') {
      this.setGameOver();
      return;
    }
    if (this.attackCooldown > 0) return;
    const direction = Math.sign(this.player.vx) || (this.player.x < enemy.x ? 1 : -1);
    if (stomp) {
      const damage = this.cardBonus('stomp');
      if (!damage || enemy.stompUsed) return;
      enemy.stompUsed = true;
      this.player.groundedOn = null;
      this.player.vy = -Math.sqrt(this.config.player.gravity * 16);
      enemy.health -= damage;
    } else {
      enemy.health -= Math.max(1, this.damage + this.cardBonus('damage'));
    }
    const attacksPerSecond = Math.max(0.5, this.config.player.attacksPerSecond) + this.cardBonus('attackSpeed');
    this.attackCooldown = 1 / attacksPerSecond;
    if (enemy.enemyType === 'fleeing' && enemy.health > 0) enemy.fleeing = true;
    enemy.hitFlightTimer = ENEMY_HIT_FLIGHT_SECONDS;
    enemy.view?.material?.emissive?.setHex(0xffd66b);
    enemy.hitFlightOffsetX = enemy.fleeing ? 0 : direction * 2;
    if (enemy.health <= 0) {
      enemy.defeated = true;
      const deathPlatform = enemy.platform;
      if (deathPlatform?.spawnContent) deathPlatform.spawnContent.enemy = false;
      if (deathPlatform?.enemy === enemy) deathPlatform.enemy = null;
      enemy.dying = true;
      enemy.deathVelocityX = direction > 0 ? 30 : -30;
      enemy.deathVelocityY = -156;
      enemy.deathVelocityZ = (Number(this.config.platforms.depth) || 9) / 0.18;
      enemy.deathDepthRemaining = Number(this.config.platforms.depth) || 9;
      enemy.deathRotation = direction > 0 ? 18 : -18;
      enemy.platform = null;
      const reward = (this.config.enemies[enemy.enemyType]?.reward ?? 3) + this.cardBonus('bounty');
      this.spawnBurst(enemy.x + enemy.width / 2, enemy.y, reward, deathPlatform);
    }
  }
  spawnCrystals(platform) {
    const { doubleCluster, tripleCluster } = this.config.crystals;
    const chance = ({ startDepth, fullChanceDepth, maxChance }) =>
      clamp((this.runDepth - startDepth) / (fullChanceDepth - startDepth), 0, 1) * maxChance;
    const roll = this.crystalRng.next();
    const tripleChance = chance(tripleCluster);
    const desired = roll < tripleChance ? 3 : roll < tripleChance + chance(doubleCluster) ? 2 : 1;
    const capacity = Math.max(0, 1 + Math.floor((platform.width - CRYSTAL_WIDTH) / CRYSTAL_SPACING));
    const count = Math.min(desired, capacity);
    if (count === 0) return;
    const crystalDiameter = Math.min(CRYSTAL_RADIUS * 2, platform.width);
    const spacing = count > 1 ? clamp((platform.width - crystalDiameter) / (count - 1), CRYSTAL_SPACING, CRYSTAL_SPACING * CRYSTAL_SCALE) : 0;
    const clusterWidth = Math.min(platform.width, crystalDiameter + (count - 1) * spacing);
    const freeWidth = platform.width - clusterWidth;
    const platformCenter = platform.x + platform.width / 2;
    const startX = platform.x + freeWidth * (platformCenter < this.config.world.width / 2 ? 0.75 : 0.25) + (crystalDiameter - CRYSTAL_WIDTH) / 2;
    const available = this.entities.filter((candidate) => candidate.kind === 'crystal' && !candidate.active && !candidate.platform).slice(0, count);
    if (available.length < count) return;
    for (let side = 0; side < count; side += 1) {
      const entity = available[side];
      const view = entity.view;
      const platformOffset = Number(this.config.crystals.platformOffset);
      entity.platform = platform;
      entity.x = startX + side * spacing;
      entity.platformOffset = Number.isFinite(platformOffset) ? Math.max(0, platformOffset) : 1;
      entity.y = platform.y - entity.platformOffset;
      entity.floorY = entity.y;
      entity.phase = 'idle';
      entity.collecting = false;
      entity.bobPhase = side * Math.PI;
      entity.rotation = 0;
      entity.rotationSpeed = (side === 0 ? 1 : -1) * (Number(this.config.crystals.rotationSpeed) || 1.8);
      entity.renderOffsetY = 0;
      view.rotation.y = 0;
      entity.active = true;
      this.captureEntityRenderState(entity);
      this.applyEntityView(entity);
      platform.crystals.push(entity);
    }
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
    platform.chest = entity;
    this.applyEntityView(entity);
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
    if (this.mode !== GAME_STATES.RUN || !this.portals) return;
    const entered = this.portals.some((portal) => overlap(this.player, { x: portal.platform.x + (portal.side ? portal.platform.width - 4 : 0), y: portal.platform.y - 10, width: 4, height: 10 }));
    if (entered) {
      this.setMode(GAME_STATES.TRANSITION);
      this.input.held = false;
      this.transitionRemaining = PORTAL_CLOSE_TIME;
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
      const nextSpeed = Math.min(upgrades.speedMaximum, this.getPlayerHorizontalSpeed() + upgrades.speedIncrement);
      this.speedUpgrade += nextSpeed - current;
    } else {
      this.damage = Math.min(upgrades.damageMaximum, this.damage + upgrades.damageIncrement);
    }
    this.updateCounter();
    return true;
  }

  setGameOver() { this.gameOver = true; this.setMode(GAME_STATES.GAME_OVER); this.gameOverPanel.hidden = false; this.input.held = false; }
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
    if (entity.platform && entity.kind !== 'burst' && !entity.collecting) {
      const platformOffset = entity.kind === 'crystal' ? (entity.platformOffset ?? 0) : 0;
      entity.y = entity.platform.y - platformOffset;
    }
    if (Number.isFinite(entity.rotation)) {
      if (entity.kind === 'crystal' || entity.kind === 'burst') entity.view.rotation.y = entity.rotation;
      else entity.view.rotation.z = entity.rotation;
    }
    const offsetX = entity.renderOffsetX || 0;
    const offsetY = entity.renderOffsetY || 0;
    const offsetZ = entity.renderOffsetZ || 0;
    this.positionEntityView(entity, entity.x, entity.y, offsetX, offsetY, offsetZ);
    const platformVisible = !entity.platform || entity.platform.node.visible;
    entity.view.visible = entity.active !== false && (!entity.defeated || entity.dying) && platformVisible;
  }

  entityRenderLayer(entity) {
    if (entity.kind === 'crystal') return this.config.platforms.depth / 2 - CRYSTAL_RADIUS;
    if (entity.kind === 'burst') return entity.phase === 'counter' ? 4 : 2;
    return 1;
  }

  positionEntityView(entity, x, y, offsetX, offsetY, offsetZ) {
    const lift = entity.kind === 'crystal' || entity.kind === 'burst' ? CRYSTAL_RADIUS - BASE_CRYSTAL_RADIUS : 0;
    entity.view.position.set(
      x + (entity.width || 0) / 2 + offsetX,
      this.logicalY(y - (entity.height || 0) / 2 - offsetY - lift),
      this.entityRenderLayer(entity) + offsetZ,
    );
  }

  applyInterpolatedEntityView(entity, alpha) {
    if (!entity.view) return;
    const x = lerp(entity.renderPreviousX ?? entity.x, entity.x, alpha);
    const y = lerp(entity.renderPreviousY ?? entity.y, entity.y, alpha);
    const offsetX = lerp(entity.renderPreviousOffsetX ?? 0, entity.renderOffsetX || 0, alpha);
    const offsetY = lerp(entity.renderPreviousOffsetY ?? 0, entity.renderOffsetY || 0, alpha);
    const offsetZ = lerp(entity.renderPreviousOffsetZ ?? 0, entity.renderOffsetZ || 0, alpha);
    const currentRotation = Number.isFinite(entity.rotation) ? entity.rotation : entity.view.rotation.z;
    const rotation = lerp(entity.renderPreviousRotation ?? currentRotation, currentRotation, alpha);
    this.positionEntityView(entity, x, y, offsetX, offsetY, offsetZ);
    if (entity.kind === 'crystal' || entity.kind === 'burst') entity.view.rotation.y = rotation;
    else entity.view.rotation.z = rotation;
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
  return loadConfig(CONFIG);
}
