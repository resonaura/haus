/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { getCategoryMetadata, type DeviceCategory } from '../categories/index.js';
import { VectorGraphic } from '../primitives/media.js';
import { DEVICE_ICONS, iconSource, type UiIconProps } from './icons.js';

export function UiIcon({
  name,
  size = 24,
  color = 'currentColor',
  fill = 'none',
  strokeWidth,
  className = '',
  label,
}: UiIconProps & {
  readonly fill?: 'none' | 'currentColor';
  readonly strokeWidth?: number;
  readonly className?: string;
  readonly label?: string;
}) {
  return (
    <VectorGraphic
      viewWidth={24}
      viewHeight={24}
      width={size}
      height={size}
      stroke={color}
      rawSvgMarkup={iconSource(name, size, fill, strokeWidth)}
      className={`lucide lucide-${name} ${className}`.trim()}
      role={label ? 'img' : undefined}
      ariaHidden={!label}
      ariaLabel={label}
    />
  );
}

export interface CategoryIconProps {
  readonly category: DeviceCategory;
  readonly size?: number;
  readonly color?: string;
  readonly className?: string;
}

export function CategoryIcon({ category, size = 20, color, className = '' }: CategoryIconProps) {
  const meta = getCategoryMetadata(category);
  return (
    <UiIcon
      name={DEVICE_ICONS[category]}
      size={size}
      color={color ?? meta.accentColor}
      className={`haus-category-icon ${className}`.trim()}
      label={meta.label}
    />
  );
}
