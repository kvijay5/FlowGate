'use client';

import React from 'react';

export interface ChipProps {
  label?: React.ReactNode;
  children?: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'accent' | 'outline' | 'info';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  className?: string;
  raw?: boolean;
}

export function Chip({
  label,
  children,
  variant = 'default',
  size = 'sm',
  icon,
  className = '',
  raw = false,
}: ChipProps) {
  const content = children !== undefined ? children : label;

  const sizeStyles = {
    sm: 'text-[10px] px-1.5 py-0.5 gap-1',
    md: 'text-[11px] px-2 py-0.5 gap-1.5',
  }[size];

  const variantStyles = {
    default: 'bg-surface text-fg-secondary border border-line',
    success:
      'bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-600/40',
    warning: 'bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-600/40',
    danger: 'bg-red-950/30 text-red-600 dark:text-red-400 border border-red-600/40',
    accent: 'bg-accent/10 text-accent border border-accent/40',
    info: 'bg-surface text-fg-primary border border-line',
    outline: 'bg-transparent text-fg-secondary border border-line',
  }[variant];

  const formattedContent =
    !raw && typeof content === 'string' && !content.trim().startsWith('[')
      ? `[ ${content} ]`
      : content;

  return (
    <span
      className={`inline-flex items-center font-mono font-medium rounded-none uppercase tracking-wider shrink-0 select-none ${sizeStyles} ${variantStyles} ${className}`}
    >
      {icon}
      {formattedContent}
    </span>
  );
}
