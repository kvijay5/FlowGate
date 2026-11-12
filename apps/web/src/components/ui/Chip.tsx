'use client';

import React from 'react';

export interface ChipProps {
  label?: React.ReactNode;
  children?: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'accent' | 'outline' | 'info';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  className?: string;
}

export function Chip({
  label,
  children,
  variant = 'default',
  size = 'sm',
  icon,
  className = '',
}: ChipProps) {
  const content = children !== undefined ? children : label;

  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
  }[size];

  const variantStyles = {
    default: 'bg-raised text-fg-muted border border-line',
    success:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
    danger: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20',
    accent: 'bg-accent/10 text-accent border border-accent/20',
    info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
    outline: 'bg-transparent text-fg-muted border border-line',
  }[variant];

  return (
    <span
      className={`inline-flex items-center font-medium rounded-md uppercase tracking-wider shrink-0 ${sizeStyles} ${variantStyles} ${className}`}
    >
      {icon}
      {content}
    </span>
  );
}
