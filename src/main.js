import './style.css';
import wall from '../public/assets/wall-brick.png?url&inline';
import model from '../public/assets/mini-chibi-kid/source/mini chibi kid.fbx?url&inline';
import character from '../public/assets/mini-chibi-kid/textures/base_texture_01.png?url&inline';
import stonePlatform from '../public/models/stone-study/stone-platform.glb?url&inline';
import cliffMass from '../public/models/stone-study/cliff-mass.glb?url&inline';
import lowSpur from '../public/models/stone-study/support-low-spur.glb?url&inline';
import splitPillar from '../public/models/stone-study/support-split-pillar.glb?url&inline';
import brokenTerrace from '../public/models/stone-study/support-broken-terrace.glb?url&inline';
import foliageAtlas from '../public/assets/platform-foliage/foliage-atlas.png?url&inline';
import grassNoise from '../public/assets/platform-foliage/grass-noise.png?url&inline';
import { ThreeGame, loadThreeConfig } from './three-engine.js';
import { ThreeInspector } from './three-inspector.js';
import { loadStonePlatform } from './stone-platform.js';
import { loadStoneGeometry } from './stone-geometry.js';
import { loadPlatformSupports } from './platform-supports.js';
import { loadPlatformFoliage } from './platform-foliage.js';

async function start() {
  const mount = document.querySelector('#app');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Игровое поле');
  mount.append(canvas);
  const [config, platform, cliff, supports, foliage] = await Promise.all([
    loadThreeConfig(),
    loadStonePlatform(stonePlatform).catch((error) => {
      console.warn('D-PRESSED stone platform failed to load, using fallback boxes', error);
      return null;
    }),
    loadStoneGeometry(cliffMass).catch((error) => {
      console.warn('D-PRESSED cliff background failed to load, using brick wall', error);
      return null;
    }),
    loadPlatformSupports([lowSpur, splitPillar, brokenTerrace]).catch((error) => {
      console.warn('D-PRESSED platform supports failed to load', error);
      return null;
    }),
    loadPlatformFoliage(foliageAtlas, grassNoise).catch((error) => {
      console.warn('D-PRESSED platform foliage failed to load', error);
      return null;
    }),
  ]);
  const game = new ThreeGame(canvas, config, { wall, model, character, platform, cliff, supports, foliage });
  const inspector = new ThreeInspector(config, game);
  let pointerId = null;
  const setHeld = (held) => { game.input.held = held; };
  canvas.addEventListener('pointerdown', (event) => { pointerId = event.pointerId; canvas.setPointerCapture?.(pointerId); setHeld(true); if (game.gameOver) game.restart(); }, { passive: false });
  canvas.addEventListener('pointerup', (event) => { if (event.pointerId === pointerId) { pointerId = null; setHeld(false); } }, { passive: false });
  canvas.addEventListener('pointercancel', () => { pointerId = null; setHeld(false); }, { passive: false });
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyD' || ['d', 'д'].includes(event.key?.toLowerCase())) {
      event.preventDefault();
      setHeld(true);
    }
    if (!event.repeat && (event.code === 'KeyP' || event.code === 'KeyR')) {
      event.preventDefault();
      game.restartWithMaximumMode(event.code === 'KeyP');
    }
  });
  window.addEventListener('keyup', (event) => { if (event.code === 'KeyD' || ['d', 'д'].includes(event.key?.toLowerCase())) { event.preventDefault(); setHeld(false); } });
  window.addEventListener('blur', () => { setHeld(false); game.pause(); });
  window.addEventListener('focus', () => { game.resume(); last = performance.now(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      setHeld(false);
      game.pause();
    } else {
      game.resume();
      last = performance.now();
    }
  });
  window.addEventListener('resize', () => game.resize());
  let last = performance.now();
  const frame = (time) => { const delta = Math.min(Math.max((time - last) / 1000, 0), 0.1); last = time; game.update(delta); inspector.update(); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}

start().catch((error) => {
  console.error('D-Pressed startup failed', error);
  const message = document.createElement('pre');
  message.textContent = `D-PRESSED STARTUP ERROR\n${error?.stack || error}`;
  message.style.cssText = 'position:fixed;inset:16px;z-index:20;color:#ffb4a8;background:#17171d;font:12px monospace;white-space:pre-wrap;';
  document.body.append(message);
});
