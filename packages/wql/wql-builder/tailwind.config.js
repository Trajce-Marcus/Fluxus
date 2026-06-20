/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
        sans: ['"DM Sans"', 'sans-serif'],
      },
      colors: {
        bg:       '#0f1117',
        surface:  '#161b27',
        surface2: '#1e2535',
        surface3: '#252d3f',
        border:   '#2a3348',
        accent:   '#4f8ef7',
        wgreen:   '#22c55e',
        wamber:   '#f59e0b',
        wred:     '#ef4444',
        wmuted:   '#64748b',
      },
    },
  },
  plugins: [],
};
