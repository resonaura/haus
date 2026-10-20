import { forwardRef } from 'react';
import type { LucideProps } from 'lucide-react';

export const KettleIcon = forwardRef<SVGSVGElement, LucideProps>(function KettleIcon(
  { size = 23, ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8h10l1.5 10.5A2 2 0 0 1 15.5 21h-9a2 2 0 0 1-2-2.5L6 8Zm2-3h6v3M5.5 11 2 9l2 7M17 10h2a3 3 0 0 1 0 6h-1.2M8 2l1 1m3-1 1 1M8 18h6" />
    </svg>
  );
});
