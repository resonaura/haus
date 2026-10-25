import { ChevronRight } from 'lucide-react';
import { ScrollShadow } from '@heroui/react';
import { diskDepth, diskDisplayName, orderDisks, partitionPurpose } from './presentation';
import { DiskIcon, storageMediaLabel } from './DiskIcon';
import type { ServerDisk } from './types';

export function diskTreeSubtitle(item: ServerDisk) {
  const subtitle =
    item.physical === true
      ? storageMediaLabel(item) || 'Physical disk'
      : item.type === 'partition'
        ? partitionPurpose(item) || 'Partition'
        : item.type === 'container'
          ? partitionPurpose(item) || 'Storage container'
          : item.type === 'disk' || item.kind === 'disk'
            ? 'Storage device'
            : item.filesystem || 'Volume';
  if (subtitle !== diskDisplayName(item)) return subtitle;
  return [item.partitionNumber ? `Partition ${item.partitionNumber}` : 'Partition', item.filesystem]
    .filter(Boolean)
    .join(' · ');
}

export function visibleDisks(disks: ServerDisk[], collapsed: ReadonlySet<string>) {
  const byId = new Map(disks.map((disk) => [disk.id, disk]));
  return orderDisks(disks).filter((disk) => {
    const seen = new Set([disk.id]);
    let parent = disk.parentId;
    while (parent && !seen.has(parent)) {
      if (collapsed.has(parent)) return false;
      seen.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
    return true;
  });
}

export function DiskTree({
  disks,
  selected,
  collapsed,
  onSelect,
  onToggle,
}: {
  disks: ServerDisk[];
  selected: string;
  collapsed: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const ordered = orderDisks(disks),
    visible = visibleDisks(disks, collapsed);
  const selectAndFocus = (id: string, element: HTMLElement) => {
    onSelect(id);
    [...element.closest('[role="tree"]')!.querySelectorAll<HTMLElement>('[role="treeitem"]')]
      .find((row) => row.dataset.diskId === id)
      ?.focus();
  };
  // Keep groups mounted for entry/exit animation and stable telemetry refreshes.
  // A visited set also bounds malformed/cyclic parent relationships.
  const visited = new Set<string>();
  const branch = (item: ServerDisk): React.ReactNode => {
    if (visited.has(item.id)) return null;
    visited.add(item.id);
    const children = ordered.filter(
      (child) => child.parentId === item.id && !visited.has(child.id),
    );
    const expanded = children.length > 0 && !collapsed.has(item.id);
    const index = visible.findIndex((disk) => disk.id === item.id);
    return (
      <div
        key={item.id}
        role="treeitem"
        tabIndex={item.id === selected ? 0 : -1}
        className="server-disk-tree-item"
        data-disk-id={item.id}
        aria-label={diskDisplayName(item)}
        aria-level={diskDepth(item, disks) + 1}
        aria-selected={item.id === selected}
        aria-expanded={children.length ? expanded : undefined}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest('[role="treeitem"]') !== event.currentTarget)
            return;
          let target: ServerDisk | undefined;
          if (event.key === 'ArrowDown') target = visible[index + 1];
          else if (event.key === 'ArrowUp') target = visible[index - 1];
          else if (event.key === 'Home') target = visible[0];
          else if (event.key === 'End') target = visible.at(-1);
          else if (event.key === 'ArrowRight') {
            if (children.length && !expanded) onToggle(item.id);
            else target = visible.find((child) => child.parentId === item.id);
          } else if (event.key === 'ArrowLeft') {
            if (expanded) onToggle(item.id);
            else target = visible.find((parent) => parent.id === item.parentId);
          } else if (event.key === 'Enter' || event.key === ' ') onSelect(item.id);
          else return;
          event.preventDefault();
          event.stopPropagation();
          if (target) selectAndFocus(target.id, event.currentTarget);
        }}
      >
        <div
          className={'server-disk-option ' + (item.id === selected ? 'is-selected' : '')}
          style={{ paddingInlineStart: 6 + diskDepth(item, disks) * 12 }}
          data-physical={item.physical === true || undefined}
          data-partition-role={item.partitionRole}
          onClick={() => onSelect(item.id)}
        >
          {children.length ? (
            <button
              type="button"
              tabIndex={-1}
              className="server-disk-disclosure"
              aria-label={(expanded ? 'Collapse ' : 'Expand ') + diskDisplayName(item)}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation();
                onToggle(item.id);
              }}
            >
              <ChevronRight size={12} />
            </button>
          ) : (
            <span className="server-disk-disclosure-placeholder" />
          )}
          <DiskIcon disk={item} />
          <span className="server-disk-option-label">
            <strong>{diskDisplayName(item)}</strong>
            <small>{diskTreeSubtitle(item)}</small>
          </span>
        </div>
        {children.length > 0 && (
          <div
            className={'server-disk-branch ' + (expanded ? 'is-expanded' : '')}
            aria-hidden={!expanded}
            inert={!expanded}
          >
            <div className="server-disk-children" role="group">
              {children.map(branch)}
            </div>
          </div>
        )}
      </div>
    );
  };
  const ids = new Set(disks.map((disk) => disk.id));
  const roots = ordered.filter((disk) => !disk.parentId || !ids.has(disk.parentId));
  return (
    <ScrollShadow
      className="server-disk-list"
      role="tree"
      aria-label="Disks and volumes"
      orientation="vertical"
      size={32}
    >
      {roots.map(branch)}
      {ordered.filter((disk) => !visited.has(disk.id)).map(branch)}
    </ScrollShadow>
  );
}
