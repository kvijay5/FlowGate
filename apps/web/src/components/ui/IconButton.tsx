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
      sm: 'h-7 w-7 text-xs rounded-md',
      md: 'h-8 w-8 text-sm rounded-lg',
      lg: 'h-10 w-10 text-base rounded-xl',
    }[size];

    const variantStyles = {
      primary: 'bg-accent text-white hover:bg-accent-pressed',
      secondary: 'bg-surface border border-line text-fg-primary hover:bg-raised',
      ghost: 'text-fg-secondary hover:text-fg-primary hover:bg-raised',
      danger: 'text-danger hover:bg-danger/10',
    }[variant];

    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={`inline-flex items-center justify-center transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:pointer-events-none ${sizeStyles} ${variantStyles} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);

IconButton.displayName = 'IconButton';
