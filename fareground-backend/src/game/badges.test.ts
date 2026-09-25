import test from 'node:test';
import assert from 'node:assert/strict';
import { BADGES, JERSEY_COLORS, badgeStates, levelFor, type PlayerStats } from './badges';

const none: PlayerStats = {
  lifetimeSteps: 0, parcels: 0, amethysts: 0, sapphires: 0, rubies: 0, mineralKinds: 0,
  bestChestStreak: 0, bestCheckinStreak: 0, placesVisited: 0, podiums: 0, wins: 0, adsWatched: 0,
};

test('a brand-new player has no badges', () => {
  assert.equal(badgeStates(none).filter((b) => b.unlocked).length, 0);
});

test('badges unlock exactly at their target, and progress is capped', () => {
  const s = badgeStates({ ...none, lifetimeSteps: 50_000, parcels: 1, rubies: 1 });
  const get = (k: string) => s.find((b) => b.key === k)!;
  assert.equal(get('first_steps').unlocked, true);
  assert.equal(get('walker').unlocked, true);
  assert.equal(get('trekker').unlocked, false);
  assert.equal(get('trekker').progress, 50_000);
  assert.equal(get('first_steps').progress, 1_000, 'progress never exceeds the target');
  assert.equal(get('ruby').unlocked, true);
  assert.equal(get('landowner').unlocked, false);
});

test('badge keys are unique and fit the database column', () => {
  assert.equal(new Set(BADGES.map((b) => b.key)).size, BADGES.length);
  for (const b of BADGES) assert.ok(b.key.length <= 32 && b.target > 0, b.key);
});

test('levels need a little more walking each time', () => {
  assert.equal(levelFor(0).level, 1);
  assert.equal(levelFor(2_499).level, 1);
  assert.equal(levelFor(2_500).level, 2);
  assert.equal(levelFor(40_000).level, 5);
  assert.equal(levelFor(202_500).level, 10);
  const l = levelFor(50_000);
  assert.ok(l.current <= 50_000 && 50_000 < l.next);
});

test('jersey colours are valid hex', () => {
  for (const c of JERSEY_COLORS) assert.match(c, /^#[0-9A-F]{6}$/i);
});
