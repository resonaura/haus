/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Fragment, type ReactNode } from 'react';
import { Box, HausCode, HausLink, Heading, Text } from '@haus/ui';

/** Render server documentation as text and semantic blocks, without executing HTML. */
export function ServerMarkdown({ text }: { text: string }) {
  const references = new Map<string, string>();
  const lines = text.split('\n').filter((line) => {
    const reference = line.match(/^\s*\[([^\]]+)\]:\s*(\S+)/);
    if (reference) {
      references.set(reference[1].toLowerCase(), reference[2]);
      return false;
    }
    return !/^\s*!\[/.test(line);
  });
  const inline = (value: string): ReactNode[] =>
    value
      .split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\[[^\]]+\]\[[^\]]+\])/g)
      .filter(Boolean)
      .map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`'))
          return <HausCode key={index}>{part.slice(1, -1)}</HausCode>;
        if (part.startsWith('**') && part.endsWith('**'))
          return (
            <Text semantic="strong" key={index}>
              {part.slice(2, -2)}
            </Text>
          );
        const link = part.match(/^\[([^\]]+)\](?:\(([^)]+)\)|\[([^\]]+)\])$/);
        if (link) {
          const url = link[2] ?? references.get(link[3]?.toLowerCase());
          if (url && /^https:\/\/(?:www\.)?(?:home-assistant\.io|github\.com)\//.test(url))
            return (
              <HausLink
                key={index}
                href={url}
                onPress={() => {
                  void window.hausNative?.openExternal(url).catch(() => {});
                }}
              >
                {link[1]}
              </HausLink>
            );
          return <Text key={index}>{link[1]}</Text>;
        }
        return <Fragment key={index}>{part}</Fragment>;
      });
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.startsWith('```')) {
      const content: string[] = [];
      while (++i < lines.length && !lines[i].startsWith('```')) content.push(lines[i]);
      blocks.push(
        <HausCode block key={i}>
          {content.join('\n')}
        </HausCode>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      blocks.push(
        heading[1].length <= 2 ? (
          <Heading level={3} key={i}>
            {inline(heading[2])}
          </Heading>
        ) : (
          <Heading level={4} key={i}>
            {inline(heading[2])}
          </Heading>
        ),
      );
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = [line.replace(/^\s*[-*]\s/, '')];
      while (i + 1 < lines.length && /^\s*[-*]\s/.test(lines[i + 1]))
        items.push(lines[++i].replace(/^\s*[-*]\s/, ''));
      blocks.push(
        <Box semantic="list" key={i}>
          {items.map((item, index) => (
            <Box semantic="listitem" key={index}>
              {inline(item)}
            </Box>
          ))}
        </Box>,
      );
      continue;
    }
    const paragraph = [line];
    while (
      i + 1 < lines.length &&
      lines[i + 1].trim() &&
      !/^(?:#|```|\s*[-*]\s)/.test(lines[i + 1])
    )
      paragraph.push(lines[++i]);
    blocks.push(
      <Text semantic="p" key={i}>
        {inline(paragraph.join(' '))}
      </Text>,
    );
  }
  return <Box className="server-markdown">{blocks}</Box>;
}
