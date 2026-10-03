import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AvatarChoice, AvatarItemState, AvatarSlot, Profile } from '@/api/types';
import { SLOT_ORDER } from '@/game/avatar';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { adsAvailable } from '@/native/ads';
import { haptics } from '@/native/haptics';
import { colors, fonts, radius, space, type } from '@/theme';
import { ApiError, api } from '@/api/client';
import { pickProfilePhoto, photoPickerAvailable } from '@/native/photo';
import { useSession } from '@/state/session';
import { AvatarPortrait } from './AvatarPortrait';
import { Runner } from './Runner';

import { Button } from './Button';
import { DraggableSheet, SheetScrollView } from './DraggableSheet';
import { PlayerPicture } from './PlayerPicture';
import { PlayAdIcon } from './icons';

/**
 * Rarity colours. Deliberately NOT the mineral palette - a gold hat is not a
 * ruby parcel, and reusing those colours would imply the two ladders are the
 * same thing.
 */
const RARITY_COLOR: Record<string, string> = {
  COMMON: 'transparent',
  UNCOMMON: '#4DBE94',
  RARE: '#2A8FD4',
  LEGENDARY: '#E0B93C',
};

/**
 * Dress your character. Parts unlock by level, by badge, or by watching one
 * rewarded ad - and an ad here costs the game nothing at all, which makes it
 * the friendliest ad in the app: entirely optional, and for something you
 * actually want.
 */
