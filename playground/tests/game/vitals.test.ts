import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  airBubbles, canEat, createHunger, eat, EAT_TICKS, exhaust, fallDamage, FOOD_TICKS, foodOf, headInWater, MAX_AIR, MAX_FOOD, START_SATURATION, stepAir, stepHunger,
} from '../../src/game/vitals.js';

describe('falls', () => {
  test('a point for each block past the third, rounded up', () => {
    assert.equal(fallDamage(0), 0);
    assert.equal(fallDamage(3), 0);
    assert.equal(fallDamage(3.2), 1);
    assert.equal(fallDamage(10), 7);
    assert.equal(fallDamage(Number.NaN), 0);
  });
});

describe('air', () => {
  test('lasts 300 ticks under water, then drowns every 20 ticks, and comes back at once in the air', () => {
    let air = MAX_AIR;
    const drowned: number[] = [];
    for (let tick = 1; tick <= MAX_AIR + 60; tick++) {
      const step = stepAir(air, true);
      air = step.air;
      if (step.drown) drowned.push(tick);
    }
    assert.deepEqual(drowned, [MAX_AIR + 20, MAX_AIR + 40, MAX_AIR + 60]);
    assert.deepEqual(stepAir(air, false), { air: MAX_AIR, drown: false });
  });

  test('the HUD shows ten bubbles, popping one at a time', () => {
    assert.deepEqual(airBubbles(MAX_AIR), { full: 10, popping: 0 });
    assert.deepEqual(airBubbles(MAX_AIR - 1), { full: 10, popping: 0 });
    assert.deepEqual(airBubbles(271), { full: 9, popping: 1 });
    assert.deepEqual(airBubbles(0), { full: 0, popping: 0 });
  });

  test('a head is under water inside a water cell, below the top ninth of a surface block', () => {
    const water = (x: number, y: number, z: number) => x === 0 && z === 0 && y <= 5;
    assert.equal(headInWater(water, 0.5, 4.95, 0.5), true);
    assert.equal(headInWater(water, 0.5, 5.5, 0.5), true);
    assert.equal(headInWater(water, 0.5, 5.95, 0.5), false);
    assert.equal(headInWater(water, 1.5, 4.5, 0.5), false);
  });
});

describe('hunger', () => {
  test('starts full, with 5 saturation', () => {
    assert.deepEqual(createHunger(), { food: MAX_FOOD, saturation: START_SATURATION, exhaustion: 0, timer: 0 });
  });

  test('every 4 exhaustion takes a point of saturation first, then of food', () => {
    const hunger = createHunger();
    for (let i = 0; i < START_SATURATION + 2; i++) {
      exhaust(hunger, 4.1);
      stepHunger(hunger, 20, 20);
    }
    assert.equal(hunger.saturation, 0);
    assert.equal(hunger.food, MAX_FOOD - 2);
  });

  test('exhaustion stops at 40', () => {
    const hunger = createHunger();
    exhaust(hunger, 100);
    assert.equal(hunger.exhaustion, 40);
  });

  test('heals a point every 80 ticks at 18 food or more, which costs 3 exhaustion', () => {
    const hunger = { ...createHunger(), food: 18 };
    const steps = Array.from({ length: FOOD_TICKS }, () => stepHunger(hunger, 10, 20));
    assert.deepEqual(steps.filter(Boolean), ['heal']);
    assert.equal(steps.at(-1), 'heal');
    assert.equal(hunger.exhaustion, 3);
    // full health heals nothing
    assert.deepEqual(Array.from({ length: FOOD_TICKS }, () => stepHunger(hunger, 20, 20)).filter(Boolean), []);
  });

  test('below 18 food nothing heals; at 0 a point is lost every 80 ticks', () => {
    const peckish = { ...createHunger(), food: 17 };
    assert.deepEqual(Array.from({ length: FOOD_TICKS * 2 }, () => stepHunger(peckish, 10, 20)).filter(Boolean), []);
    const starving = { ...createHunger(), food: 0, saturation: 0 };
    assert.deepEqual(Array.from({ length: FOOD_TICKS * 2 }, () => stepHunger(starving, 1, 20)).filter(Boolean), ['starve', 'starve']);
  });
});

describe('food', () => {
  test('apples and meat, cooked meat feeding more', () => {
    assert.deepEqual(foodOf('apple'), { food: 4, saturation: 2.4 });
    assert.deepEqual(foodOf('cooked_beef'), { food: 8, saturation: 12.8 });
    assert.ok(foodOf('beef')!.food < foodOf('cooked_beef')!.food);
    assert.equal(foodOf('stick'), null);
    assert.equal(foodOf(null), null);
  });

  test('eats only food, and only when not full', () => {
    assert.equal(canEat(19, 'apple'), true);
    assert.equal(canEat(MAX_FOOD, 'apple'), false);
    assert.equal(canEat(10, 'dirt'), false);
    assert.equal(EAT_TICKS, 32);
  });

  test('eating adds food up to 20 and saturation up to the food level', () => {
    const hunger = { ...createHunger(), food: 10, saturation: 0 };
    assert.equal(eat(hunger, 'apple'), true);
    assert.deepEqual([hunger.food, hunger.saturation], [14, 2.4]);
    eat(hunger, 'cooked_beef');
    assert.equal(hunger.food, MAX_FOOD);
    assert.ok(Math.abs(hunger.saturation - 15.2) < 1e-9);
    assert.equal(eat(hunger, 'stick'), false);
    const nearlyFull = { ...createHunger(), food: 19, saturation: 0 };
    eat(nearlyFull, 'cooked_beef');
    assert.deepEqual([nearlyFull.food, nearlyFull.saturation], [MAX_FOOD, 12.8]);
  });
});
