import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Manrope', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        sans: ['Manrope', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        primary: {
          DEFAULT: 'var(--color-primary, #3447f3)',
          dark: 'var(--color-primary-dark, #2636d4)',
          foreground: '#ffffff',
        },
        background: 'var(--color-background, #f7f8fd)',
        surface: 'var(--color-surface, #eff2fb)',
        foreground: 'var(--color-text-primary, #11162b)',
        secondary: 'var(--color-secondary, #11162b)',
        destructive: 'var(--color-destructive, #eb4d3d)',
        muted: 'var(--color-text-muted, #8a94a9)',
        separator: 'var(--color-separator, #e3e7f0)',
        border: 'var(--color-border, #e3e7f0)',
        positive: 'var(--color-positive, #1b945d)',
        negative: 'var(--color-negative, #eb4d3d)',
        signal: 'var(--color-signal, #d8ff57)',
      },
    },
  },
  plugins: [],
};

export default config;
