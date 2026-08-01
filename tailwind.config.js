/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // The four wizard steps are the four bases — A C G T carry step identity.
        base: {
          a: '#15803d', c: '#1d4ed8', g: '#b45309', t: '#b91c1c',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