export function AvatarEditor({
  visible,
  profile,
  onClose,
  onChange,
  onUnlocked,
}: {
  visible: boolean;
  profile: Profile;
  onClose: () => void;
  onChange: (choice: AvatarChoice) => void;
  onUnlocked: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { token } = useSession();
  const [slot, setSlot] = useState<AvatarSlot>('skin');
  const { watch, busy } = useRewardedAd(onUnlocked);
  const [note, setNote] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  // The picture just chosen, shown straight from the phone while it uploads
  // and the profile reloads - testers found the wait for the round trip slow.
  const [preview, setPreview] = useState<string | null>(null);

  // An ad already watched for a picture that was never chosen (the library
  // was cancelled). Kept, so the next try does not cost a second ad; the
  // server spends the ticket only when a picture is actually stored.
  const [paidNonce, setPaidNonce] = useState<string | null>(null);

  /**
   * Change the profile picture. One rewarded ad per change, AD FIRST.
   *
   * It used to pick the image and then play the ad. On Android the ad was
   * requested while the photo library was still closing, and testers reported
   * changing their picture "with no ad" - the swap looked free. Now the ad
   * plays first, plainly, and the library opens after it. Cancelling the
   * library does not waste the ad: its ticket is kept for the next try.
   */
  async function changePhoto() {
    if (!token) return;
    setNote(null);
    let nonce = paidNonce;
    if (!nonce) {
      const ad = await watch('PHOTO');
      if (!ad.ok) {
        setNote(ad.message);
        return;
      }
      nonce = ad.nonce;
      setPaidNonce(nonce);
    }

    const picked = await pickProfilePhoto();
    if (!picked.ok) {
      if (picked.reason === 'denied') setNote('Fareground needs permission to open your photos.');
      else if (picked.reason === 'unavailable') setNote('Update the app to change your picture.');
      else if (picked.reason === 'failed') setNote('That image could not be used. Try another.');
      else setNote('Ad saved - pick a picture whenever you like.');
      return;
    }

    setPhotoBusy(true);
    setPreview(`data:image/jpeg;base64,${picked.base64}`);
    try {
      await api.setPhoto(token, picked.base64, nonce);
      setPaidNonce(null);
      haptics.success();
      setNote('Picture updated.');
      onUnlocked();
    } catch (e) {
      haptics.warn();
      setPreview(null); // it did not save: show what the server really has
      // A ticket the server says is used up is no good for a retry; after a
      // bad image or a dropped connection it still is.
      if (e instanceof ApiError && e.status === 409) setPaidNonce(null);
      setNote(e instanceof ApiError ? e.message : 'That picture could not be saved.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    if (!token) return;
    setNote(null);
    setPhotoBusy(true);
    try {
      await api.clearPhoto(token);
      setPreview(null);
      setNote('Back to your initial.');
      onUnlocked();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Could not remove that picture.');
    } finally {
      setPhotoBusy(false);
    }
  }

  const items = (profile.avatarItems ?? []).filter((i) => i.slot === slot);

  async function unlock(item: AvatarItemState) {
    setNote(null);
    const r = await watch('COSMETIC', { cosmeticKey: item.key });
    if (r.ok) {
      setNote(`${item.name} unlocked!`);
      onChange({ [slot]: item.key });
    } else {
      setNote(r.message);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <DraggableSheet onClose={onClose} style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]} gripStyle={styles.grip}>

        <View style={styles.head}>
          <AvatarPortrait avatar={profile.avatar} size={84} />
          <View style={{ flex: 1 }}>
            <Text style={type.title}>Your look</Text>
            <Text style={[type.caption, { marginTop: 2 }]}>
              Your character runs on the map. Your picture is what other players see in lists.
            </Text>
          </View>
        </View>

        {/* The picture, which is a different thing from the character. */}
        <View style={styles.photoRow}>
          <PlayerPicture photoUrl={preview ?? profile.photoUrl} username={profile.username} size={56} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Button
              variant={profile.photoUrl ? 'secondary' : 'boost'}
              label={paidNonce ? 'Pick your picture' : profile.photoUrl ? 'Change picture' : 'Add a picture'}
              icon={<PlayAdIcon size={18} color={profile.photoUrl ? colors.accent : undefined} />}
              onPress={changePhoto}
              busy={photoBusy || busy === 'PHOTO'}
              disabled={photoBusy || busy !== null || !photoPickerAvailable()}
            />
            {profile.photoUrl ? (
              <Pressable onPress={removePhoto} hitSlop={8} disabled={photoBusy}>
                <Text style={styles.removeText}>Remove picture</Text>
              </Pressable>
            ) : (
              <Text style={type.caption}>
                Without one you appear as {profile.username.slice(0, 1).toUpperCase()} on a colour.
              </Text>
            )}
          </View>
        </View>

        <View style={styles.tabs}>
          {SLOT_ORDER.map((s) => (
            <Pressable
              key={s.slot}
              onPress={() => { haptics.tap(); setSlot(s.slot); }}
              style={[styles.tab, slot === s.slot && styles.tabOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: slot === s.slot }}
            >
              <Text style={[styles.tabText, slot === s.slot && { color: colors.ink }]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        <SheetScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {items.map((item) => {
            const worn = profile.avatar[slot] === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => {
                  haptics.tap();
                  if (item.unlocked) onChange({ [slot]: item.key });
                  else if (item.buyable && adsAvailable()) unlock(item);
                  else setNote(`${item.name}: ${item.requirement ?? 'locked'}`);
                }}
                style={({ pressed }) => [
                  styles.item,
                  worn && styles.itemOn,
                  !item.unlocked && styles.itemLocked,
                  pressed && { opacity: 0.75 },
                ]}
                accessibilityLabel={
                  `${item.name}, ${item.rarity.toLowerCase()}` +
                  (item.unlocked ? '' : `, locked: ${item.requirement}`)
                }
              >
                {/* SHOES PREVIEW AS THE RUNNER, not the portrait.
                    The portrait is head and shoulders, so an entire slot
                    would otherwise show eight identical faces and no way to
                    tell the parts apart. */}
                {slot === 'shoes' ? (
                  <View style={styles.runnerPreview}>
                    <Runner avatar={{ ...profile.avatar, [slot]: item.key }} gait="idle" size={44} />
                  </View>
                ) : (
                  <AvatarPortrait
                    avatar={{ ...profile.avatar, [slot]: item.key }}
                    size={54}
                    ring={worn ? colors.accent : undefined}
                  />
                )}
                {/* A rarity pip, so a collection reads as a ladder rather
                    than a list. Colour only - the name is in the label for
                    anyone who cannot distinguish them. */}
                {item.rarity !== 'COMMON' && (
                  <View style={[styles.rarityPip, { backgroundColor: RARITY_COLOR[item.rarity] }]} />
                )}
                <Text style={[styles.itemName, !item.unlocked && { color: colors.ink3 }]} numberOfLines={1}>
                  {item.name}
                </Text>
                {!item.unlocked &&
                  (item.buyable ? (
                    <View style={styles.adTag}>
                      <PlayAdIcon size={12} />
                      <Text style={styles.adTagText}>{busy === 'COSMETIC' ? '…' : 'Ad'}</Text>
                    </View>
                  ) : (
                    <Text style={styles.lockText} numberOfLines={1}>{item.requirement}</Text>
                  ))}
              </Pressable>
            );
          })}
        </SheetScrollView>

        {note && <Text style={styles.note}>{note}</Text>}
        <Button label="Done" onPress={onClose} variant="primary" />
      </DraggableSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: colors.sunk,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.lg,
  },
  removeText: { fontFamily: fonts.bold, fontSize: 13, color: colors.danger, textAlign: 'center' },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(8,12,10,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '90%',
    backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl, paddingTop: space.sm, gap: space.md,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  tabs: { flexDirection: 'row', backgroundColor: colors.sunk, borderRadius: radius.md, padding: 4, gap: 3 },
  tab: { flex: 1, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  tabText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink3, includeFontPadding: false },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingBottom: space.sm },
  item: {
    width: '31.5%', alignItems: 'center', gap: 4, paddingVertical: space.md, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.line,
  },
  itemOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  itemLocked: { backgroundColor: colors.sunk },
  itemName: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink, includeFontPadding: false },
  lockText: { fontFamily: fonts.medium, fontSize: 10.5, color: colors.ink3, includeFontPadding: false },
  adTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.boost,
    borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2,
  },
  adTagText: { color: '#FFFFFF', fontFamily: fonts.heavy, fontSize: 10.5, includeFontPadding: false },
  runnerPreview: { height: 54, alignItems: 'center', justifyContent: 'center' },
  rarityPip: {
    position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.25)',
  },
  note: { ...type.caption, textAlign: 'center' },
});
