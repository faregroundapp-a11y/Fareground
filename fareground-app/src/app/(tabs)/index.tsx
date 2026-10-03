import { Camera, Map, type MapRef } from '@maplibre/maplibre-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api/client';
import type { ClaimSummary, NearbyParcel, Parcel, TreasureBox } from '@/api/types';
import { BoostSheet } from '@/components/BoostSheet';
import { ClaimButton, type ClaimState } from '@/components/ClaimButton';
import { CELEBRATION_MS, ClaimCelebration } from '@/components/ClaimCelebration';
import { CLAIM_FX_MS, ClaimFx, type ClaimFxSpec } from '@/components/ClaimFx';
import { Countdown } from '@/components/Countdown';
import { CommunitySheet } from '@/components/CommunitySheet';
import { PlayerPicture } from '@/components/PlayerPicture';
import { CountUp } from '@/components/CountUp';
import { DailySheet } from '@/components/DailySheet';
import { DoorbellSheet } from '@/components/DoorbellSheet';
import { BoltIcon, ChestIcon, ChevronIcon, CoinIcon, CompassIcon, FlagIcon, PeopleIcon, PlayAdIcon, PointerIcon, StepsIcon, StreetSignIcon } from '@/components/icons';
import { PlayerMarker } from '@/components/PlayerMarker';
import { TreasureMarkers } from '@/components/TreasureMarkers';
import { RevealSheet } from '@/components/RevealSheet';
import { Runner } from '@/components/Runner';
import { WorldLayers } from '@/components/WorldLayers';
import { DEFAULT_PARCEL_PRICE, MAX_CLAIM_ACCURACY_M } from '@/config';
import { useMapStyle } from '@/game/mapStyle';
import { CLAIM_REACH_M, bearingBetween, cellKey, claimableAround, distanceToCell, metresBetween, sameCell } from '@/game/geo';
import { cellForLatLng, type Cell } from '@/game/grid';
import { MINERALS, MINERAL_ORDER, formatMultiplier, formatRate } from '@/game/minerals';
import { useAreaReporter } from '@/hooks/useAreaReporter';
import { useGameCamera } from '@/hooks/useGameCamera';
import { useLocation, type Fix } from '@/hooks/useLocation';
import { useNearby } from '@/hooks/useNearby';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { useTabBarSpace } from '@/hooks/useTabBarSpace';
import { useTreasure } from '@/hooks/useTreasure';
import { adsAvailable } from '@/native/ads';
import { haptics } from '@/native/haptics';
import { router } from 'expo-router';
import { useGameBalance, useGameDaily } from '@/state/game';
import { useSession } from '@/state/session';
import { colors, fonts, mono, radius, space, TOUCH, type } from '@/theme';

/**
 * Below this much movement the lit squares and reach circle are left alone.
 * GPS wobbles a metre or two even when you stand still; redrawing the map's
 * sources for that every second is wasted work (and visible as jitter).
 */
const SETTLE_M = 2;

/** A position that only updates once you have really moved. */
function useSettledPosition(lat: number, lng: number) {
  const [pos, setPos] = useState({ lat, lng });
  // Derived state, updated during render (React's documented pattern), so it
  // never lags a frame behind.
  if (metresBetween(pos.lat, pos.lng, lat, lng) > SETTLE_M) {
    setPos({ lat, lng });
  }
  return pos;
}

