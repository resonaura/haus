/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  LayoutAnimation,
  Pressable,
  ScrollView,
  SectionList,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { HausAction, Snapshot } from '@haus/ha/types';
import { defaults, type Preferences } from '@haus/core/preferences';
import { ConnectHomePanel, type DiscoveredHomeServer } from '@haus/ui/components';
import { REACT_NATIVE_CONTENT_HOST } from '@haus/ui/native';
import { HausUiProvider } from '@haus/ui/primitives';
import { discoverHaOAuth, signInToHomeAssistant } from '../auth/home-assistant-oauth';
import { MOBILE_HUB_PAIRING_REQUIRED, MobileHubSessionManager } from '../auth/hub-session';
import { openMobileHubHome } from '../home/hub-home';
import { openMobileHome, type MobileHomeRuntime } from '../home/mobile-home';
import {
  MOBILE_DESTINATIONS as destinations,
  createMobileDashboardProjection,
  mobileConnectionStatus,
  mobileDashboardSignature,
  safeMobileError as safeError,
  type MobileDestination,
} from '../home/mobile-dashboard';
import { HomeDeviceRow } from '../home/device';
import { homeScreenStyles as styles } from '../home/screen-styles';
import {
  createLocalHomeDiscovery,
  type LocalDiscoveryTask,
  type LocalHomeCandidate,
} from '../discovery/local-home-discovery';
import { mobilePersistence } from '../storage/native-persistence';
import type { HaSession } from '../storage/mobile-persistence';

