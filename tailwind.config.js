/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/**/*.{html,ts}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Deep, near-black canvas with subtle blue undertone
        ink: {
          900: "#08090d",
          800: "#0c0e14",
          700: "#12141c",
          600: "#181b25",
          500: "#20242f",
          400: "#2a2f3d",
        },
        veil: {
          // Accent is CSS-variable driven so the theme engine can override it live
          accent: "var(--veil-accent)",
          "accent-soft": "var(--veil-accent-soft)",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
      },
      backdropBlur: {
        xs: "2px",
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0, 0, 0, 0.45)",
        "glass-sm": "0 2px 12px rgba(0, 0, 0, 0.35)",
        glow: "0 0 24px -4px var(--veil-accent)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};
