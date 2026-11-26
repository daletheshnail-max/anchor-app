/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink:    '#0b1120',
        panel:  '#131d33',
        panel2: '#1b2742',
        edge:   '#2a3a5c',
        faint:  '#8aa0c6',
        paper:  '#e7eefc',
        brand:  '#6aa0ff',
        grow:   '#3ddc97',
        calm:   '#b08cff',
        warm:   '#ffce6a',
        rose:   '#ff9aa6',
      },
      fontFamily: {
        sans: ['ui-rounded', '-apple-system', 'Segoe UI', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 10px 40px -12px rgba(0,0,0,0.55)',
        glow: '0 0 0 1px rgba(106,160,255,0.25), 0 8px 30px -8px rgba(106,160,255,0.35)',
      },
    },
  },
  safelist: [
    'text-warm', 'text-calm', 'text-brand', 'text-grow',
    'bg-warm/60', 'bg-calm/60', 'bg-brand/60', 'bg-grow/60',
    'hover:border-brand/50', 'hover:border-calm/50', 'hover:border-grow/50', 'hover:border-warm/50',
  ],
  plugins: [],
};
