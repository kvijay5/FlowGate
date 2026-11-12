'use client';

import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  padded?: boolean;
}

export function Card({
  interactive = false,
  padded = true,
  className = '',
  children,
  ...props
}: CardProps) {
  const base = interactive
    ? 'hud-card-interactive cursor-pointer hover:border-accent hover:bg-raised'
    : 'hud-card';
  const padding = padded ? 'p-5' : '';

  return (
    <div
      className={`rounded-none border border-line bg-surface text-fg-primary shadow-none transition-colors ${base} ${padding} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
