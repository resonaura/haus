import { Button } from '@heroui/react';
import { Bell, ChevronRight, ShieldCheck } from 'lucide-react';
import type { HausModel } from '../../model';
import type { useHomeNotifications } from '../../hooks/useHomeNotifications';
import { message } from '../../hooks/useHaus';
import { ServerMarkdown } from '../../components/ui/ServerMarkdown';
import { EmptyState as Empty } from '../../components/ui/EmptyState';
type Props = {
  homeNotices: ReturnType<typeof useHomeNotifications>;
  appAttention: HausModel['attention'];
  onOpenEntity: (id: string) => void;
  notify: (text: string) => void;
  openServer: (path: string) => void;
};
export function AttentionPage({
  homeNotices,
  appAttention,
  onOpenEntity,
  notify,
  openServer,
}: Props) {
  return (
    <div className="attention-list">
      {homeNotices.error && (
        <p role="status" className="form-error">
          {homeNotices.error}
        </p>
      )}
      {homeNotices.notifications.map((notice) => (
        <article className="home-notice" key={notice.id}>
          <span className={`attention-icon ${notice.severity === 'critical' ? 'critical' : ''}`}>
            <Bell size={21} />
          </span>
          <div>
            <small>
              {notice.kind === 'update'
                ? 'Software update'
                : notice.kind === 'repair'
                  ? 'Repairs'
                  : 'Your home'}
            </small>
            <h3>{notice.title}</h3>
            <div className="home-notice-body">
              <ServerMarkdown text={notice.message} />
            </div>
          </div>
          {notice.notificationId ? (
            <Button
              variant="ghost"
              onPress={() =>
                void homeNotices
                  .dismiss(notice.notificationId!)
                  .catch((error) => notify(message(error)))
              }
            >
              Dismiss
            </Button>
          ) : (
            <Button
              variant="secondary"
              onPress={() => {
                openServer(notice.kind === 'update' ? '/config/updates' : '/config/repairs');
              }}
            >
              Review <ChevronRight size={15} />
            </Button>
          )}
        </article>
      ))}
      {appAttention.length ? (
        appAttention.map((a) => (
          <button key={a.id} onClick={() => onOpenEntity(a.entityId)}>
            <span className={`attention-icon ${a.severity === 'critical' ? 'critical' : ''}`}>
              <Bell size={21} />
            </span>
            <span>
              <strong>{a.title}</strong>
              <small>{a.description}</small>
            </span>
            <ChevronRight size={18} />
          </button>
        ))
      ) : !homeNotices.notifications.length && !homeNotices.error ? (
        <Empty
          icon={<ShieldCheck />}
          title="Everything feels right"
          description="Your home has no alerts that need your attention."
        />
      ) : null}
    </div>
  );
}
