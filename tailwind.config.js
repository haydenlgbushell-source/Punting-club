/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Barlow Condensed"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Racing green brand scale
        brand: {
          50:  '#F0F7F2',
          100: '#DCEDE2',
          200: '#BBDAC7',
          300: '#8FBFA3',
          400: '#5F9D7B',
          500: '#3E7D5C',
          600: '#2B6347',
          700: '#1F4F38',
          800: '#18402E',
          900: '#123424',
          950: '#0B2419',
        },
        gold: {
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#EAB308',
          600: '#CA8A04',
        },
      },
    },
  },
  plugins: [],
}
