/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, Heading, Pressable, Text } from '@haus/ui';
import { diskSpace } from './disk-space';
import { bytes } from './presentation';
import type { ServerDisk } from './types';

export function DiskSpaceBar({
  disk,
  disks,
  onSelect,
}: {
  disk: ServerDisk;
  disks: ServerDisk[];
  onSelect: (id: string) => void;
}) {
  const space = diskSpace(disk, disks);
  return (
    <Box semantic="section" className="server-disk-space" ariaLabel={space.title}>
      <Box className="server-disk-space-heading">
        <Heading level={5}>{space.title}</Heading>
        <Text>{bytes(space.totalBytes)}</Text>
      </Box>
      <Box className="server-disk-bar" role="group" ariaLabel={space.title}>
        {space.proportional &&
          space.segments.map((segment, index) => {
            if (!segment.bytes || !space.totalBytes) return null;
            const className = `server-disk-segment is-${segment.tone}`;
            const surfaceTokens = {
              flexGrow: segment.bytes / space.totalBytes,
              '--allocation-alpha': 0.28 + (index % 4) * 0.14,
            };
            const label = `${segment.label}: ${bytes(segment.bytes)}`;
            return segment.targetId ? (
              <Pressable
                key={segment.id}
                className={className}
                surfaceTokens={surfaceTokens}
                ariaLabel={`Show ${label}`}
                title={label}
                onPress={() => onSelect(segment.targetId!)}
              />
            ) : (
              <Text
                key={segment.id}
                className={className}
                surfaceTokens={surfaceTokens}
                ariaLabel={label}
                title={label}
              />
            );
          })}
      </Box>
      <Box className="server-disk-legend">
        {space.segments.map((segment, index) => {
          const content = (
            <>
              <Text
                semantic="swatch"
                className={`is-${segment.tone}`}
                surfaceTokens={{ '--allocation-alpha': 0.28 + (index % 4) * 0.14 }}
              />
              {segment.label}
              <Text semantic="strong">{bytes(segment.bytes)}</Text>
            </>
          );
          return segment.targetId ? (
            <Pressable
              key={segment.id}
              onPress={() => onSelect(segment.targetId!)}
              ariaLabel={`Show ${segment.label}`}
            >
              {content}
            </Pressable>
          ) : (
            <Text key={segment.id}>{content}</Text>
          );
        })}
      </Box>
      <Text semantic="p" className="server-disk-space-note">
        {space.note}
      </Text>
    </Box>
  );
}
