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
  const base = interactive ? 'glass-card-interactive cursor-pointer' : 'glass-card';
  const padding = padded ? 'p-5' : '';

  return (
    <div className={`rounded-card overflow-hidden ${base} ${padding} ${className}`} {...props}>
      {children}
    </div>
  );
}
