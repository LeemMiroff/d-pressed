import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { GameSession } from '../src/game-session.js';
import { ThreeGame } from '../src/three-engine.js';

function makeGame() {
  const game = Object.create(ThreeGame.prototype);
  const session = new GameSession();
  const start = { x: 0, y: 230, width: 60, active: true, node: { visible: true } };
  return Object.assign(game, {
    config: structuredClone(CONFIG),
    session,
    mode: session.state,
    worldHeight: 240,
    player: { x: 90, y: 0, width: 8, height: 10, vy: 0 },
    input: {},
    stations: [],
    platforms: [start, start],
    hub: { x: 0, width: 96, height: 6 },
    hubGroup: { visible: false },
    hubLanding: { x: 80, width: 40, height: 6, active: false },
    hubLandingGroup: { visible: false },
    proceduralCliffs: { group: {}, reset() {} },
    playerFacing: { reset() {} },
    gameOverPanel: {},
    closeCardChoice() {},
    updateTrailingPlatformShadows() {},
    resetBackgroundWall() {},
    clearEntities() {},
    generateInitial() {},
    updateCounter() {},
    resetRenderInterpolation() {},
    applyAllViews() {},
  });
}

test('inspector restart removes the hub landing and its collision', () => {
  const game = makeGame();
  game.rebuildRoute();
  game.enterHub();
  game.exitHub();
  game.restart(true, false);

  game.player.groundedOn = null;
  game.player.x = 90;
  game.player.y = game.hubLanding.y - game.player.height - 1;
  game.player.vy = 120;
  game.updateVertical(1 / 60);

  assert.equal(game.player.groundedOn, null);
  assert.equal(game.hubLandingGroup.visible, false);
});

test('entering and leaving the hub keeps the right landing visible and solid', () => {
  const game = makeGame();
  game.rebuildRoute();
  game.enterHub();
  game.exitHub();

  game.player.x = 90;
  game.player.y = game.hubLanding.y - game.player.height - 1;
  game.player.vy = 120;
  game.updateVertical(1 / 60);

  assert.equal(game.player.groundedOn, game.hubLanding);
  assert.equal(game.hubLandingGroup.visible, true);
});
