import type { Config } from 'tailwindcss';

const config: Config = {
  content: [],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#6366f1',
          foreground: '#ffffff',
        },
        background: '#000000',
        foreground: '#ffffff',
        muted: '#999999',
      },
    },
  },
  plugins: [],
};

export default config;
