/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import { Box } from '../primitives/elements.js';
import { Section } from './section.js';

interface HomeQuickSection {
  readonly title: string;
  readonly subtitle: string;
  readonly action: string;
  readonly onAction: () => void;
  readonly content: ReactNode;
}

export function HomeSections({
  cameraCount,
  cameras,
  scenes,
  quick,
  attention,
  rooms,
  onCameras,
  onScenes,
  portable = false,
}: {
  readonly cameraCount: number;
  readonly cameras: ReactNode;
  readonly scenes?: ReactNode;
  readonly quick?: HomeQuickSection;
  readonly attention?: ReactNode;
  readonly rooms: ReactNode;
  readonly onCameras: () => void;
  readonly onScenes: () => void;
  readonly portable?: boolean;
}) {
  return (
    <>
      <Section
        className="home-section-unboxed overview-cameras"
        title="Cameras"
        subtitle={cameraCount ? `${cameraCount} views of home.` : 'Keep an eye on home.'}
        action="All cameras"
        onAction={onCameras}
        portable={portable}
      >
        {cameras}
      </Section>
      {scenes && (
        <Section
          title="Set the mood"
          subtitle="Tap a scene. Change the atmosphere."
          action="All scenes"
          onAction={onScenes}
          portable={portable}
        >
          {scenes}
        </Section>
      )}
      {quick && (
        <Box className="home-primary-grid">
          <Section
            className="home-section-unboxed overview-controls"
            title={quick.title}
            subtitle={quick.subtitle}
            action={quick.action}
            onAction={quick.onAction}
            portable={portable}
          >
            {quick.content}
          </Section>
        </Box>
      )}
      {attention}
      <Box className="home-room-stream" ariaLabel="Devices by room">
        {rooms}
      </Box>
    </>
  );
}
