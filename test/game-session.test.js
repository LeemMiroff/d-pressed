import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_STATES, GameSession } from '../src/game-session.js';

test('game session accepts the runtime states', () => {
  const session = new GameSession();
  session.transition(GAME_STATES.HUB);
  assert.equal(session.is(GAME_STATES.HUB), true);
  session.transition(GAME_STATES.RUN);
  assert.equal(session.state, GAME_STATES.RUN);
});

test('game session rejects unknown states', () => {
  const session = new GameSession();
  assert.throws(() => session.transition('broken'), /Unknown game state/);
});
