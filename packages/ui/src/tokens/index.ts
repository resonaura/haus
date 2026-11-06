/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface ColorTokens {
  readonly background: string;
  readonly surface: string;
  readonly surfaceElevated: string;
  readonly surfaceHover: string;
  readonly surfaceActive: string;
  readonly border: string;
  readonly borderSubtle: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly accent: string;
  readonly accentHover: string;
  readonly success: string;
  readonly warning: string;
  readonly critical: string;
  readonly active: string;
  readonly offline: string;
}

export interface TypographyTokens {
  readonly fontFamily: string;
  readonly fontSize: {
    readonly caption: string;
    readonly bodySm: string;
    readonly body: string;
    readonly subtitle: string;
    readonly title: string;
    readonly display: string;
  };
  readonly fontWeight: {
    readonly normal: number;
    readonly medium: number;
    readonly semibold: number;
    readonly bold: number;
  };
  readonly lineHeight: {
    readonly tight: number;
    readonly normal: number;
    readonly relaxed: number;
  };
}

export interface SpacingTokens {
  readonly 0: string;
  readonly 2: string;
  readonly 4: string;
  readonly 8: string;
  readonly 12: string;
  readonly 16: string;
  readonly 20: string;
  readonly 24: string;
  readonly 32: string;
  readonly 40: string;
  readonly 48: string;
  readonly 64: string;
}

export interface RadiiTokens {
  readonly none: string;
  readonly sm: string;
  readonly md: string;
  readonly lg: string;
  readonly xl: string;
  readonly full: string;
}

export interface ElevationTokens {
  readonly none: string;
  readonly sm: string;
  readonly md: string;
  readonly lg: string;
  readonly blurSm: string;
  readonly blurMd: string;
  readonly blurLg: string;
}

export interface ThemeTokens {
  readonly mode: 'dark' | 'light';
  readonly colors: ColorTokens;
  readonly typography: TypographyTokens;
  readonly spacing: SpacingTokens;
  readonly radii: RadiiTokens;
  readonly elevation: ElevationTokens;
}

const baseTypography: TypographyTokens = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontSize: {
    caption: '11px',
    bodySm: '13px',
    body: '14px',
    subtitle: '16px',
    title: '20px',
    display: '28px',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.45,
    relaxed: 1.6,
  },
};

const baseSpacing: SpacingTokens = {
  0: '0px',
  2: '2px',
  4: '4px',
  8: '8px',
  12: '12px',
  16: '16px',
  20: '20px',
  24: '24px',
  32: '32px',
  40: '40px',
  48: '48px',
  64: '64px',
};

const baseRadii: RadiiTokens = {
  none: '0px',
  sm: '6px',
  md: '10px',
  lg: '16px',
  xl: '24px',
  full: '9999px',
};

const baseElevation: ElevationTokens = {
  none: 'none',
  sm: '0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -2px rgba(0, 0, 0, 0.2)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -4px rgba(0, 0, 0, 0.3)',
  blurSm: 'blur(8px)',
  blurMd: 'blur(16px)',
  blurLg: 'blur(24px)',
};

export const darkThemeTokens: ThemeTokens = {
  mode: 'dark',
  colors: {
    background: '#0d0f12',
    surface: '#15191e',
    surfaceElevated: '#1e232a',
    surfaceHover: '#252c34',
    surfaceActive: '#2d3540',
    border: '#2a313a',
    borderSubtle: '#1f252c',
    textPrimary: '#f3f4f6',
    textSecondary: '#9ca3af',
    textMuted: '#6b7280',
    accent: '#3b82f6',
    accentHover: '#60a5fa',
    success: '#10b981',
    warning: '#f59e0b',
    critical: '#ef4444',
    active: '#3b82f6',
    offline: '#4b5563',
  },
  typography: baseTypography,
  spacing: baseSpacing,
  radii: baseRadii,
  elevation: baseElevation,
};

export const lightThemeTokens: ThemeTokens = {
  mode: 'light',
  colors: {
    background: '#f9fafb',
    surface: '#ffffff',
    surfaceElevated: '#f3f4f6',
    surfaceHover: '#e5e7eb',
    surfaceActive: '#d1d5db',
    border: '#e5e7eb',
    borderSubtle: '#f3f4f6',
    textPrimary: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#9ca3af',
    accent: '#2563eb',
    accentHover: '#1d4ed8',
    success: '#059669',
    warning: '#d97706',
    critical: '#dc2626',
    active: '#2563eb',
    offline: '#9ca3af',
  },
  typography: baseTypography,
  spacing: baseSpacing,
  radii: baseRadii,
  elevation: baseElevation,
};

export function getThemeTokens(mode: 'dark' | 'light' = 'dark'): ThemeTokens {
  return mode === 'light' ? lightThemeTokens : darkThemeTokens;
}
