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
    <section className="server-disk-space" aria-label={space.title}>
      <div className="server-disk-space-heading">
        <h5>{space.title}</h5>
        <span>{bytes(space.totalBytes)}</span>
      </div>
      <div className="server-disk-bar" role="group" aria-label={space.title}>
        {space.proportional &&
          space.segments.map((segment, index) => {
            if (!segment.bytes || !space.totalBytes) return null;
            const className = `server-disk-segment is-${segment.tone}`;
            const style = {
              flexGrow: segment.bytes / space.totalBytes,
              '--allocation-alpha': 0.28 + (index % 4) * 0.14,
            } as React.CSSProperties;
            const label = `${segment.label}: ${bytes(segment.bytes)}`;
            return segment.targetId ? (
              <button
                key={segment.id}
                className={className}
                style={style}
                aria-label={`Show ${label}`}
                title={label}
                onClick={() => onSelect(segment.targetId!)}
              />
            ) : (
              <span
                key={segment.id}
                className={className}
                style={style}
                aria-label={label}
                title={label}
              />
            );
          })}
      </div>
      <div className="server-disk-legend">
        {space.segments.map((segment, index) => {
          const content = (
            <>
              <i
                className={`is-${segment.tone}`}
                style={{ '--allocation-alpha': 0.28 + (index % 4) * 0.14 } as React.CSSProperties}
              />
              {segment.label}
              <strong>{bytes(segment.bytes)}</strong>
            </>
          );
          return segment.targetId ? (
            <button
              key={segment.id}
              onClick={() => onSelect(segment.targetId!)}
              aria-label={`Show ${segment.label}`}
            >
              {content}
            </button>
          ) : (
            <span key={segment.id}>{content}</span>
          );
        })}
      </div>
      <p className="server-disk-space-note">{space.note}</p>
    </section>
  );
}
