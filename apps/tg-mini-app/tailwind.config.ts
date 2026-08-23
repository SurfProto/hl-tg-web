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
      // rgb(<channels> / <alpha-value>) is what lets an opacity modifier work.
      // With a plain var(--color-x) Tailwind emits nothing for bg-negative/10,
      // which is why every such class in this app used to compile away.
      colors: {
        primary: {
          DEFAULT: 'rgb(var(--color-primary-rgb, 52 71 243) / <alpha-value>)',
          dark: 'rgb(var(--color-primary-dark-rgb, 38 54 212) / <alpha-value>)',
          foreground: '#ffffff',
        },
        background: 'rgb(var(--color-background-rgb, 247 248 253) / <alpha-value>)',
        surface: 'rgb(var(--color-surface-rgb, 239 242 251) / <alpha-value>)',
        foreground: 'rgb(var(--color-text-primary-rgb, 17 22 43) / <alpha-value>)',
        secondary: 'rgb(var(--color-secondary-rgb, 17 22 43) / <alpha-value>)',
        destructive: 'rgb(var(--color-destructive-rgb, 235 77 61) / <alpha-value>)',
        muted: 'rgb(var(--color-text-muted-rgb, 138 148 169) / <alpha-value>)',
        separator: 'rgb(var(--color-separator-rgb, 227 231 240) / <alpha-value>)',
        border: 'rgb(var(--color-border-rgb, 227 231 240) / <alpha-value>)',
        positive: 'rgb(var(--color-positive-rgb, 27 148 93) / <alpha-value>)',
        negative: 'rgb(var(--color-negative-rgb, 235 77 61) / <alpha-value>)',
        warning: 'rgb(var(--color-warning-rgb, 180 83 9) / <alpha-value>)',
        signal: 'rgb(var(--color-signal-rgb, 216 255 87) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};

export default config;
