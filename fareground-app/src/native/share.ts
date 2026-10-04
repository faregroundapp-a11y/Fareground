import { Share } from 'react-native';
import { SITE_URL } from '@/config';

/**
 * SHARING (2026-10-04): the phone's own share sheet - Discord, WhatsApp,
 * Instagram DMs, Messages - with a line of text and the website link. No
 * extra native code, so it works on every phone and needs nothing set up.
 * Never throws: a cancelled share is not an error.
 */
async function share(message: string) {
  try {
    await Share.share({ message: `${message}\n${SITE_URL}` });
  } catch {
    // The share sheet failed to open; nothing to tell the player.
  }
}

export function shareParcel(mineral: string, coinsPerMonth: string, level: number) {
  const lvl = level > 0 ? ` (level ${level})` : '';
  return share(`I own a ${mineral} mine${lvl} on Fareground - it earns ${coinsPerMonth} coins a month while I walk. Come and claim the squares next to mine!`);
}

export function shareRank(rank: number, area: string, steps: number) {
  const place = rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `#${rank}`;
  return share(`I'm ${place} in ${area} on Fareground this week with ${steps.toLocaleString()} steps. Think you can beat me?`);
}