/** Handles the "not ready yet" states, then hands over to the game view. */
export default function MapScreen() {
  const location = useLocation();

  if (location.status === 'denied') {
    return (
      <Centered>
        <Runner gait="idle" size={80} />
        <Text style={styles.centeredTitle}>Fareground needs your location</Text>
        <Text style={styles.centeredBody}>
          The whole game is the ground under your feet. Turn on location for Fareground in Settings, then come back.
        </Text>
      </Centered>
    );
  }
  if (location.status !== 'ok') {
    return (
      <Centered>
        <Runner gait="walk" size={80} />
        <Text style={styles.centeredBody}>Finding where you are…</Text>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  }
  // Mounted only once there is a fix, so the camera starts in the right place.
  return <GameView fix={location.fix} />;
}

function GameView({ fix }: { fix: Fix }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { token, user } = useSession();
  const { balance, boostEndsAt, prizeEndsAt, refresh: refreshBalance, awayCoins, dismissAway } = useGameBalance();
  const { daily, refresh: refreshDaily } = useGameDaily();

  const { parcels, refresh: refreshNearby } = useNearby(fix.lat, fix.lng);

  const centre = useMemo<[number, number]>(() => [fix.lng, fix.lat], [fix.lng, fix.lat]);
  const mapRef = useRef<MapRef>(null);
  // Street names on or off, following the setting. See game/mapStyle.ts.
  // Map labels on or off, from the street-sign button (and Settings).
  const { style: mapStyle, styleKey, labelsOn, toggleLabels } = useMapStyle();
  const settled = useSettledPosition(fix.lat, fix.lng);
  const { treasure, open: openBox, refresh: refreshTreasure } = useTreasure(settled.lat, settled.lng);
  const { watch, busy: adBusy } = useRewardedAd(() => {
    refreshBalance();
    refreshDaily();
    refreshTreasure();
  });
  // Which leaderboards you are on (city / region / country).
  useAreaReporter(settled.lat, settled.lng);

  // --- a short message over the map, for taps that cannot do anything ---
  // Scouting (a rewarded ad) widens the reach for a few minutes. The app
  // always shows a little less than the server allows, so drift between
  // tapping and the request arriving cannot turn a promise into a refusal.
  const scout = balance?.rewards.scout;
  const reach = scout?.active ? scout.reachM - 10 : CLAIM_REACH_M;

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // How far each treasure box is, and whether one is close enough to open.
  const boxes = treasure?.boxes ?? EMPTY_BOXES;
  const withinM = treasure?.collectWithinM ?? 30;
  const boxDistances = useMemo(() => {
    const out: Record<string, number> = {};
    for (const b of boxes) out[b.id] = metresBetween(fix.lat, fix.lng, b.lat, b.lng);
    return out;
  }, [boxes, fix.lat, fix.lng]);
  const reachableBox = boxes.find((b) => (boxDistances[b.id] ?? Infinity) <= withinM) ?? null;
  const [openingBox, setOpeningBox] = useState(false);
  /** The box reward just collected, while an ad could still double it. */
  const [boxClaim, setBoxClaim] = useState<ClaimSummary | null>(null);
  const [community, setCommunity] = useState(false);

  /**
   * Ads already watched for a claim or a box that then did not happen (the
   * square was taken a moment before, the box moved out of reach). The server
   * spends an ad only when the action succeeds, so it is kept for the next
   * try instead of costing a second ad.
   */
  const [heldClaimAd, setHeldClaimAd] = useState<string | null>(null);

  // The bottom panel, folded or not. Remembered between launches.
  const [dockMin, setDockMin] = useState(false);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(DOCK_MIN_KEY)
      .then((v) => { if (live && v === '1') setDockMin(true); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  const toggleDock = useCallback(() => {
    setDockMin((m) => {
      void AsyncStorage.setItem(DOCK_MIN_KEY, m ? '0' : '1').catch(() => undefined);
      return !m;
    });
  }, []);
  const [heldKeyAd, setHeldKeyAd] = useState<string | null>(null);

  async function grabBox() {
    if (!reachableBox || openingBox) return;
    setOpeningBox(true);
    haptics.press();
    try {
      // A box an ad already paid to spawn opens free; any other needs a key.
      let key: string | undefined;
      if (!reachableBox.fromAd) {
        key = heldKeyAd ?? undefined;
        if (!key) {
          const ad = await watch('TREASURE_KEY');
          if (!ad.ok) {
            showToast(ad.message);
            return;
          }
          key = ad.nonce;
          setHeldKeyAd(key);
        }
      }
      const claim = await openBox(reachableBox.id, { lat: fix.lat, lng: fix.lng }, key);
      setHeldKeyAd(null);
      haptics.success();
      showToast(`Treasure! +${claim.amount} Walk Points.`);
      setBoxClaim(claim);
      refreshBalance();
    } catch (e) {
      haptics.warn();
      if (e instanceof ApiError && e.status === 402) setHeldKeyAd(null); // that key is spent
      showToast(e instanceof Error ? e.message : 'Could not open that box.');
    } finally {
      setOpeningBox(false);
    }
  }

  /** Double what the box just paid - the best moment to offer an ad. */
  async function doubleBox() {
    if (!boxClaim) return;
    const r = await watch('DOUBLE', { targetClaimId: boxClaim.id });
    showToast(r.ok ? `Doubled! +${r.amount} more Walk Points.` : r.message);
    setBoxClaim(null);
    refreshBalance();
  }

  /** No box waiting? One ad puts another one out there. */
  async function adBox() {
    const r = await watch('TREASURE', undefined, { lat: fix.lat, lng: fix.lng });
    showToast(r.ok ? 'A new box has appeared - go and get it!' : r.message);
  }

  const [boostOpen, setBoostOpen] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);


  // Open "Today" by itself once a day, when there is a chest waiting - the
  // habit loop that brings people back every morning.
  const chestReady = !!daily?.daily.available;
  const dailyDay = daily?.today;
  useEffect(() => {
    if (!chestReady || !dailyDay) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const last = await AsyncStorage.getItem('fareground.dailyAutoOpen');
        if (cancelled || last === dailyDay) return;
        await AsyncStorage.setItem('fareground.dailyAutoOpen', dailyDay);
        setDailyOpen(true);
      } catch {
        /* storage unavailable: just don't auto-open */
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [chestReady, dailyDay]);

  // --- which square the claim button is aimed at ---
  // `picked` is a square you tapped. With no pick (or once it falls out of
  // reach) the nearest free square is chosen for you, so there is almost
  // always a one-tap claim - including at home, standing on land you own.
  const [picked, setPicked] = useState<Cell | null>(null);
  /** The parcel whose doorbell is open, if any. */
  const [doorbell, setDoorbell] = useState<string | null>(null);
  const ownerRef = useRef(new globalThis.Map<string, NearbyParcel>());

  const onTap = useCallback(
    async (x: number, y: number) => {
      const lngLat = await mapRef.current?.unproject([x, y]);
      if (!lngLat) return;
      const cell = cellForLatLng(lngLat[1], lngLat[0]);
      const d = distanceToCell(fix.lat, fix.lng, cell);
      if (d > reach) {
        haptics.warn();
        showToast(`That square is ${Math.round(d)} m away. Walk within ${reach} m to claim it.`);
        return;
      }
      haptics.tap();
      setPicked(cell);

      // Somebody else's plot? That is a door, not a claim target. Ring it.
      const owner = ownerRef.current.get(cellKey(cell));
      if (owner && !owner.mine) setDoorbell(owner.id);
    },
    [fix.lat, fix.lng, reach, showToast],
  );

  const { cameraRef, viewRef, panHandlers, measure, faceNorth, swoop, peek, bearing, initialViewState } =
    useGameCamera(centre, onTap);

  /**
   * THE TREASURE FINDER. Press it and the camera flies to the nearest box and
   * back, then a pointer stays on screen showing which way it is and how far.
   * Press again to put it away. Follows the box list, so it quietly
   * disappears once there is no box left to point at.
   */
  const [finderOn, setFinderOn] = useState(false);
  const nearestBox = useMemo(() => {
    let best: { box: TreasureBox; m: number } | null = null;
    for (const box of boxes) {
      const m = metresBetween(settled.lat, settled.lng, box.lat, box.lng);
      if (!best || m < best.m) best = { box, m };
    }
    return best;
  }, [boxes, settled.lat, settled.lng]);
  const toggleFinder = useCallback(() => {
    haptics.tap();
    if (finderOn) {
      setFinderOn(false);
      return;
    }
    if (!nearestBox) {
      showToast('No treasure box nearby right now.');
      return;
    }
    setFinderOn(true);
    peek([nearestBox.box.lng, nearestBox.box.lat]);
  }, [finderOn, nearestBox, peek, showToast]);
  // Screen-relative: the map turns, so subtract the camera's bearing.
  const pointerRotation = nearestBox
    ? bearingBetween(settled.lat, settled.lng, nearestBox.box.lat, nearestBox.box.lng) - bearing
    : 0;

  const [claiming, setClaiming] = useState(false);
  const [fx, setFx] = useState<ClaimFxSpec | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [revealed, setRevealed] = useState<Parcel | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const pending = timers.current;
    const toastT = toastTimer;
    return () => {
      pending.forEach(clearTimeout);
      if (toastT.current) clearTimeout(toastT.current);
    };
  }, []);

  // The player's square only changes when you cross into a new one - so the
  // grid (up to 74 lines) is rebuilt a few times a minute, not every fix.
  // NARROW PHONES GET SMALLER CHIPS, not squashed ones. Measured: the full
  // -size HUD needs about 390pt of chrome, so anything under ~400 has to
  // shed something rather than compress. 400 is the line because a 390pt
  // iPhone and a 360pt Android are both below it and a 412pt Pixel is not.
  const compactHud = width < 400;
  const tabBarSpace = useTabBarSpace();

  const { cellX, cellY } = cellForLatLng(fix.lat, fix.lng);
  const playerCell = useMemo<Cell>(() => ({ cellX, cellY }), [cellX, cellY]);

  const ownerOf = useMemo(() => new globalThis.Map(parcels.map((p) => [cellKey(p), p])), [parcels]);
  // Kept in a ref for onTap, which must NOT depend on it: a dependency there
  // rebuilds the tap handler - and with it the camera controller - every time
  // nearby refreshes. Written in an effect, never in render (React Compiler).
  useEffect(() => {
    ownerRef.current = ownerOf;
  }, [ownerOf]);
  const taken = useMemo(() => new Set(parcels.map(cellKey)), [parcels]);
  const { cells: claimable, nearest } = useMemo(
    () => claimableAround(settled.lat, settled.lng, taken, reach),
    [settled.lat, settled.lng, taken, reach],
  );

  const pickedInReach = picked !== null && distanceToCell(fix.lat, fix.lng, picked) <= reach;
  const selected: Cell | null = pickedInReach ? picked : nearest;
  const selectedOwner = selected ? ownerOf.get(cellKey(selected)) : undefined;
  const selectedDistance = selected ? Math.round(distanceToCell(fix.lat, fix.lng, selected)) : 0;

  // --- screen shake, for rare finds ---
  const [shake] = useState(() => new Animated.Value(0));
  const doShake = useCallback(
    (strength: number) => {
      const seq = [strength, -strength, strength * 0.7, -strength * 0.7, strength * 0.35, 0].map((v) =>
        Animated.timing(shake, { toValue: v, duration: 55, useNativeDriver: true }),
      );
      Animated.sequence(seq).start();
    },
    [shake],
  );

  // --- what the claim button can do, in priority order ---
  const wp = balance?.walkPoints ?? 0;
  const price = balance?.parcelPrice ?? DEFAULT_PARCEL_PRICE;
  let claimState: ClaimState = { kind: 'ready' };
  if (fix.accuracyM > MAX_CLAIM_ACCURACY_M) {
    claimState = { kind: 'blocked', reason: `GPS is fuzzy (±${Math.round(fix.accuracyM)} m). Step outside for a clearer fix.` };
  } else if (!selected) {
    claimState = { kind: 'blocked', reason: 'Every square within reach is taken. Walk on a little.' };
  } else if (selectedOwner?.mine) {
    claimState = { kind: 'blocked', reason: `This ${MINERALS[selectedOwner.rarity].label} parcel is yours` };
  } else if (selectedOwner) {
    claimState = { kind: 'blocked', reason: 'Another explorer owns this parcel - tap it to ring the doorbell' };
  } else if (wp < price) {
    claimState = { kind: 'short', have: wp, need: price };
  }

  async function claim() {
    if (!token || claiming || !selected) return;
    setClaiming(true);
    haptics.press();
    try {
      // THE PRICE OF LAND IS AN AD (2026-09-27), watched before the claim.
      let adNonce = heldClaimAd;
      if (!adNonce) {
        const ad = await watch('CLAIM');
        if (!ad.ok) {
          showToast(ad.message);
          return;
        }
        adNonce = ad.nonce;
        setHeldClaimAd(adNonce);
      }
      // Send where you ARE and the square you chose; the server checks reach.
      const result = await api.claim(
        token,
        { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, mocked: fix.mocked },
        { cellX: selected.cellX, cellY: selected.cellY },
        adNonce,
      );
      setHeldClaimAd(null);
      const p = result.parcel;
      setPicked(null); // the next nearest free square becomes the target

      // 1. The moment: the block erupts, the camera leans in, the runner
      //    cheers, gems fly - and the phone thumps, harder for rarer finds.
      haptics.claim(MINERAL_ORDER.indexOf(p.rarity));
      setFx({ cellX: p.cellX ?? playerCell.cellX, cellY: p.cellY ?? playerCell.cellY, rarity: p.rarity, key: Date.now() });
      setCelebrating(true);
      swoop();
      refreshBalance(); // WP rolls down while you watch
      refreshNearby();
      refreshDaily(); // "claim a parcel" quest

      // 2. Then the receipt.
      timers.current.push(
        setTimeout(() => {
          setCelebrating(false);
          setRevealed(p);
        }, CELEBRATION_MS),
        setTimeout(() => setFx(null), CLAIM_FX_MS + 400),
      );
    } catch (e) {
      haptics.warn();
      if (e instanceof ApiError && e.status === 402) setHeldClaimAd(null); // that ad is spent
      Alert.alert("Couldn't claim this parcel", e instanceof Error ? e.message : 'Please try again.');
      refreshNearby(); // it may have been taken a moment ago
    } finally {
      setClaiming(false);
    }
  }

  const closeReveal = useCallback(() => {
    setRevealed(null);
  }, []);

  // Ad boosts and leaderboard prize boosts add up; show the total, and time
  // down whichever ends first.
  const multiplier = balance?.rewards.activeMultiplier ?? 1;
  const boosted = multiplier > 1;
  const chipEndsAt = boostEndsAt ?? prizeEndsAt;
  const rate = balance?.effectiveCoinsPerMonth ?? 0;
  // The server's rate is already per month; the chip shows a day of it.
  const perMonth = rate;
  const perDay = rate / 30;
  const hideCell = fx ? { cellX: fx.cellX, cellY: fx.cellY } : null;
  const reachCentre = useMemo(() => ({ lat: settled.lat, lng: settled.lng }), [settled.lat, settled.lng]);

  return (
    <Animated.View style={[styles.root, { transform: [{ translateX: shake }] }]}>
      <Map
        // Rebuilt when the style changes, so the parcel layers come back
        // with it (see styleKey in mapStyle.ts).
        key={styleKey}
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={mapStyle}
        // All gestures are ours (see useGameCamera) - the map just draws.
        dragPan={false}
        touchZoom={false}
        touchRotate={false}
        touchPitch={false}
        doubleTapZoom={false}
        compass={false}
        logo={false}
        attribution // OpenStreetMap data: attribution must stay visible
        attributionPosition={{ top: insets.top + 64, left: 10 }}
      >
        <Camera ref={cameraRef} initialViewState={initialViewState} minZoom={15} maxZoom={20} />
        <WorldLayers
          playerCell={playerCell}
          player={reachCentre}
          parcels={parcels}
          claimable={celebrating ? EMPTY : claimable}
          selected={celebrating ? null : selected}
          selectedIsFree={!selectedOwner}
          hideCell={hideCell}
          reachM={reach}
        />
        <TreasureMarkers
            boxes={boxes}
            distances={boxDistances}
            withinM={withinM}
            onPressBox={(box, away) => {
              if (reachableBox?.id === box.id) {
                void grabBox();
              } else {
                haptics.tap();
                showToast(
                  away === undefined
                    ? `Treasure box · +${box.rewardWp} WP. Walk to it to open it.`
                    : `${Math.round(away)} m away · +${box.rewardWp} WP. Get within ${withinM} m to open it.`,
                );
              }
            }}
          />
        {fx && <ClaimFx spec={fx} />}
        <PlayerMarker fix={fix} bearing={bearing} celebrating={celebrating} avatar={balance?.avatar} />
      </Map>

      {/* Our gesture surface: spin, pinch, twist. */}
      <View ref={viewRef} onLayout={measure} style={StyleSheet.absoluteFill} {...panHandlers} />

      {celebrating && fx && <ClaimCelebration rarity={fx.rarity} seed={fx.key} onShake={doShake} />}

      <CommunitySheet visible={community} onClose={() => setCommunity(false)} />

      {/* HUD (2026-10-03 refresh): your picture, ONE wallet capsule for coins
          and Walk Points, and Boost on the right; the map tools in a single
          slim rail underneath instead of six loose buttons. */}
      <View style={[styles.hud, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
        <View style={styles.hudTop} pointerEvents="box-none">
          {/* Your profile and badges. */}
          <Pressable
            onPress={() => { haptics.tap(); router.push('/profile'); }}
            accessibilityLabel="Your profile"
            hitSlop={6}
            style={styles.me}
          >
            <PlayerPicture photoUrl={balance?.photoUrl} username={user?.username} size={compactHud ? 36 : 40} />
            {!!balance?.unseenBadges && (
              <View style={styles.avatarDot}>
                <Text style={styles.badgeText}>{balance.unseenBadges}</Text>
              </View>
            )}
          </Pressable>
          <View style={[styles.wallet, compactHud && styles.walletTight]}>
            <CoinIcon size={compactHud ? 18 : 22} />
            <CountUp value={balance?.coins ?? 0} style={[styles.pillValue, compactHud && styles.pillValueSm, mono]} short />
            <View style={styles.walletDivider} />
            <StepsIcon size={compactHud ? 17 : 20} />
            <CountUp value={wp} style={[styles.pillValue, compactHud && styles.pillValueSm, mono]} short />
            {/* The unit label is the first thing to go on a narrow phone. */}
            {!compactHud && <Text style={styles.pillUnit}>WP</Text>}
          </View>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => { haptics.tap(); setBoostOpen(true); }}
            style={[styles.boostBtn, boosted && chipEndsAt ? styles.boostBtnOn : null]}
            accessibilityLabel={boosted ? 'Boost active. Open power-ups' : 'Open power-ups'}
            hitSlop={6}
          >
            <BoltIcon size={boosted && chipEndsAt ? 18 : 22} color="#FFFFFF" />
            {boosted && chipEndsAt && (
              <>
                <Text style={styles.boostX}>{formatMultiplier(multiplier)}×</Text>
                <Countdown endsAt={chipEndsAt} onDone={refreshBalance} style={[styles.boostTime, mono]} short />
              </>
            )}
          </Pressable>
        </View>

        <View style={styles.rail}>
          <Pressable
            onPress={() => { haptics.tap(); setDailyOpen(true); }}
            style={styles.railBtn}
            accessibilityLabel={`Daily rewards${daily?.claimable ? `, ${daily.claimable} ready` : ''}`}
            hitSlop={2}
          >
            <ChestIcon size={26} open={!chestReady} />
            {!!daily?.claimable && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{daily.claimable}</Text>
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={() => { haptics.tap(); setCommunity(true); }}
            style={styles.railBtn}
            accessibilityLabel="Community"
            hitSlop={2}
          >
            <PeopleIcon size={24} />
          </Pressable>
          <Pressable
            onPress={toggleFinder}
            style={[styles.railBtn, finderOn && styles.railBtnOn]}
            accessibilityLabel={finderOn ? 'Hide the treasure pointer' : 'Find the nearest treasure box'}
            hitSlop={2}
          >
            <ChestIcon size={22} />
            <View style={styles.finderArrow}>
              <PointerIcon size={13} />
            </View>
          </Pressable>
          <Pressable
            onPress={() => { haptics.tap(); toggleLabels(); }}
            style={[styles.railBtn, !labelsOn && styles.railBtnOn]}
            accessibilityLabel={labelsOn ? 'Hide map labels' : 'Show map labels'}
            hitSlop={2}
          >
            <StreetSignIcon size={24} off={!labelsOn} />
          </Pressable>
          <View style={styles.railDivider} />
          <Pressable onPress={() => { haptics.tap(); faceNorth(); }} style={styles.railBtn} accessibilityLabel="Face north" hitSlop={2}>
            <CompassIcon size={26} rotation={-bearing} />
          </Pressable>
        </View>
      </View>

      {!revealed && !celebrating && (
        <View style={[styles.bottom, { bottom: tabBarSpace }]} pointerEvents="box-none">
          {finderOn && nearestBox && (
            <Pressable onPress={toggleFinder} style={styles.finderPill} accessibilityLabel="Treasure pointer. Tap to hide">
              <PointerIcon size={26} rotation={pointerRotation} />
              <Text style={[styles.finderText, mono]}>
                {nearestBox.m < 1000 ? `${Math.round(nearestBox.m)} m` : `${(nearestBox.m / 1000).toFixed(1)} km`}
              </Text>
              <Text style={styles.finderLabel}>to treasure</Text>
            </Pressable>
          )}
          {toast && (
            <View style={styles.toast}>
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          )}
          {/* Just opened a box? One ad doubles it. */}
          {boxClaim && boxClaim.canDouble && adsAvailable() && (
            <Pressable onPress={doubleBox} style={styles.boxBtn} accessibilityRole="button">
              <PlayAdIcon size={22} color={colors.claimInk} />
              <Text style={styles.boxBtnText}>
                {adBusy === 'DOUBLE' ? 'Loading ad…' : `Double it · +${boxClaim.amount} WP`}
              </Text>
            </Pressable>
          )}

          {/* A box you have reached, or the offer of another one. */}
          {reachableBox ? (
            <Pressable onPress={grabBox} style={styles.boxBtn} accessibilityRole="button">
              <ChestIcon size={24} open />
              <Text style={styles.boxBtnText}>
                {openingBox ? 'Opening…' : `Open the box · +${reachableBox.rewardWp} WP`}
              </Text>
            </Pressable>
          ) : (
            boxes.length === 0 && treasure?.nextNeedsAd && adsAvailable() && (
              <Pressable onPress={adBox} style={styles.boxAdBtn} accessibilityRole="button">
                <ChestIcon size={22} />
                <Text style={styles.boxAdText}>
                  {adBusy === 'TREASURE' ? 'Loading ad…' : 'Watch an ad for another treasure box'}
                </Text>
              </Pressable>
            )
          )}
          {awayCoins > 0 && (
            // Welcome back: show what the land earned, and offer to boost it.
            <View style={styles.away}>
              <CoinIcon size={26} />
              <View style={{ flex: 1 }}>
                <Text style={styles.awayTitle}>+{awayCoins.toLocaleString()} coins while you were away</Text>
                <Text style={styles.awaySub}>Your land kept working.</Text>
              </View>
              {balance?.rewards.boost.canAdd && adsAvailable() ? (
                <Pressable
                  onPress={() => { dismissAway(); setBoostOpen(true); }}
                  style={styles.awayBtn}
                  accessibilityRole="button"
                >
                  <BoltIcon size={16} color="#FFFFFF" />
                  <Text style={styles.awayBtnText}>Boost {formatMultiplier(balance.rewards.boost.multiplier)}x</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={dismissAway} hitSlop={10} accessibilityLabel="Dismiss" style={styles.awayClose}>
                <Text style={styles.awayCloseText}>{'\u00D7'}</Text>
              </Pressable>
            </View>
          )}
          {/* THE CLAIM CARD (2026-10-03 refresh): white, so it reads as the
              thing to act on over the busy map. Which square, how close you
              are to affording it, then the button - with the +1 WP ad right
              beside it when you are short. */}
          <View style={[styles.dock, dockMin && styles.dockMin]}>
            {/* Minimise / maximise (2026-09-27): the card folds down to the
                earnings line alone. */}
            {!dockMin && (
            <>
            <View style={styles.dockHead}>
              <View style={styles.dockWell}>
                <FlagIcon size={20} color={colors.claimDeep} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.dockTitle} numberOfLines={1}>
                  {selected && !selectedOwner && fix.accuracyM <= MAX_CLAIM_ACCURACY_M
                    ? sameCell(selected, playerCell)
                      ? 'The square you are standing on'
                      : `${pickedInReach ? 'Your pick' : 'Free square'} · ${selectedDistance} m`
                    : 'Claim land'}
                </Text>
                <Text style={styles.dockSub} numberOfLines={1}>Tap any lit square to pick another</Text>
              </View>
              <DockToggle min={false} onPress={toggleDock} />
            </View>
            <View style={styles.progressHead}>
              <Text style={styles.progressLabel}>Next parcel</Text>
              <Text style={[styles.progressValue, mono]}>{Math.min(wp, price)} / {price} WP</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${Math.min(100, (wp / Math.max(1, price)) * 100)}%` }, wp >= price && styles.trackFillReady]} />
            </View>
            <ClaimButton
              state={claimState}
              price={price}
              busy={claiming}
              onPress={claim}
              adOffer={
                claimState.kind === 'short' && adsAvailable() && (balance?.rewards.walkPoints.adsLeftToday ?? 0) > 0 &&
                (balance?.rewards.walkPoints.nextInSeconds ?? 0) === 0
                  ? {
                      label: `+${balance?.rewards.walkPoints.perAd ?? 1} WP`,
                      busy: adBusy === 'WALK_POINTS',
                      onPress: async () => {
                        const r = await watch('WALK_POINTS');
                        showToast(r.ok ? `+${r.amount} Walk Points!` : r.message);
                      },
                    }
                  : null
              }
            />
            </>
            )}
            <View style={styles.earnings}>
              <CoinIcon size={16} />
              <Text style={[styles.earnValue, mono]}>{formatRate(perMonth)}</Text>
              <Text style={styles.earnUnit}>coins / month</Text>
              <View style={{ flex: 1 }} />
              {boosted && (
                <View style={styles.xBadge}>
                  <Text style={styles.xBadgeText}>{formatMultiplier(multiplier)}×</Text>
                </View>
              )}
              <Text style={[styles.earnRate, mono, boosted && { color: colors.boostDeep }]}>+{perDay < 1 ? perDay.toFixed(2) : perDay < 10 ? perDay.toFixed(1) : Math.round(perDay)}/day</Text>
              {dockMin && <DockToggle min onPress={toggleDock} />}
            </View>
          </View>
        </View>
      )}

      <RevealSheet parcel={revealed} onClose={closeReveal} />
      <BoostSheet visible={boostOpen} onClose={() => setBoostOpen(false)} />
      <DailySheet
        visible={dailyOpen}
        onClose={() => setDailyOpen(false)}
        position={{ lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, mocked: fix.mocked }}
      />
      <DoorbellSheet
        parcelId={doorbell}
        position={{ lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, mocked: fix.mocked }}
        onClose={() => setDoorbell(null)}
        onCollected={refreshBalance}
      />
    </Animated.View>
  );
}

const EMPTY: Cell[] = [];
const EMPTY_BOXES: TreasureBox[] = [];

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

const DOCK_MIN_KEY = 'fareground.dockMinimised';

/** The round minimise / maximise button on the bottom panel. */
function DockToggle({ min, onPress }: { min: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.dockToggle, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={min ? 'Show the claim panel' : 'Minimise the claim panel'}
    >
      <ChevronIcon size={16} color={colors.ink2} up={min} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dockToggle: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.sunk, marginLeft: 6,
  },
  root: { flex: 1, backgroundColor: colors.bg },

  hud: {
    position: 'absolute', left: 0, right: 0, top: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: space.md,
  },
  // flexShrink + minWidth:0 let the left group give way on a narrow phone
  // instead of pushing the boost chip off the right edge. Without minWidth a
  // flex row refuses to shrink below its content on React Native.
  hudTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  me: { borderRadius: 24, borderWidth: 2, borderColor: colors.claim },
  // Coins | WP in one capsule. flexShrink + minWidth:0 let it give way on a
  // narrow phone instead of pushing Boost off the edge.
  wallet: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, flexShrink: 1, minWidth: 0,
    backgroundColor: colors.glass, borderColor: colors.glassLine, borderWidth: 1,
    borderRadius: radius.pill, paddingLeft: 10, paddingRight: 14,
  },
  walletTight: { height: 38, paddingLeft: 8, paddingRight: 10, gap: 5 },
  walletDivider: { width: 1, height: 22, backgroundColor: colors.glassLine, marginHorizontal: 4 },
  // Boost: violet, so the one paid-for-by-ads power-up is easy to find.
  boostBtn: {
    minWidth: 44, height: 44, borderRadius: 22, paddingHorizontal: 11, flexDirection: 'row', gap: 5,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.boost,
    borderWidth: 1, borderColor: colors.boostHi,
  },
  boostBtnOn: { paddingHorizontal: 13, backgroundColor: colors.boostDeep },
  // The map tools, stacked in one glass rail.
  rail: {
    alignSelf: 'flex-end', marginTop: space.sm, padding: 4, gap: 2, borderRadius: 26,
    backgroundColor: colors.glass, borderColor: colors.glassLine, borderWidth: 1,
  },
  railBtn: { width: TOUCH - 2, height: TOUCH - 2, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  // A tool that is switched ON (labels hidden, finder showing).
  railBtnOn: { backgroundColor: 'rgba(242,169,59,0.25)' },
  railDivider: { height: 1, marginHorizontal: 8, marginVertical: 2, backgroundColor: colors.glassLine },
  finderArrow: { position: 'absolute', top: 5, right: 5 },
  finderPill: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 44, paddingHorizontal: 16, borderRadius: radius.pill,
    backgroundColor: colors.glass, borderColor: colors.claim, borderWidth: 1,
  },
  finderText: { color: colors.glassInk, fontFamily: fonts.heavy, fontSize: 17, includeFontPadding: false },
  finderLabel: { color: colors.glassInk2, fontFamily: fonts.bold, fontSize: 13, includeFontPadding: false },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, height: 42,
    backgroundColor: colors.glass, borderColor: colors.glassLine, borderWidth: 1,
    borderRadius: radius.pill, paddingLeft: 9, paddingRight: 14,
    flexShrink: 1, minWidth: 0,
  },
  pillValue: { color: colors.glassInk, fontSize: 16, fontFamily: fonts.heavy, includeFontPadding: false },
  // The compact set, for phones under 400pt. Same shapes, less of them.
  pillTight: { height: 36, paddingLeft: 7, paddingRight: 10, gap: 5 },
  pillValueSm: { fontSize: 14 },
  pillUnit: { color: colors.glassInk2, fontSize: 11, fontFamily: fonts.bold, marginLeft: -3, includeFontPadding: false },
  hudRight: { alignItems: 'flex-end', gap: space.sm, flexShrink: 0 },
  boostChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: 13,
    backgroundColor: colors.glass, borderColor: colors.glassLine, borderWidth: 1, borderRadius: radius.pill,
  },
  boostChipOn: { backgroundColor: colors.boost, borderColor: colors.boostHi },
  boostLabel: { color: colors.glassInk, fontFamily: fonts.heavy, fontSize: 14, includeFontPadding: false },
  boostX: { color: '#FFFFFF', fontFamily: fonts.black, fontSize: 15, includeFontPadding: false },
  boostTime: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 13, includeFontPadding: false },
  compass: {
    width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.glass, borderColor: colors.glassLine, borderWidth: 1,
  },

  bottom: { position: 'absolute', left: space.md, right: space.md, gap: space.sm },
  badge: {
    position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.glass,
  },
  badgeText: { color: '#FFFFFF', fontFamily: fonts.black, fontSize: 11, includeFontPadding: false },
  avatarDot: {
    position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.glass,
  },
  away: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
    backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line,
  },
  awayTitle: { fontFamily: fonts.heavy, fontSize: 14, color: colors.ink, includeFontPadding: false },
  awaySub: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink3, marginTop: 2, includeFontPadding: false },
  awayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12,
    borderRadius: radius.pill, backgroundColor: colors.boost,
  },
  awayBtnText: { color: '#FFFFFF', fontFamily: fonts.heavy, fontSize: 13, includeFontPadding: false },
  awayClose: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  awayCloseText: { fontFamily: fonts.bold, fontSize: 22, color: colors.ink3, includeFontPadding: false },
  boxBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 54,
    borderRadius: radius.lg, backgroundColor: colors.claim, borderBottomWidth: 4, borderBottomColor: colors.claimDeep,
  },
  boxBtnText: { color: colors.claimInk, fontFamily: fonts.black, fontSize: 16, includeFontPadding: false },
  boxAdBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 46,
    borderRadius: radius.md, backgroundColor: colors.glass, borderColor: colors.glassLine, borderWidth: 1,
  },
  boxAdText: { color: colors.glassInk, fontFamily: fonts.bold, fontSize: 13.5, includeFontPadding: false },
  dock: {
    backgroundColor: colors.card, borderRadius: radius.xl, padding: space.md + 2, gap: space.sm + 2,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  dockMin: { paddingVertical: space.sm + 2 },
  dockHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dockWell: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#FFF3DC', alignItems: 'center', justifyContent: 'center' },
  dockTitle: { fontFamily: fonts.black, fontSize: 16, color: colors.ink, includeFontPadding: false },
  dockSub: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.ink3, marginTop: 2, includeFontPadding: false },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  progressLabel: { fontFamily: fonts.bold, fontSize: 12.5, color: colors.ink3, includeFontPadding: false },
  progressValue: { fontFamily: fonts.black, fontSize: 13, color: colors.ink, includeFontPadding: false },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.sunk, overflow: 'hidden', marginTop: -4 },
  trackFill: { height: '100%', borderRadius: 5, backgroundColor: colors.steps },
  trackFillReady: { backgroundColor: colors.claim },
  toast: {
    backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: space.lg,
    borderWidth: 1, borderColor: colors.glassLine,
  },
  toastText: { fontFamily: fonts.bold, fontSize: 14, color: '#FFFFFF', lineHeight: 19 },
  earnings: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  earnValue: { color: colors.ink, fontSize: 14, fontFamily: fonts.heavy, includeFontPadding: false },
  earnUnit: { color: colors.ink3, fontSize: 12, fontFamily: fonts.medium, includeFontPadding: false },
  earnRate: { color: colors.goodInk, fontSize: 13.5, fontFamily: fonts.heavy, includeFontPadding: false },
  xBadge: { backgroundColor: colors.boost, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  xBadgeText: { color: '#FFFFFF', fontFamily: fonts.black, fontSize: 11, includeFontPadding: false },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14, backgroundColor: colors.bg },
  centeredTitle: { ...type.title, fontSize: 20, textAlign: 'center' },
  centeredBody: { ...type.body, textAlign: 'center' },
});
