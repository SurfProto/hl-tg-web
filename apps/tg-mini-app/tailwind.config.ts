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
          DEFAULT: 'var(--tg-button-color, #6366f1)',
          foreground: 'var(--tg-button-text-color, #ffffff)',
        },
        background: 'var(--tg-bg-color, #000000)',
        foreground: 'var(--tg-text-color, #ffffff)',
        muted: 'var(--tg-hint-color, #999999)',
      },
    },
  },
  plugins: [],
};

export default config;
