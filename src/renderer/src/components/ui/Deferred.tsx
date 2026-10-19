import { Suspense, type ReactNode } from 'react';
export function Deferred({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="feature-loading" role="status" aria-live="polite">
          Loading…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
