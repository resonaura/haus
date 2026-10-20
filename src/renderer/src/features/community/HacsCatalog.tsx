import { useLayoutEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { VirtualSections } from '../../components/ui/VirtualSections';
import type { CommunityRepository } from './hacs';
export function HacsCatalog({
  repositories,
  onSelect,
}: {
  repositories: CommunityRepository[];
  onSelect: (repository: CommunityRepository) => void;
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
          <button className="hacs-catalog-item" onClick={() => onSelect(repo)}>
            <span className="integration-logo">
              <BrandIcon kind="integration" id={repo.domain || 'hacs'} />
            </span>
            <span>
              <strong>{repo.name}</strong>
              <small>{repo.description || repo.full_name}</small>
              <em>
                {repo.category}
                {repo.installed
                  ? ` · ${repo.installed_version ?? 'Installed'}`
                  : repo.stars
                    ? ` · ${repo.stars.toLocaleString()} stars`
                    : ''}
              </em>
            </span>
            <span className="hacs-catalog-status">
              {repo.pending_upgrade ? 'Update available' : repo.installed ? 'Installed' : ''}
            </span>
            <ChevronRight size={16} />
          </button>
        )}
      />
    </div>
  );
}
