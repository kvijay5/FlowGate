'use client';

import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from './ThemeProvider';

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const rawId = useId();
  // Sanitize colons from React 18 useId for safe SVG mask references
  const maskId = `theme-mask-${rawId.replace(/:/g, '')}`;

  const isDark = resolvedTheme === 'dark';

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    toggleTheme({ x, y });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface/80 text-fg-primary backdrop-blur-md transition-colors hover:bg-raised focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <mask id={maskId}>
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <motion.circle
            animate={{
              cx: isDark ? 19 : 25,
              cy: isDark ? 5 : -1,
            }}
            transition={{ type: 'spring', duration: 0.5, bounce: 0.2 }}
            r="6"
            fill="black"
          />
        </mask>

        {/* Core Sun / Moon Center */}
        <motion.circle
          cx="12"
          cy="12"
          animate={{
            r: isDark ? 9 : 5,
          }}
          transition={{ type: 'spring', duration: 0.5, bounce: 0.2 }}
          fill="currentColor"
          mask={`url(#${maskId})`}
        />

        {/* Sun Rays (Fade and scale out in dark mode) */}
        <motion.g
          stroke="currentColor"
          animate={{
            opacity: isDark ? 0 : 1,
            scale: isDark ? 0.6 : 1,
            rotate: isDark ? 45 : 0,
          }}
          transition={{ type: 'spring', duration: 0.5, bounce: 0.2 }}
          style={{ transformOrigin: 'center' }}
        >
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </motion.g>
      </svg>
    </button>
  );
}
