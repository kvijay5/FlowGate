import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    // Brutalist minimal border radius: 0px or 2px max
    borderRadius: {
      none: '0px',
      DEFAULT: '0px',
      sm: '2px',
      md: '2px',
      lg: '2px',
      xl: '2px',
      '2xl': '2px',
      '3xl': '2px',
      full: '9999px',
      control: '2px',
      card: '0px',
      sheet: '0px',
    },
    extend: {
      fontFamily: {
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'Menlo', 'monospace'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
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
        crimson: {
          DEFAULT: '#DC2626',
          50: '#FEF2F2',
          100: '#FEE2E2',
          500: '#EF4444',
          600: '#DC2626',
          700: '#B91C1C',
          800: '#991B1B',
          900: '#7F1D1D',
          950: '#450A0A',
        },
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        info: 'rgb(var(--accent) / <alpha-value>)',
        border: 'var(--border-subtle)',
        line: {
          DEFAULT: 'var(--border-subtle)',
          subtle: 'var(--line-subtle)',
        },
        // Neutralized obsidian & aurora aliases (zero blue/purple)
        obsidian: {
          950: 'rgb(var(--bg-canvas) / <alpha-value>)',
          900: 'rgb(var(--bg-surface) / <alpha-value>)',
          850: 'rgb(var(--bg-raised) / <alpha-value>)',
          800: 'rgb(var(--bg-raised) / <alpha-value>)',
          750: 'rgb(var(--bg-raised) / <alpha-value>)',
          700: 'rgb(var(--bg-raised) / <alpha-value>)',
        },
        aurora: {
          violet: 'rgb(var(--accent) / <alpha-value>)',
          purple: 'rgb(var(--accent) / <alpha-value>)',
          cyan: 'rgb(var(--accent) / <alpha-value>)',
          emerald: 'rgb(var(--success) / <alpha-value>)',
          rose: 'rgb(var(--danger) / <alpha-value>)',
          amber: 'rgb(var(--warning) / <alpha-value>)',
        },
      },
      boxShadow: {
        float: 'none',
        dialog: 'none',
      },
    },
  },
  plugins: [],
};

export default config;
