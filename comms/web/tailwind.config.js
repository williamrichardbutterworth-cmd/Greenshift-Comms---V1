/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Exact Green Shift brand values, sampled from the logo.
      colors: {
        brand: {
          green: '#40A800',
          greenDark: '#318300',
          tint: '#F4FAEF',
          ink: '#2B2A2E',
          muted: '#6B6A70',
          line: '#E7E8E6',
          surface: '#FAFBFA',
        },
        up: '#C2410C',
        down: '#2E7D32',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(43,42,46,0.04), 0 8px 24px rgba(43,42,46,0.06)',
      },
    },
  },
  plugins: [],
};
