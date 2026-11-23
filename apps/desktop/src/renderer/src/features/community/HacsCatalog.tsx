/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useLayoutEffect, useRef } from 'react';
import { Box, HausButton, Text } from '@haus/ui';
import { ArrowUpCircle, ChevronRight } from 'lucide-react';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { VirtualSections } from '../../components/ui/VirtualSections';
import type { CommunityRepository } from './hacs';
export function HacsCatalog({
  repositories,
  busy,
  onSelect,
  onUpdate,
}: {
  repositories: CommunityRepository[];
  busy?: boolean;
  onSelect: (repository: CommunityRepository) => void;
  onUpdate?: (repository: CommunityRepository) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scroll.current = root.current?.closest('.main-scroll') as HTMLDivElement | null;
  }, []);
  return (
    <Box boxRef={root} className="hacs-catalog">
      <VirtualSections
        items={repositories}
        getKey={(repo) => String(repo.id)}
        scrollRef={scroll}
        estimateHeight={() => 110}
        renderSection={(repo) => (
          <Box
            className="hacs-catalog-item"
            role="button"
            tabIndex={0}
            onPress={() => onSelect(repo)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(repo);
              }
            }}
          >
            <Text className="integration-logo">
              <BrandIcon
                kind="hacs"
                id={repo.domain || repo.full_name}
                hint={{
                  name: repo.name,
                  repositoryUrl: repo.full_name,
                  ...(repo.category ? { category: repo.category } : {}),
                }}
              />
            </Text>
            <Text>
              <Text semantic="strong">{repo.name}</Text>
              <Text semantic="small">{repo.description || repo.full_name}</Text>
              <Text semantic="em">
                {repo.category}
                {repo.installed
                  ? repo.pending_upgrade && repo.available_version
                    ? ` · ${repo.installed_version ?? 'Installed'} → ${repo.available_version}`
                    : ` · ${repo.installed_version ?? 'Installed'}`
                  : repo.stars
                    ? ` · ${repo.stars.toLocaleString()} stars`
                    : ''}
              </Text>
            </Text>
            <Box className="hacs-catalog-status" stopPropagation>
              {repo.pending_upgrade && onUpdate ? (
                <HausButton
                  size="sm"
                  className="flow-next-pill"
                  isDisabled={busy}
                  onPress={() => onUpdate(repo)}
                >
                  <ArrowUpCircle size={14} />
                  Update
                </HausButton>
              ) : repo.pending_upgrade ? (
                'Update available'
              ) : repo.installed ? (
                'Installed'
              ) : (
                ''
              )}
            </Box>
            <ChevronRight size={16} />
          </Box>
        )}
      />
    </Box>
  );
}
