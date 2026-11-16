import './style.css';
import { ThreeGame, loadThreeConfig } from './three-engine.js';
import { ThreeInspector } from './three-inspector.js';

async function start() {
  const mount = document.querySelector('#app');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Игровое поле');
  mount.append(canvas);
  const config = await loadThreeConfig();
  const game = new ThreeGame(canvas, config);
  const inspector = new ThreeInspector(config, game);
  let pointerId = null;
  const setHeld = (held) => { game.input.held = held; };
  canvas.addEventListener('pointerdown', (event) => { pointerId = event.pointerId; canvas.setPointerCapture?.(pointerId); setHeld(true); if (game.gameOver) game.restart(); }, { passive: false });
  canvas.addEventListener('pointerup', (event) => { if (event.pointerId === pointerId) { pointerId = null; setHeld(false); } }, { passive: false });
  canvas.addEventListener('pointercancel', () => { pointerId = null; setHeld(false); }, { passive: false });
  window.addEventListener('keydown', (event) => { if (event.code === 'KeyD' || ['d', 'д'].includes(event.key?.toLowerCase())) { event.preventDefault(); setHeld(true); } if (event.code === 'KeyR' && !event.repeat) { event.preventDefault(); game.restart(); } });
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
