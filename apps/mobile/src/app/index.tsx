/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Snapshot } from '@haus/ha/types';
import { defaults, type Preferences } from '@haus/ha/view/preferences';
import { discoverHaOAuth, signInToHomeAssistant } from '../auth/home-assistant-oauth';
import { openMobileHome, type MobileHomeRuntime } from '../home/mobile-home';
import {
  createMobileDashboardProjection,
  type MobileDestination,
  type MobileHomeItem,
} from '../home/mobile-dashboard';
import {
  createLocalHomeDiscovery,
  type LocalDiscoveryTask,
  type LocalHomeCandidate,
} from '../discovery/local-home-discovery';
import { mobilePersistence } from '../storage/native-persistence';
import type { HaSession } from '../storage/mobile-persistence';

const HomeDeviceRow = memo(function HomeDeviceRow({
  item,
  dark,
}: {
  item: MobileHomeItem;
  dark: boolean;
}) {
  return (
    <View style={[styles.entityRow, dark ? styles.rowDark : styles.rowLight]}>
      <View style={styles.entityLabel}>
        <Text
          style={[styles.entityName, dark ? styles.textLight : styles.textDark]}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        <Text
          style={[styles.entityId, dark ? styles.secondaryDark : styles.secondaryLight]}
          numberOfLines={1}
        >
          {item.category}
        </Text>
      </View>
      <Text
        style={[styles.entityState, dark ? styles.textLight : styles.textDark]}
        numberOfLines={2}
      >
        {item.state}
      </Text>
    </View>
  );
});

function safeError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Could not connect to Home Assistant.';
}

