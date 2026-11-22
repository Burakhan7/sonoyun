import type { Config } from 'tailwindcss';

const config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#F8F6F1',
        ink: '#23201B',
        muted: '#6B655A',
        accent: '#C2410C',
        success: '#15803D',
        danger: '#B91C1C',
      },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
    },
  },
  plugins: [],
} satisfies Config;

export default config;
