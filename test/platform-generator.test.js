import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { PlatformGenerator } from '../src/platform-generator.js';

test('a chest takes the center slot when both a chest and an enemy are rolled', () => {
  for (const type of ['SINGLE', 'WALL']) {
    assert.deepEqual(makeGenerator([0]).spawnContent(type), {
      enemy: false, crystals: true, chest: true,
    });
  }
});

test('opening picks respect the repeat limit when a pair cannot be built', () => {
  const generator = makeGenerator([0.99]);
  for (const patternCount of [3, 4, 5]) {
    assert.equal(generator.choosePattern({
      patternCount,
      patternHistory: ['SINGLE', 'SINGLE'],
      lastPatternType: 'SINGLE',
      patternRepeatCount: 2,
      doublePlatformsDisabled: true,
    }), 'WALL');
  }
});

test('single platforms leave room for the player at both walls', () => {
  for (const roll of [0, 0.99]) {
    const generator = makeGenerator([roll]);
    for (const requestedWidth of [40, 102]) {
      const { x, width } = generator.singlePlacement({ x: 0, width: 96 }, requestedWidth, 42);
      assert.ok(x > generator.player.width);
      assert.ok(CONFIG.world.width - x - width > generator.player.width);
    }
  }
});

test('wide singles switch walls when snapping would repeat the previous side', () => {
  const width = 96;
  const right = CONFIG.world.width - width;
  assert.equal(makeGenerator([0]).reachableX({ x: 0, width }, width, 30), right);
  assert.equal(makeGenerator([0.99]).reachableX({ x: right, width }, width, 30), 0);
});

test('wall switching keeps a same-side landing when the opposite wall is out of reach', () => {
  assert.equal(makeGenerator([0]).reachableX({ x: 0, width: 20 }, 20, 30), 0);
});

function makeGenerator(randomValues = []) {
  const config = structuredClone(CONFIG);
  const player = { width: config.player.width };
  let index = 0;
  const random = () => randomValues[index++ % Math.max(1, randomValues.length)] ?? 0.5;
  return new PlatformGenerator({
    config,
    player,
    random,
    randomBetween: (min, max) => min + random() * (max - min),
  });
}

test('opening pattern order follows configuration', () => {
  const generator = makeGenerator([0.5]);
  const state = {
    patternCount: 0,
    patternHistory: [],
    lastPatternType: null,
    patternRepeatCount: 0,
    doublePlatformsDisabled: false,
  };
  assert.equal(generator.choosePattern(state), CONFIG.platforms.openingPatterns[0]);
  state.patternCount = 1;
  assert.equal(generator.choosePattern(state), CONFIG.platforms.openingPatterns[1]);
});

test('generated widths stay within the configured progression bounds', () => {
  const generator = makeGenerator([0.1, 0.9, 0.4]);
  const width = generator.randomWidth(0, 0);
  const progressiveWidth = generator.randomProgressiveWidth(0, 0);
  assert.ok(width >= CONFIG.platforms.minWidth);
  assert.ok(width <= CONFIG.platforms.maxWidth);
  assert.ok(progressiveWidth >= CONFIG.platforms.earlySingleMinWidth);
  assert.ok(progressiveWidth <= CONFIG.platforms.earlySingleMaxWidth);
});

test('reachable platform positions remain inside the world', () => {
  const generator = makeGenerator([0.99]);
  const previous = { x: 0, width: 40 };
  const width = 35;
  const x = generator.reachableX(previous, width, 36);
  assert.ok(x >= 0);
  assert.ok(x + width <= CONFIG.world.width);
});

test('double content keeps the guaranteed enemy on one side', () => {
  const generator = makeGenerator([0.1, 0.9, 0.1]);
  const group = [{}, {}];
  generator.configureGroupContent(group, 'DOUBLE');
  assert.equal(group.filter((platform) => platform.spawnContent.enemy).length, 1);
});
