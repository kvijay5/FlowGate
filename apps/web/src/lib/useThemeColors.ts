'use client';

import { useTheme } from '@/components/theme/ThemeProvider';

export interface ThemeColors {
  isDark: boolean;
  edgeDefault: string;
  edgeActive: string;
  gridDot: string;
  surface: string;
  canvas: string;
  textPrimary: string;
  textSecondary: string;
  success: string;
  warning: string;
  danger: string;
  accent: string;
}

export function useThemeColors(): ThemeColors {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (isDark) {
    return {
      isDark: true,
      edgeDefault: '#4B5563',
      edgeActive: '#DC2626',
      gridDot: 'rgba(255, 255, 255, 0.10)',
      surface: '#0A0A0A',
      canvas: '#000000',
      textPrimary: '#FFFFFF',
      textSecondary: '#9CA3AF',
      success: '#22C55E',
      warning: '#F59E0B',
      danger: '#DC2626',
      accent: '#DC2626',
    };
  }

  return {
    isDark: false,
    edgeDefault: '#9CA3AF',
    edgeActive: '#B91C1C',
    gridDot: 'rgba(0, 0, 0, 0.10)',
    surface: '#FAFAFA',
    canvas: '#FFFFFF',
    textPrimary: '#000000',
    textSecondary: '#6B7280',
    success: '#00782C',
    warning: '#D97706',
    danger: '#B91C1C',
    accent: '#B91C1C',
  };
}
