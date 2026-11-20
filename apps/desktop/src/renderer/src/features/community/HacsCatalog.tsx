/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useLayoutEffect, useRef } from 'react';
import { Button } from '@heroui/react';
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
    <div ref={root} className="hacs-catalog">
      <VirtualSections
        items={repositories}
        getKey={(repo) => String(repo.id)}
        scrollRef={scroll}
        estimateHeight={() => 110}
        renderSection={(repo) => (
          <div
            className="hacs-catalog-item"
            role="button"
            tabIndex={0}
            onClick={() => onSelect(repo)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(repo);
              }
            }}
          >
            <span className="integration-logo">
              <BrandIcon
                kind="hacs"
                id={repo.domain || repo.full_name}
                hint={{
                  name: repo.name,
                  repositoryUrl: repo.full_name,
                  ...(repo.category ? { category: repo.category } : {}),
                }}
              />
            </span>
            <span>
              <strong>{repo.name}</strong>
              <small>{repo.description || repo.full_name}</small>
              <em>
                {repo.category}
                {repo.installed
                  ? repo.pending_upgrade && repo.available_version
                    ? ` · ${repo.installed_version ?? 'Installed'} → ${repo.available_version}`
                    : ` · ${repo.installed_version ?? 'Installed'}`
                  : repo.stars
                    ? ` · ${repo.stars.toLocaleString()} stars`
                    : ''}
              </em>
            </span>
            <span className="hacs-catalog-status" onClick={(e) => e.stopPropagation()}>
              {repo.pending_upgrade && onUpdate ? (
                <Button
                  size="sm"
                  className="flow-next-pill"
                  isDisabled={busy}
                  onPress={() => onUpdate(repo)}
                >
                  <ArrowUpCircle size={14} />
                  Update
                </Button>
              ) : repo.pending_upgrade ? (
                'Update available'
              ) : repo.installed ? (
                'Installed'
              ) : (
                ''
              )}
            </span>
            <ChevronRight size={16} />
          </div>
        )}
      />
    </div>
  );
}
