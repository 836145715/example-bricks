/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0edff',
          100: '#ddd6fe',
          200: '#c4b5fd',
          300: '#a78bfa',
          400: '#8b5cf6',
          500: '#7c5cff',
          600: '#6d40e6',
          700: '#5b32cc',
          800: '#4c28a8',
          900: '#3b1f84',
        },
      },
    },
  },
  plugins: [],
}
