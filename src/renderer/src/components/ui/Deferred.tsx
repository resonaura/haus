import { Suspense, type ReactNode } from 'react';
export function Deferred({
  children,
  overlay = false,
}: {
  children: ReactNode;
  overlay?: boolean;
}) {
  return (
    <Suspense
      fallback={
        <div
          className={`feature-loading${overlay ? ' is-overlay' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span>Loading…</span>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
