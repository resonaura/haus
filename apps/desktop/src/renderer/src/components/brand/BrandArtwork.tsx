/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Image as HausImage } from '@haus/ui';
import type { PreparedBrandArtwork } from '../../model/brand-artwork';

/** Brand artwork surface delegated through the `@haus/ui` host image primitive. */
export function BrandArtwork({ artwork }: { artwork: PreparedBrandArtwork }) {
  return (
    <HausImage
      className={`brand-icon ${artwork.template ? 'brand-template' : 'brand-original'}`}
      src={artwork.src}
      alt=""
      ariaHidden
    />
  );
}
