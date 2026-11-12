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
      edgeDefault: '#6E6E73',
      edgeActive: '#2997FF',
      gridDot: 'rgba(255, 255, 255, 0.10)',
      surface: '#1C1C1E',
      canvas: '#000000',
      textPrimary: '#F5F5F7',
      textSecondary: '#A1A1A6',
      success: '#30D158',
      warning: '#FF9230',
      danger: '#FF453A',
      accent: '#2997FF',
    };
  }

  return {
    isDark: false,
    edgeDefault: '#86868B',
    edgeActive: '#0071E3',
    gridDot: 'rgba(0, 0, 0, 0.12)',
    surface: '#FFFFFF',
    canvas: '#F5F5F7',
    textPrimary: '#1D1D1F',
    textSecondary: '#6E6E73',
    success: '#00782C',
    warning: '#B34700',
    danger: '#D70015',
    accent: '#0071E3',
  };
}
