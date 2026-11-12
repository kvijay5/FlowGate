'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { applyThemeWithReveal, Theme, ResolvedTheme } from '@/lib/theme-transition';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme, origin?: { x: number; y: number }) => void;
  toggleTheme: (origin?: { x: number; y: number }) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'flowgate-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('dark');
  const [mounted, setMounted] = useState(false);

  // Helper to determine resolved theme
  const getSystemTheme = (): ResolvedTheme => {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  // Synchronize with DOM on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      const initialTheme: Theme =
        stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
      setThemeState(initialTheme);

      const resolved = initialTheme === 'system' ? getSystemTheme() : initialTheme;
      setResolvedTheme(resolved);
      document.documentElement.dataset.theme = resolved;
    } catch {
      // Ignore localStorage access failures
    }
    setMounted(true);
  }, []);

  // Listen to OS preference changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      if (theme === 'system') {
        const nextResolved = media.matches ? 'dark' : 'light';
        setResolvedTheme(nextResolved);
        document.documentElement.dataset.theme = nextResolved;
      }
    };

    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [theme]);

  // Listen to cross-tab storage changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        const next = (e.newValue as Theme) || 'system';
        setThemeState(next);
        const resolved = next === 'system' ? getSystemTheme() : next;
        setResolvedTheme(resolved);
        document.documentElement.dataset.theme = resolved;
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setTheme = useCallback((newTheme: Theme, origin?: { x: number; y: number }) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {}

    const nextResolved = newTheme === 'system' ? getSystemTheme() : newTheme;
    setResolvedTheme(nextResolved);
    applyThemeWithReveal(nextResolved, origin);
  }, []);

  const toggleTheme = useCallback(
    (origin?: { x: number; y: number }) => {
      const nextResolved: ResolvedTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
      setTheme(nextResolved, origin);
    },
    [resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
