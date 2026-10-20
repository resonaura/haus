import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { ArrowLeft } from 'lucide-react';

/** Management stays in the workspace; only focused setup and confirmation use dialogs. */
export function ConnectionDetailLayout({
  title,
  icon,
  subtitle,
  children,
  actions,
  onBack,
}: {
  title: string;
  icon: ReactNode;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  onBack: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.closest('.main-scroll')?.scrollTo({ top: 0, behavior: 'instant' });
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <section className="connection-detail-page" aria-label={title}>
      <Button variant="ghost" className="connection-back" onPress={onBack}>
        <ArrowLeft size={17} />
        Back
      </Button>
      <header className="connection-page-heading">
        <span className="integration-logo">{icon}</span>
        <div>
          <h2 ref={heading} tabIndex={-1}>
            {title}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="connection-page-actions">{actions}</div>}
      </header>
      <div className="connection-page-content">{children}</div>
    </section>
  );
}
