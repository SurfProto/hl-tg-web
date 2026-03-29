import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--color-primary, #3b82f6)',
          dark: 'var(--color-primary-dark, #2563eb)',
          foreground: '#ffffff',
        },
        background: 'var(--color-background, #ffffff)',
        surface: 'var(--color-surface, #f8f9fa)',
        foreground: 'var(--color-text-primary, #111827)',
        secondary: 'var(--color-secondary, #111827)',
        destructive: 'var(--color-destructive, #ef4444)',
        muted: 'var(--color-text-muted, #9ca3af)',
        separator: 'var(--color-separator, #f3f4f6)',
        border: 'var(--color-border, #e5e7eb)',
        positive: 'var(--color-positive, #16a34a)',
        negative: 'var(--color-negative, #dc2626)',
      },
    },
  },
  plugins: [],
};

export default config;
