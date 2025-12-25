/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        surface: {
          DEFAULT: '#111318',
          muted: '#1b1d24',
          subtle: '#2b2f3a',
        },
        accent: {
          DEFAULT: '#4b9bff',
          soft: '#2b6ecf',
        },
      },
      boxShadow: {
        floating: '0 30px 60px rgba(0, 0, 0, 0.35)',
      },
      animation: {
        shake: 'shake 0.4s ease-in-out',
        fadeIn: 'fadeIn 0.6s ease',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-8px)' },
          '40%': { transform: 'translateX(6px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(3px)' },
        },
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
      },
    },
  },
  plugins: [],
};

