/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { HassEntity, Snapshot } from '@haus/core/types';
import { discoverHaOAuth, signInToHomeAssistant } from '../auth/home-assistant-oauth';
import { openMobileHome, type MobileHomeRuntime } from '../home/mobile-home';
import {
  createLocalHomeDiscovery,
  type LocalDiscoveryTask,
  type LocalHomeCandidate,
} from '../discovery/local-home-discovery';
import { mobilePersistence } from '../storage/native-persistence';
import type { HaSession } from '../storage/mobile-persistence';

interface HomeSection {
  title: string;
  data: HassEntity[];
}

function homeSections(snapshot: Snapshot | null): HomeSection[] {
  if (!snapshot) return [];
  const areas = new Map(snapshot.areas.map((area) => [area.area_id, area.name]));
  const devices = new Map(snapshot.devices.map((device) => [device.id, device]));
  const registry = new Map(snapshot.entities.map((entity) => [entity.entity_id, entity]));
  const groups = new Map<string, HassEntity[]>();
  for (const entity of snapshot.states) {
    const entry = registry.get(entity.entity_id);
    const areaId =
      entry?.area_id ?? (entry?.device_id ? devices.get(entry.device_id)?.area_id : null);
    const room = areaId ? areas.get(areaId) : undefined;
    const title = room ?? 'Home';
    groups.set(title, [...(groups.get(title) ?? []), entity]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([title, data]) => ({
      title,
      data: data.sort((left, right) =>
        String(left.attributes.friendly_name ?? left.entity_id).localeCompare(
          String(right.attributes.friendly_name ?? right.entity_id),
        ),
      ),
    }));
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Could not connect to Home Assistant.';
}

export default function Home() {
  const dark = useColorScheme() !== 'light';
  const palette = dark ? styles.dark : styles.light;
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
  const [connection, setConnection] = useState('disconnected');
  const [error, setError] = useState<string | null>(null);
  const sections = useMemo(() => homeSections(snapshot), [snapshot]);

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
    update();
    unsubscribeRef.current = runtime.store.subscribe((state) => state, update);
  };

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
        <View style={styles.homeHeader}>
          <View style={styles.headingGroup}>
            <Text style={[styles.title, titleColor]}>{snapshot.config.location_name}</Text>
            <Text style={[styles.status, secondaryColor]}>{status}</Text>
          </View>
          <View style={styles.headerActions}>
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
          sections={sections}
          keyExtractor={(item) => item.entity_id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionTitle, secondaryColor]}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <View style={[styles.entityRow, dark ? styles.rowDark : styles.rowLight]}>
              <View style={styles.entityLabel}>
                <Text style={[styles.entityName, titleColor]} numberOfLines={1}>
                  {String(item.attributes.friendly_name ?? item.entity_id)}
                </Text>
                <Text style={[styles.entityId, secondaryColor]} numberOfLines={1}>
                  {item.entity_id}
                </Text>
              </View>
              <Text style={[styles.entityState, titleColor]} numberOfLines={1}>
                {item.state}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={[styles.empty, secondaryColor]}>No entities are available yet.</Text>
          }
        />
        {error ? <Text style={[styles.inlineError, styles.errorText]}>{error}</Text> : null}
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
