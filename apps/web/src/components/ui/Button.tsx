'use client';

import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      loading = false,
      disabled,
      children,
      className = '',
      ...props
    },
    ref,
  ) => {
    const isSpinning = isLoading || loading;
    const baseStyles =
      'inline-flex items-center justify-center font-mono uppercase tracking-wider font-semibold rounded-none transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-40 disabled:pointer-events-none active:translate-y-[1px] select-none';

    const sizeStyles = {
      sm: 'text-[11px] px-2.5 py-1.5 gap-1.5',
      md: 'text-xs px-3.5 py-2 gap-2',
      lg: 'text-sm px-5 py-2.5 gap-2.5',
    }[size];

    const variantStyles = {
      primary: 'bg-accent text-white hover:bg-accent-pressed border border-accent shadow-none',
      secondary:
        'bg-surface border border-line text-fg-primary hover:bg-raised hover:border-fg-secondary shadow-none',
      outline:
        'bg-transparent border border-line text-fg-primary hover:bg-raised hover:border-accent shadow-none',
      ghost: 'text-fg-secondary hover:text-fg-primary hover:bg-raised',
      danger: 'bg-danger text-white hover:opacity-90 border border-danger shadow-none',
    }[variant];

    return (
      <button
        ref={ref}
        disabled={disabled || isSpinning}
        className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
        {...props}
      >
        {isSpinning && (
          <svg className="animate-spin -ml-1 mr-1.5 h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
