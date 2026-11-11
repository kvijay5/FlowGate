import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: '#05050A',
          900: '#0A0A14',
          850: '#0F1020',
          800: '#16182E',
          750: '#1D203C',
          700: '#262A4E',
        },
        aurora: {
          violet: '#7C3AED',
          purple: '#A855F7',
          cyan: '#06B6D4',
          emerald: '#10B981',
          rose: '#F43F5E',
          amber: '#F59E0B',
        },
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
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
