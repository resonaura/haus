/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MobileHomeItem } from './mobile-dashboard.js';

export const HomeDeviceRow = memo(function HomeDeviceRow({
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

const styles = StyleSheet.create({
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
  textLight: { color: '#f5f5f7' },
  textDark: { color: '#1d1d1f' },
  secondaryDark: { color: '#a1a1a6' },
  secondaryLight: { color: '#6e6e73' },
});
