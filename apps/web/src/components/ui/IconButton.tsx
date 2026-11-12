'use client';

import React from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  label: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', size = 'md', label, className = '', children, ...props }, ref) => {
    const sizeStyles = {
      sm: 'h-7 w-7 text-xs rounded-none',
      md: 'h-8 w-8 text-sm rounded-none',
      lg: 'h-10 w-10 text-base rounded-none',
    }[size];

    const variantStyles = {
      primary: 'bg-accent text-white hover:bg-accent-pressed border border-accent',
      secondary: 'bg-surface border border-line text-fg-primary hover:bg-raised',
      ghost: 'text-fg-secondary hover:text-fg-primary hover:bg-raised border border-transparent',
      danger: 'text-danger hover:bg-danger/10 border border-transparent hover:border-danger/30',
    }[variant];

    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={`inline-flex items-center justify-center transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-40 disabled:pointer-events-none active:translate-y-[1px] ${sizeStyles} ${variantStyles} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);

IconButton.displayName = 'IconButton';
