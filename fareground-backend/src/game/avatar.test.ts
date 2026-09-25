import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVATAR_SLOTS,
  DEFAULT_AVATAR,
  itemsForSlot,
  rarityOf,
  AD_UNLOCKABLE,
  AVATAR_ITEMS,
  AVATAR_SLOTS,
  DEFAULT_AVATAR,
  jerseyColorOf,
  sanitizeAvatar,
  unlockedItems,
} from './avatar';

const nobody = { level: 1, badges: new Set<string>(), bought: new Set<string>() };

test('every slot has a free option, and the default is all free', () => {
  const free = unlockedItems(nobody);
  for (const slot of AVATAR_SLOTS) {
    assert.ok(AVATAR_ITEMS.some((i) => i.slot === slot && i.unlock === 'FREE'), `${slot} needs a free option`);
    assert.ok(free.has(DEFAULT_AVATAR[slot]), `default ${slot} must be free`);
  }
});

test('item keys are unique and fit the database column', () => {
  assert.equal(new Set(AVATAR_ITEMS.map((i) => i.key)).size, AVATAR_ITEMS.length);
  for (const i of AVATAR_ITEMS) assert.ok(i.key.length <= 32, i.key);
});

test('skin tones are never locked behind anything', () => {
  for (const i of AVATAR_ITEMS.filter((x) => x.slot === 'skin')) assert.equal(i.unlock, 'FREE', i.key);
  assert.ok(AVATAR_ITEMS.filter((i) => i.slot === 'skin').length >= 5, 'offer a real range of skin tones');
});

test('levels, badges and ads unlock what they should', () => {
  assert.equal(unlockedItems(nobody).has('hair_bun'), false, 'level 3 hair is locked at level 1');
  assert.equal(unlockedItems({ ...nobody, level: 3 }).has('hair_bun'), true);
  assert.equal(unlockedItems(nobody).has('hat_crown'), false);
  assert.equal(unlockedItems({ ...nobody, badges: new Set(['champion']) }).has('hat_crown'), true);
  assert.equal(unlockedItems(nobody).has('hat_bucket'), false);
  assert.equal(unlockedItems({ ...nobody, bought: new Set(['hat_bucket']) }).has('hat_bucket'), true);
});

test('a locked, unknown or wrong-slot choice falls back to the default', () => {
  const free = unlockedItems(nobody);
  assert.deepEqual(sanitizeAvatar({ hat: 'hat_crown' }, free).hat, DEFAULT_AVATAR.hat, 'locked item refused');
  assert.deepEqual(sanitizeAvatar({ hat: 'nonsense' }, free).hat, DEFAULT_AVATAR.hat, 'unknown item refused');
  assert.deepEqual(sanitizeAvatar({ hat: 'hair_short' }, free).hat, DEFAULT_AVATAR.hat, 'wrong slot refused');
  assert.deepEqual(sanitizeAvatar(null, free), DEFAULT_AVATAR);
  assert.equal(sanitizeAvatar({ hat: 'hat_cap' }, free).hat, 'hat_cap', 'a free item is kept');

  // A bad choice keeps what they were wearing, rather than resetting the slot.
  const wearing = { ...DEFAULT_AVATAR, hat: 'hat_cap' };
  assert.equal(sanitizeAvatar({ hat: 'hat_crown' }, free, wearing).hat, 'hat_cap');
});

test('the shirt decides the runner colour', () => {
  assert.equal(jerseyColorOf(sanitizeAvatar({ shirt: 'shirt_ruby' }, unlockedItems(nobody))), '#C0304A');
  assert.match(jerseyColorOf(DEFAULT_AVATAR), /^#[0-9A-F]{6}$/i);
});

test('there are plenty of ad-unlockable items, and none of them affect the game', () => {
  assert.ok(AD_UNLOCKABLE.length >= 5, `only ${AD_UNLOCKABLE.length} ad items`);
  for (const key of AD_UNLOCKABLE) {
    const item = AVATAR_ITEMS.find((i) => i.key === key);
    assert.ok(item, `${key} is sold by ad but is not an avatar part at all`);
    // THE RULE: an ad may only ever unlock a LOOK. Asserted against
    // AVATAR_SLOTS rather than a written-out list, so adding a cosmetic slot
    // does not fail this - while unlocking anything outside the avatar
    // system still does, which is the thing actually worth guarding.
    assert.ok(AVATAR_SLOTS.includes(item.slot), `${key} is not in a cosmetic slot`);
    // Cosmetics must cost the economy nothing: no part may carry a rate, a
    // reward or a multiplier. Catches a future "+10% coins hat".
    const fields = Object.keys(item);
    const gameplay = fields.filter((f) => /coin|wp|walk|rate|bonus|multiplier|reward|boost/i.test(f));
    assert.deepEqual(gameplay, [], `${key} carries gameplay fields: ${gameplay.join(', ')}`);
  }
});

test('every slot has something free to wear, and something worth earning', () => {
  for (const slot of AVATAR_SLOTS) {
    const items = itemsForSlot(slot);
    assert.ok(items.length >= 2, `slot ${slot} has only ${items.length} parts`);
    assert.ok(
      items.some((i) => i.unlock === 'FREE'),
      `slot ${slot} has nothing free - a new player would see a locked row`,
    );
    // SKIN IS EXEMPT, DELIBERATELY. Every tone is free and always will be:
    // nobody should have to reach level 6 or watch an ad to look like
    // themselves. Locking one would be the single worst thing in this file,
    // so the exemption is written down rather than left as an oversight.
    if (slot !== 'skin') {
      assert.ok(
        items.some((i) => i.unlock !== 'FREE'),
        `slot ${slot} is entirely free - nothing to earn`,
      );
    }
    // The editor shows them commonest first, so the locked ones read as a
    // ladder rather than a scatter.
    const order = { COMMON: 0, UNCOMMON: 1, RARE: 2, LEGENDARY: 3 } as const;
    for (let i = 1; i < items.length; i++) {
      assert.ok(
        order[rarityOf(items[i])] >= order[rarityOf(items[i - 1])],
        `slot ${slot} is not sorted by rarity`,
      );
    }
  }
});

test('the default avatar is wearable by somebody who has just signed up', () => {
  // A default referencing a locked part would show every new player a
  // character they are not allowed to keep.
  const free = unlockedItems({ level: 1, badges: new Set(), bought: new Set() });
  for (const slot of AVATAR_SLOTS) {
    assert.ok(free.has(DEFAULT_AVATAR[slot]), `the default ${slot} (${DEFAULT_AVATAR[slot]}) is locked`);
  }
});

test('badges mostly unlock something, so earning one changes how you look', () => {
  // Fifteen badges unlocked nothing before 2026-09-25. A badge that changes
  // nothing is a line in a list; one that changes your runner is a reason to
  // go and earn it.
  const rewarded = new Set(AVATAR_ITEMS.filter((i) => i.unlock === 'BADGE').map((i) => i.badge));
  assert.ok(rewarded.size >= 12, `only ${rewarded.size} badges unlock a cosmetic`);
});

test('EVERY SKIN TONE IS FREE, AND STAYS FREE', () => {
  // The one rule in the avatar system that is not about balance. Nobody
  // should have to earn, or watch an ad for, the tone that looks like them.
  const skins = itemsForSlot('skin');
  assert.ok(skins.length >= 6, `only ${skins.length} skin tones`);
  for (const s of skins) {
    assert.equal(s.unlock, 'FREE', `${s.key} is not free`);
  }
});
