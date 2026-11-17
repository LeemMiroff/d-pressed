import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { PlatformGenerator } from '../src/platform-generator.js';

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
