import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function Section({
  className,
  title,
  subtitle,
  action,
  onAction,
  children,
}: {
  className?: string;
  title: string;
  subtitle: string;
  action: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`home-section ${className ?? ''}`}>
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <button onClick={onAction}>
          {action}
          <ChevronRight size={15} />
        </button>
      </div>
      {children}
    </section>
  );
}
