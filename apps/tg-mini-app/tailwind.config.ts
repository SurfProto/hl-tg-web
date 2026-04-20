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
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        primary: {
          DEFAULT: 'var(--color-primary, #00C076)',
          dark: 'var(--color-primary-dark, #00a065)',
          foreground: '#ffffff',
        },
        background: 'var(--color-background, #ffffff)',
        surface: 'var(--color-surface, #f5f5f5)',
        foreground: 'var(--color-text-primary, #111827)',
        secondary: 'var(--color-secondary, #111827)',
        destructive: 'var(--color-destructive, #dc2626)',
        muted: 'var(--color-text-muted, #9ca3af)',
        separator: 'var(--color-separator, #f0f0f0)',
        border: 'var(--color-border, #e5e7eb)',
        positive: 'var(--color-positive, #00C076)',
        negative: 'var(--color-negative, #dc2626)',
      },
    },
  },
  plugins: [],
};

export default config;
