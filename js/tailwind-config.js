// Tailwind Play CDN theme extensions (kept external so the CSP needs no unsafe-inline).
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          950: '#042f2e',
        }
      }
    }
  }
}