const destinations = [
  { id: 'home', label: 'Home' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'scenes', label: 'Scenes' },
] as const;

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
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const discoveryRef = useRef<LocalDiscoveryTask | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredHomes, setDiscoveredHomes] = useState<LocalHomeCandidate[]>([]);
  const [discoveryFinished, setDiscoveryFinished] = useState(false);
  const [url, setUrl] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const projectDashboard = useMemo(createMobileDashboardProjection, []);
  const [connection, setConnection] = useState('disconnected');
  const [error, setError] = useState<string | null>(null);
  const sections = useMemo(
    () => projectDashboard(snapshot, preferences, destination, roomId),
    [snapshot, preferences, projectDashboard, destination, roomId],
  );
  const dark =
    preferences.theme === 'system' ? colorScheme !== 'light' : preferences.theme === 'dark';
  const palette = dark ? styles.dark : styles.light;

  const bindRuntime = (runtime: MobileHomeRuntime) => {
    unsubscribeRef.current?.();
    runtimeRef.current?.dispose();
    runtimeRef.current = runtime;
    sessionRef.current = runtime.session;
    const update = () => {
      const state = runtime.store.getState();
      setSnapshot(state.snapshot);
      setConnection(state.connection);
    };
    const updatePreferences = () => setPreferences(runtime.preferences);
    update();
    updatePreferences();
    runtime.setActive(AppState.currentState === 'active');
    const stopSnapshot = runtime.store.subscribe((state) => state.snapshot, update);
    const stopConnection = runtime.store.subscribe((state) => state.connection, update);
    const stopPreferences = runtime.subscribePreferences(updatePreferences);
    unsubscribeRef.current = () => {
      stopSnapshot();
      stopConnection();
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

  const connect = async () => {
    discoveryRef.current?.cancel();
    discoveryRef.current = null;
    setDiscovering(false);
    setBusy(true);
    setError(null);
    try {
      const discovered = await discoverHaOAuth(url);
      const nextSession = await signInToHomeAssistant(discovered, (request) =>
        request.promptAsync({ authorizationEndpoint: discovered.metadata.authorizationEndpoint }),
      );
      await mobilePersistence.saveSession(nextSession);
      sessionRef.current = nextSession;
      const runtime = await openMobileHome(nextSession, (updated) => {
        sessionRef.current = updated;
      });
      bindRuntime(runtime);
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const findHome = async () => {
    discoveryRef.current?.cancel();
    const task = createLocalHomeDiscovery();
    discoveryRef.current = task;
    setDiscovering(true);
    setDiscoveredHomes([]);
    setDiscoveryFinished(false);
    setError(null);
    try {
      const outcome = await task.result;
      if (discoveryRef.current !== task) return;
      setDiscoveredHomes(outcome.servers);
      setDiscoveryFinished(outcome.status === 'complete');
      if (outcome.status === 'permission-denied')
        setError(
          'Allow local network access in Settings, or enter the Home Assistant URL manually.',
        );
      else if (outcome.status === 'unavailable')
        setError(
          'Local discovery is unavailable in this build. Enter the Home Assistant URL manually.',
        );
    } finally {
      if (discoveryRef.current === task) {
        discoveryRef.current = null;
        setDiscovering(false);
      }
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
      else await mobilePersistence.clearSession();
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
    const status =
      connection === 'connected'
        ? 'Connected'
        : connection === 'reconnecting' || connection === 'connecting'
          ? 'Reconnecting'
          : connection === 'auth-required'
            ? 'Sign in again to reconnect'
            : 'Home Assistant is offline';
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
            extraData={dark}
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
                <HomeDeviceRow item={item} dark={dark} />
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
      <View style={styles.signInContent}>
        <View style={styles.brandMark}>
          <Image
            accessibilityLabel="Haus"
            source={require('../../assets/icon.png')}
            style={styles.brandIcon}
          />
        </View>
        <Text style={[styles.title, titleColor]}>Your home</Text>
        <Text style={[styles.message, secondaryColor]}>
          Connect to Home Assistant to see your rooms and devices.
        </Text>
        <TextInput
          accessibilityLabel="Home Assistant URL"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setUrl}
          onFocus={() => setDiscoveryFinished(false)}
          placeholder="http://homeassistant.local:8123"
          placeholderTextColor={dark ? '#77777c' : '#8a8a8e'}
          returnKeyType="go"
          onSubmitEditing={() => void connect()}
          style={[styles.urlInput, dark ? styles.inputDark : styles.inputLight, titleColor]}
          value={url}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy || discovering}
          onPress={() => void findHome()}
          style={[styles.discoveryButton, { opacity: busy ? 0.55 : 1 }]}
        >
          {discovering ? (
            <ActivityIndicator color={dark ? '#a1a1a6' : '#6e6e73'} size="small" />
          ) : null}
          <Text style={[styles.discoveryButtonLabel, secondaryColor]}>
            {discovering ? 'Looking for Home Assistant…' : 'Find on local network'}
          </Text>
        </Pressable>
        {discoveredHomes.map((home) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Use ${home.name} at ${home.host}`}
            key={home.id}
            onPress={() => {
              setUrl(home.url);
              setDiscoveredHomes([]);
              setDiscoveryFinished(false);
              setError(null);
            }}
            style={[styles.discoveredHome, dark ? styles.rowDark : styles.rowLight]}
          >
            <Text style={[styles.discoveredHomeName, titleColor]} numberOfLines={1}>
              {home.name}
            </Text>
            <Text style={[styles.discoveredHomeAddress, secondaryColor]} numberOfLines={1}>
              {home.host}:{home.port}
            </Text>
          </Pressable>
        ))}
        {discoveryFinished && discoveredHomes.length === 0 ? (
          <Text style={[styles.discoveryEmpty, secondaryColor]}>
            No Home Assistant found. You can enter its URL above.
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy || !url.trim()}
          onPress={() => void connect()}
          style={[
            styles.button,
            dark ? styles.buttonDark : styles.buttonLight,
            styles.connectButton,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={dark ? '#f5f5f7' : '#1d1d1f'} />
          ) : (
            <Text style={[styles.buttonLabel, titleColor]}>Connect Home Assistant</Text>
          )}
        </Pressable>
        {error ? <Text style={[styles.inlineError, styles.errorText]}>{error}</Text> : null}
        <Text style={[styles.privacy, secondaryColor]}>
          Sign-in opens Home Assistant in your browser. Haus never asks for your password.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  dashboard: { flex: 1, width: '100%', maxWidth: 860, alignSelf: 'center' },
  stackedHeader: { alignItems: 'stretch', flexDirection: 'column', gap: 6 },
  bottomNavigation: {
    flexDirection: 'row',
    gap: 6,
    padding: 8,
    marginHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navBorderDark: { borderColor: 'rgba(255,255,255,0.2)' },
  navBorderLight: { borderColor: 'rgba(0,0,0,0.2)' },
  navigationItem: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  navigationLabel: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  pressed: { opacity: 0.72 },
  dark: { backgroundColor: '#000' },
  light: { backgroundColor: '#f5f5f7' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  signInContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    maxWidth: 620,
    alignSelf: 'center',
    width: '100%',
  },
  brandMark: {
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
    backgroundColor: 'rgba(127,127,132,0.14)',
  },
  brandIcon: { width: 48, height: 48, borderRadius: 16 },
  title: { fontSize: 34, fontWeight: '600', letterSpacing: -0.8 },
  message: { marginTop: 10, fontSize: 17, lineHeight: 24, maxWidth: 420 },
  urlInput: {
    height: 54,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 28,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  discoveryButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 4,
  },
  discoveryButtonLabel: { fontSize: 14, fontWeight: '500' },
  discoveredHome: {
    minHeight: 58,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  discoveredHomeName: { fontSize: 15, fontWeight: '600' },
  discoveredHomeAddress: { fontSize: 12, marginTop: 3 },
  discoveryEmpty: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 4 },
  inputDark: { borderColor: 'rgba(255,255,255,0.16)', backgroundColor: '#151516' },
  inputLight: { borderColor: 'rgba(0,0,0,0.14)', backgroundColor: '#fff' },
  button: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDark: { backgroundColor: '#29292b' },
  buttonLight: { backgroundColor: '#e3e3e8' },
  connectButton: { marginTop: 12 },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  privacy: { fontSize: 13, lineHeight: 19, marginTop: 20, textAlign: 'center' },
  inlineError: { marginTop: 14, fontSize: 14, lineHeight: 20 },
  errorText: { color: '#ff453a' },
  textLight: { color: '#f5f5f7' },
  textDark: { color: '#1d1d1f' },
  secondaryDark: { color: '#a1a1a6' },
  secondaryLight: { color: '#6e6e73' },
  homeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 16,
  },
  headingGroup: { flex: 1, minWidth: 0 },
  status: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  textButton: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 4 },
  textButtonLabel: { fontSize: 14, fontWeight: '500' },
  listContent: { paddingHorizontal: 20, paddingBottom: 28 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
    paddingHorizontal: 2,
    paddingTop: 18,
    paddingBottom: 8,
  },
  entityRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    gap: 12,
    borderRadius: 16,
    marginBottom: 8,
  },
  rowDark: { backgroundColor: '#151516' },
  rowLight: { backgroundColor: '#fff' },
  entityLabel: { flex: 1, minWidth: 0 },
  entityName: { fontSize: 16, fontWeight: '500' },
  entityId: { fontSize: 12, marginTop: 4 },
  entityState: { fontSize: 14, maxWidth: 130 },
  empty: { paddingHorizontal: 4, paddingTop: 14, fontSize: 15 },
});
