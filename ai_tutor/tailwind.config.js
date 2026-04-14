/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'display': ['"Outfit"', 'sans-serif'],
        'serif': ['"Outfit"', 'sans-serif'],
        'sans': ['"Outfit"', 'sans-serif'],
      },
      colors: {
        deep: '#0d0d0e',
        paper: '#f9f8f4',
        cadmium: '#006B3C', 
        'cadmium-soft': '#1e382d',
        ink: '#e6e4dc',
        'ink-muted': '#8a8a85',
      },
      boxShadow: {
        'journal': '0 20px 50px -12px rgba(0, 0, 0, 0.5)',
      }
    },
  },
  plugins: [],
}
