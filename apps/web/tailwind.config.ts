import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--bg-canvas) / <alpha-value>)',
        surface: 'rgb(var(--bg-surface) / <alpha-value>)',
        raised: 'rgb(var(--bg-raised) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        fg: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--text-tertiary) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          pressed: 'rgb(var(--accent-pressed) / <alpha-value>)',
          text: 'rgb(var(--accent-text) / <alpha-value>)',
        },
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        info: 'rgb(var(--accent) / <alpha-value>)',
        glass: 'var(--glass-bg)',
        line: {
          DEFAULT: 'var(--glass-border)',
          subtle: 'var(--line-subtle)',
        },
        // Backwards compatibility mappings for legacy Obsidian & Aurora utilities
        obsidian: {
          950: 'rgb(var(--bg-canvas) / <alpha-value>)',
          900: 'rgb(var(--bg-surface) / <alpha-value>)',
          850: 'rgb(var(--bg-raised) / <alpha-value>)',
          800: 'rgb(var(--bg-raised) / <alpha-value>)',
          750: 'rgb(var(--bg-raised) / <alpha-value>)',
          700: 'rgb(var(--bg-raised) / <alpha-value>)',
        },
        aurora: {
          violet: '#7C3AED',
          purple: '#A855F7',
          cyan: 'rgb(var(--accent) / <alpha-value>)',
          emerald: 'rgb(var(--success) / <alpha-value>)',
          rose: 'rgb(var(--danger) / <alpha-value>)',
          amber: 'rgb(var(--warning) / <alpha-value>)',
        },
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
      },
      boxShadow: {
        float: '0 8px 30px rgba(0, 0, 0, 0.12)',
        dialog: '0 20px 60px rgba(0, 0, 0, 0.3)',
      },
      borderRadius: {
        control: '8px',
        card: '14px',
        sheet: '20px',
      },
      backgroundImage: {
        'radial-glow': 'radial-gradient(circle at 50% 0%, var(--tw-gradient-stops))',
        'aurora-mesh':
          'radial-gradient(at 10% 20%, rgba(124, 58, 237, 0.18) 0px, transparent 50%), radial-gradient(at 90% 10%, rgba(6, 182, 212, 0.18) 0px, transparent 50%), radial-gradient(at 50% 80%, rgba(16, 185, 129, 0.12) 0px, transparent 50%)',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float-slow': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
