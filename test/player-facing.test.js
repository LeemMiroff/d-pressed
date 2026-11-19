import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerFacing } from '../src/player-facing.js';

test('combat facing acquires within 20 and releases beyond 28 on the same platform', () => {
  const facing = new PlayerFacing();
  const platform = {};
  const enemy = { active: true, platform, x: 21, width: 8 };
  platform.enemy = enemy;
  const player = { groundedOn: platform, x: 0, width: 8, vx: -50 };
  facing.updateForPlayer(0.16, player);
  assert.equal(facing.enemyTarget, null);
  enemy.x = 20;
  assert.equal(facing.updateForPlayer(0.16, player), -1);
  assert.equal(facing.yaw, Math.PI / 2);
  enemy.x = 28;
  facing.updateForPlayer(0.1, player);
  assert.equal(facing.enemyTarget, enemy);
  enemy.x = 29;
  facing.updateForPlayer(0.1, player);
  assert.equal(facing.enemyTarget, null);
});

test('passing a target reverses the look after leaving the center dead zone', () => {
  const facing = new PlayerFacing();
  const platform = {};
  platform.enemy = { active: true, platform, x: 10, width: 8 };
  const player = { groundedOn: platform, x: 0, width: 8, vx: 50 };
  facing.updateForPlayer(0.16, player);
  player.x = 10.5;
  assert.equal(facing.updateForPlayer(0.16, player), 1);
  player.x = 12;
  assert.equal(facing.updateForPlayer(0.16, player), -1);
  assert.equal(facing.yaw, -Math.PI / 2);
});

test('a normal press and release start a smooth turn without waiting', () => {
  const facing = new PlayerFacing();
  assert.equal(facing.updateForPlayer(0.04, { vx: 50 }, true), -1);
  assert.ok(facing.yaw > -Math.PI / 2 && facing.yaw < 0);
  facing.updateForPlayer(0.3, { vx: 50 }, true);
  assert.equal(facing.yaw, Math.PI / 2);
  assert.equal(facing.updateForPlayer(0.04, { vx: -50 }, false), -1);
  assert.ok(facing.yaw > 0 && facing.yaw < Math.PI / 2);
  assert.equal(facing.updateForPlayer(0.12, { vx: -50 }, false), 1);
  assert.equal(facing.yaw, -Math.PI / 2);
});

test('the turn responds to input before horizontal velocity changes sign', () => {
  const facing = new PlayerFacing();
  const player = { vx: -50 };
  assert.equal(facing.updateForPlayer(0.04, player, true), 1);
  assert.ok(facing.yaw > -Math.PI / 2);
  facing.updateForPlayer(0.12, player, true);
  player.vx = 50;
  assert.equal(facing.updateForPlayer(0.04, player, false), 1);
  assert.ok(facing.yaw < Math.PI / 2);
});

test('changing input during a turn finishes the turn and holds its direction until input settles', () => {
  const facing = new PlayerFacing();
  facing.updateForPlayer(0.04, { vx: 50 }, true);
  assert.equal(facing.updateForPlayer(0.12, { vx: -50 }, false), -1);
  assert.equal(facing.yaw, Math.PI / 2);
  assert.equal(facing.updateForPlayer(0.1, { vx: 50 }, true), 1);
  assert.equal(facing.updateForPlayer(0.1, { vx: -50 }, false), -1);
  assert.equal(facing.updateForPlayer(0.49, { vx: -50 }, false), -1);
  assert.equal(facing.yaw, Math.PI / 2);
  assert.equal(facing.updateForPlayer(0.01, { vx: -50 }, false), -1);
  assert.ok(facing.yaw < Math.PI / 2);
  assert.equal(facing.updateForPlayer(0.16, { vx: -50 }, false), 1);
  assert.equal(facing.yaw, -Math.PI / 2);
});

test('an input change after a completed turn starts a new turn without a delay', () => {
  const facing = new PlayerFacing();
  facing.updateForPlayer(0.16, { vx: 50 }, true);
  facing.updateForPlayer(0.01, { vx: -50 }, false);
  assert.ok(facing.yaw < Math.PI / 2);
  assert.equal(facing.holdFacing, false);
});

test('pressing during a left turn finishes it before the model can face right again', () => {
  const facing = new PlayerFacing();
  facing.updateForPlayer(0.16, { vx: 50 }, true);
  facing.updateForPlayer(0.04, { vx: -50 }, false);
  assert.equal(facing.updateForPlayer(0.12, { vx: 50 }, true), -1);
  assert.equal(facing.yaw, -Math.PI / 2);
  assert.equal(facing.updateForPlayer(0.49, { vx: 50 }, true), -1);
  assert.equal(facing.yaw, -Math.PI / 2);
  facing.updateForPlayer(0.01, { vx: 50 }, true);
  assert.ok(facing.yaw > -Math.PI / 2);
});