export default function Home() {
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string; room?: string }>();
  const destination: MobileDestination =
    params.view === 'rooms' || params.view === 'scenes' ? params.view : 'home';
  const roomId =
    destination === 'rooms' && typeof params.room === 'string'
      ? params.room || undefined
      : undefined;
  const { width, fontScale } = useWindowDimensions();
  const stackedHeader = width < 420 || fontScale > 1.3;
  const navigate = (view: MobileDestination, room = '') => router.setParams({ view, room });
  const colorScheme = useColorScheme();
  const runtimeRef = useRef<MobileHomeRuntime | null>(null);
  const sessionRef = useRef<HaSession | null>(null);
  const hubManagerRef = useRef<MobileHubSessionManager | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const discoveryRef = useRef<LocalDiscoveryTask | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredHomes, setDiscoveredHomes] = useState<LocalHomeCandidate[]>([]);
  const [explicitHa, setExplicitHa] = useState(false);
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [selectedClusterUrls, setSelectedClusterUrls] = useState<readonly string[] | undefined>();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const projectDashboard = useMemo(createMobileDashboardProjection, []);
  const [connection, setConnection] = useState('disconnected');
  const [error, setError] = useState<string | null>(null);
  const triggerActions = useCallback((actions: readonly HausAction[]) => {
    const active = runtimeRef.current;
    if (!active || !actions.length) return;
    setError(null);
    active.store.getState().clearCommandNotice();
    void active.store
      .getState()
      .executeBatch(actions)
      .catch(() => {
        setError('The command could not be confirmed. Check the device before trying again.');
      });
  }, []);
  const sections = useMemo(
    () => projectDashboard(snapshot, preferences, destination, roomId),
    [snapshot, preferences, projectDashboard, destination, roomId],
  );
  const layoutKey = `${destination}:${roomId ?? ''}`;
  const signature = useMemo(() => mobileDashboardSignature(sections), [sections]);
  const prevLayoutRef = useRef({ key: layoutKey, sig: signature });
  useLayoutEffect(() => {
    const prev = prevLayoutRef.current;
    if (prev.key === layoutKey && prev.sig && signature && prev.sig !== signature) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    prevLayoutRef.current = { key: layoutKey, sig: signature };
  }, [layoutKey, signature]);
  const dark =
    preferences.theme === 'system' ? colorScheme !== 'light' : preferences.theme === 'dark';
  const palette = dark ? styles.dark : styles.light;

  const getHubManager = () => {
    hubManagerRef.current ??= new MobileHubSessionManager({ storage: mobilePersistence });
    return hubManagerRef.current;
  };

  const bindRuntime = (runtime: MobileHomeRuntime) => {
    unsubscribeRef.current?.();
    runtimeRef.current?.dispose();
    runtimeRef.current = runtime;
    sessionRef.current = runtime.session;
    const update = () => {
      const state = runtime.store.getState();
      setSnapshot(state.snapshot);
      setConnection(state.connection);
      if (state.commandNotice) setError(state.commandNotice);
    };
    const updatePreferences = () => setPreferences(runtime.preferences);
    update();
    updatePreferences();
    runtime.setActive(AppState.currentState === 'active');
    const stopSnapshot = runtime.store.subscribe((state) => state.snapshot, update);
    const stopConnection = runtime.store.subscribe((state) => state.connection, update);
    const stopNotice = runtime.store.subscribe((state) => state.commandNotice, update);
    const stopPreferences = runtime.subscribePreferences(updatePreferences);
    unsubscribeRef.current = () => {
      stopSnapshot();
      stopConnection();
      stopNotice();
      stopPreferences();
    };
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      runtimeRef.current?.setActive(state === 'active'),
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const hubManager = getHubManager();
        const hubSession = await hubManager.resume();
        if (cancelled) return;
        if (hubSession) {
          const runtime = await openMobileHubHome(hubManager);
          if (cancelled) runtime.dispose();
          else bindRuntime(runtime);
          return;
        }
        const saved = await mobilePersistence.loadSession();
        if (cancelled) return;
        if (saved) {
          sessionRef.current = saved;
          setUrl(saved.url);
          const runtime = await openMobileHome(saved, (updated) => {
            if (!cancelled) sessionRef.current = updated;
          });
          if (cancelled) runtime.dispose();
          else bindRuntime(runtime);
        }
      } catch (caught) {
        if (!cancelled) setError(safeError(caught));
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
      runtimeRef.current?.dispose();
      discoveryRef.current?.cancel();
      discoveryRef.current = null;
      unsubscribeRef.current = null;
      runtimeRef.current = null;
    };
  }, []);

  const findHome = async (targetExplicitHa = explicitHa) => {
    discoveryRef.current?.cancel();
    const task = createLocalHomeDiscovery({ explicitHa: targetExplicitHa });
    discoveryRef.current = task;
    setDiscovering(true);
    setDiscoveredHomes([]);
    setError(null);
    try {
      const outcome = await task.result;
      if (discoveryRef.current !== task) return;
      setDiscoveredHomes(outcome.servers);
      if (outcome.status === 'permission-denied')
        setError(
          targetExplicitHa
            ? 'Allow local network access in Settings, or enter the Home Assistant URL manually.'
            : 'Allow local network access in Settings, or enter your Haus Hub URL manually.',
        );
      else if (outcome.status === 'unavailable')
        setError(
          targetExplicitHa
            ? 'Local discovery is unavailable in this build. Enter the Home Assistant URL manually.'
            : 'Local discovery is unavailable in this build. Enter your Haus Hub URL manually.',
        );
    } finally {
      if (discoveryRef.current === task) {
        discoveryRef.current = null;
        setDiscovering(false);
      }
    }
  };

  const submitConnect = async (targetAddress: string, selected?: DiscoveredHomeServer) => {
    const clean = targetAddress.trim();
    if (!clean) return;
    discoveryRef.current?.cancel();
    discoveryRef.current = null;
    setDiscovering(false);
    setBusy(true);
    setError(null);
    try {
      if (explicitHa) {
        const discovered = await discoverHaOAuth(clean);
        const nextSession = await signInToHomeAssistant(discovered, (request) =>
          request.promptAsync({
            authorizationEndpoint: discovered.metadata.authorizationEndpoint,
          }),
        );
        await mobilePersistence.saveSession(nextSession);
        sessionRef.current = nextSession;
        const runtime = await openMobileHome(nextSession, (updated) => {
          sessionRef.current = updated;
        });
        bindRuntime(runtime);
        return;
      }

      const memberUrls = selected?.memberUrls ?? selectedClusterUrls;
      if (selected?.memberUrls) setSelectedClusterUrls(selected.memberUrls);
      const hubManager = getHubManager();
      const paired = await hubManager.pairWithHub(
        pairingUrl ?? clean,
        pairingUrl ? code.trim() : undefined,
        memberUrls,
      );
      setPairingUrl(null);
      setCode('');
      const runtime = await openMobileHubHome(hubManager, selected?.name ?? paired.hubName);
      bindRuntime(runtime);
    } catch (caught) {
      if (caught instanceof Error && caught.message === MOBILE_HUB_PAIRING_REQUIRED) {
        setUrl(clean);
        setPairingUrl(clean);
        return;
      }
      setPairingUrl(null);
      setCode('');
      setError(safeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const reconnect = async () => {
    setError(null);
    try {
      await runtimeRef.current?.reconnect();
    } catch (caught) {
      setError(safeError(caught));
    }
  };

  const signOut = async () => {
    setBusy(true);
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setSnapshot(null);
    navigate('home');
    setPreferences(defaults);
    sessionRef.current = null;
    setConnection('disconnected');
    try {
      if (runtime) await runtime.logout();
      else {
        await mobilePersistence.clearSession();
        await mobilePersistence.clearHubSession();
      }
      setError(null);
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const titleColor = dark ? styles.textLight : styles.textDark;
  const secondaryColor = dark ? styles.secondaryDark : styles.secondaryLight;

  if (booting) {
    return (
      <SafeAreaView style={[styles.screen, palette]}>
        <View style={styles.loading}>
          <ActivityIndicator color={dark ? '#f5f5f7' : '#1d1d1f'} />
        </View>
      </SafeAreaView>
    );
  }

  if (snapshot) {
    const status = mobileConnectionStatus(connection);
    return (
      <SafeAreaView style={[styles.screen, palette]}>
        <View style={styles.dashboard}>
          <View style={[styles.homeHeader, stackedHeader && styles.stackedHeader]}>
            <View style={styles.headingGroup}>
              <Text accessibilityRole="header" style={[styles.title, titleColor]}>
                {destination === 'home'
                  ? snapshot.config.location_name
                  : destination === 'rooms'
                    ? (roomId && sections.find((section) => section.key === roomId)?.title) ||
                      'Rooms'
                    : 'Scenes'}
              </Text>
              <Text style={[styles.status, secondaryColor]}>{status}</Text>
            </View>
            <View style={styles.headerActions}>
              {roomId && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigate('rooms')}
                  style={styles.textButton}
                >
                  <Text style={[styles.textButtonLabel, titleColor]}>All rooms</Text>
                </Pressable>
              )}
              {connection !== 'connected' && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void reconnect()}
                  style={[styles.button, dark ? styles.buttonDark : styles.buttonLight]}
                >
                  <Text style={[styles.buttonLabel, titleColor]}>Retry</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void signOut()}
                style={styles.textButton}
              >
                <Text style={[styles.textButtonLabel, secondaryColor]}>Sign out</Text>
              </Pressable>
            </View>
          </View>
          <SectionList
            key={`${destination}:${roomId ?? ''}`}
            sections={sections}
            keyExtractor={(item) => item.id}
            extraData={`${dark}:${connection === 'connected'}`}
            initialNumToRender={12}
            windowSize={7}
            maxToRenderPerBatch={12}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={styles.listContent}
            renderSectionHeader={({ section }) => (
              <Text accessibilityRole="header" style={[styles.sectionTitle, secondaryColor]}>
                {section.title}
              </Text>
            )}
            renderItem={({ item }) =>
              item.kind === 'room' ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigate('rooms', item.id)}
                  style={({ pressed }) => [
                    styles.entityRow,
                    dark ? styles.rowDark : styles.rowLight,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.entityName, styles.entityLabel, titleColor]}>
                    {item.name}
                  </Text>
                  <Text accessible={false} style={secondaryColor}>
                    ›
                  </Text>
                </Pressable>
              ) : (
                <HomeDeviceRow
                  item={item}
                  dark={dark}
                  disabled={connection !== 'connected'}
                  onTriggerActions={triggerActions}
                />
              )
            }
            ListEmptyComponent={
              <Text style={[styles.empty, secondaryColor]}>
                {roomId
                  ? 'No visible devices or scenes in this room.'
                  : destination === 'scenes'
                    ? 'No visible scenes.'
                    : destination === 'rooms'
                      ? 'No visible rooms.'
                      : 'No devices are visible on Home yet.'}
              </Text>
            }
          />
          {error ? <Text style={[styles.inlineError, styles.errorText]}>{error}</Text> : null}
          <View
            style={[styles.bottomNavigation, dark ? styles.navBorderDark : styles.navBorderLight]}
          >
            {destinations.map(({ id, label }) => (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityState={{ selected: destination === id }}
                accessibilityHint={
                  id === 'rooms' && roomId ? 'Returns to the room list' : undefined
                }
                onPress={() => navigate(id)}
                style={({ pressed }) => [
                  styles.navigationItem,
                  destination === id && (dark ? styles.buttonDark : styles.buttonLight),
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.navigationLabel, destination === id ? titleColor : secondaryColor]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, palette]}>
      <ScrollView contentContainerStyle={styles.signInScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.signInContent}>
          <View style={styles.brandMark}>
            <Image
              accessibilityLabel="Haus"
              source={require('../../assets/icon.png')}
              style={styles.brandIcon}
            />
          </View>
          <HausUiProvider contentHost={REACT_NATIVE_CONTENT_HOST} mode={dark ? 'dark' : 'light'}>
            <ConnectHomePanel
              servers={discoveredHomes}
              scanning={discovering}
              pending={busy}
              explicitHa={explicitHa}
              url={url}
              code={code}
              pairingUrl={pairingUrl}
              error={error}
              onUrlChange={setUrl}
              onCodeChange={setCode}
              onSubmit={(addr, selected) => void submitConnect(addr, selected)}
              onScan={() => void findHome(explicitHa)}
              onCancelPairing={() => {
                getHubManager().cancelPairing();
                setPairingUrl(null);
                setCode('');
                setError(null);
              }}
              onToggleExplicitHa={(next) => {
                setExplicitHa(next);
                setDiscoveredHomes([]);
                setUrl('');
                setPairingUrl(null);
                setCode('');
                setError(null);
              }}
            />
          </HausUiProvider>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
