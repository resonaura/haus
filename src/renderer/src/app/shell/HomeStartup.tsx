import { Button } from '@heroui/react';
import { House, RefreshCw } from 'lucide-react';

export function HomeStartup({
  failed,
  onRetry,
  onConnect,
}: {
  failed: boolean;
  onRetry: () => void;
  onConnect: () => void;
}) {
  return (
    <section className="home-startup" role="status" aria-live="polite" aria-busy={!failed}>
      <span className="home-startup__symbol" aria-hidden="true">
        <House size={30} strokeWidth={1.5} />
      </span>
      <h1>{failed ? 'Your home is taking a little longer' : 'Opening your home'}</h1>
      <p>
        {failed ? 'Check your connection and try again.' : 'Getting your rooms and devices ready.'}
      </p>
      {failed ? (
        <div className="home-startup__actions">
          <Button variant="secondary" onPress={onRetry}>
            <RefreshCw size={16} /> Try again
          </Button>
          <Button variant="ghost" onPress={onConnect}>
            Manage connection
          </Button>
        </div>
      ) : (
        <span className="home-startup__progress" aria-hidden="true" />
      )}
    </section>
  );
}
