/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Wide-desktop breakpoint — most layout caps at xl(1280) today and
      // sprawls past it; 3xl lets the dashboard/studio use the extra width.
      screens: { '3xl': '1792px' },
      // One content-width system (replaces ad-hoc max-w-6xl / max-w-[1800px]).
      maxWidth: { content: '1500px', wide: '1760px' },
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
