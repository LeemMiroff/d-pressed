import { Application, Assets, Container, Sprite } from 'pixi.js';
import { CONFIG } from './config.js';
import { Game } from './game.js';
import { PointerInput } from './input.js';
import { Inspector, loadSavedConfig } from './inspector.js';
import './style.css';

async function start() {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: CONFIG.render.outerBackgroundColor,
    antialias: false,
    autoDensity: true,
    resolution: Math.max(1, window.devicePixelRatio || 1),
  });

  const mount = document.querySelector('#app');
  mount.appendChild(app.canvas);
  app.canvas.setAttribute('aria-label', 'Игровое поле');

  const viewport = new Container({ label: 'game-viewport' });
  const worldRoot = new Container({ label: 'game-world' });
  worldRoot.sortableChildren = true;
  const uiRoot = new Container({ label: 'interface-layer' });
  const viewportBackground = new Sprite();
  worldRoot.scale.set(1);
  viewport.addChild(viewportBackground, worldRoot);
  app.stage.addChild(viewport, uiRoot);

  await loadSavedConfig(CONFIG);
  const [playerTexture, platformTexture, backgroundTexture, crystalTexture, chestTexture, enemyTexture] = await Promise.all([
    Assets.load('/ASEPRITE/gg.png'),
    Assets.load('/ASEPRITE/platforem.png'),
    Assets.load('/game-background.png'),
    Assets.load('/ASEPRITE/coin/1.png'),
    Assets.load('/ASEPRITE/sunduk/sunduk.png'),
    Assets.load('/ASEPRITE/vrag/vrag.png'),
  ]);
  playerTexture.source.scaleMode = 'nearest';
  platformTexture.source.scaleMode = 'nearest';
  backgroundTexture.source.scaleMode = 'nearest';
  crystalTexture.source.scaleMode = 'nearest';
  chestTexture.source.scaleMode = 'nearest';
  enemyTexture.source.scaleMode = 'nearest';
  viewportBackground.texture = backgroundTexture;
  viewportBackground.width = CONFIG.world.width;
  viewportBackground.height = CONFIG.world.height;
  const input = new PointerInput(app.canvas);
  const game = new Game(worldRoot, uiRoot, input, CONFIG, { playerTexture, platformTexture, crystalTexture, chestTexture, enemyTexture });
  const inspector = new Inspector(CONFIG, game);

  const resizeViewport = () => {
    const scale = Math.max(
      1,
      Math.floor(Math.min(
        app.screen.width / CONFIG.world.width,
        app.screen.height / CONFIG.render.baseHeight * 4,
      )),
    );
    const worldHeight = app.screen.height / scale;
    CONFIG.world.height = worldHeight;
    CONFIG.platforms.startY = worldHeight - 24;
    viewportBackground.width = CONFIG.world.width;
    viewportBackground.height = worldHeight;
    const viewportWidth = CONFIG.world.width * scale;
    const viewportHeight = worldHeight * scale;

    viewport.scale.set(scale);
    viewport.position.set(
      Math.round((app.screen.width - viewportWidth) / 2),
      Math.round((app.screen.height - viewportHeight) / 2),
    );
    uiRoot.scale.set(scale);
    uiRoot.position.copyFrom(viewport.position);
    game?.portalManager?.resizeWorld(worldHeight);
    game?.resizeWorld(worldHeight);
  };

  resizeViewport();
  window.addEventListener('resize', resizeViewport);
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyR' && !event.repeat) {
      event.preventDefault();
      game.restart();
    }
  });
  app.ticker.add((ticker) => game.update(ticker.deltaMS / 1000));
  app.ticker.add(() => inspector.update());
}

start();
