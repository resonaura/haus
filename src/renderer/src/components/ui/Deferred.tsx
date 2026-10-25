import { Suspense, type ReactNode } from 'react';
export function FeatureLoading({ overlay = false }: { overlay?: boolean }) {
  return (
    <div
      className={`feature-loading${overlay ? ' is-overlay' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span>Loading…</span>
    </div>
  );
}
export function Deferred({
  children,
  overlay = false,
}: {
  children: ReactNode;
  overlay?: boolean;
}) {
  return <Suspense fallback={<FeatureLoading overlay={overlay} />}>{children}</Suspense>;
}
