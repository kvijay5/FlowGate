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
      'inline-flex items-center justify-center font-medium rounded-lg transition-all focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]';

    const sizeStyles = {
      sm: 'text-xs px-2.5 py-1.5 gap-1.5',
      md: 'text-sm px-3.5 py-2 gap-2',
      lg: 'text-base px-5 py-2.5 gap-2.5',
    }[size];

    const variantStyles = {
      primary: 'bg-accent text-white hover:bg-accent-pressed shadow-xs',
      secondary: 'bg-surface border border-line text-fg hover:bg-raised shadow-xs',
      outline: 'bg-transparent border border-line text-fg hover:bg-raised shadow-xs',
      ghost: 'text-fg-muted hover:text-fg hover:bg-raised',
      danger: 'bg-danger text-white hover:opacity-90 shadow-xs',
    }[variant];

    return (
      <button
        ref={ref}
        disabled={disabled || isSpinning}
        className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
        {...props}
      >
        {isSpinning && (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
