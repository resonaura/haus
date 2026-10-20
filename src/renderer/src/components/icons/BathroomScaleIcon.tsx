import { forwardRef } from 'react';
import type { LucideProps } from 'lucide-react';

export const BathroomScaleIcon = forwardRef<SVGSVGElement, LucideProps>(function BathroomScaleIcon(
  { size = 24, ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="4" y="3" width="16" height="18" rx="4" />
      <path d="M8 9a4 4 0 0 1 8 0H8ZM12 9l1.5-2.3M8.5 15.5v2M15.5 15.5v2" />
    </svg>
  );
});
