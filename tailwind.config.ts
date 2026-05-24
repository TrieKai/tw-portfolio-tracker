import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./providers/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        page: "var(--page)",
        foreground: "var(--foreground)",
        muted: "var(--muted)",
        surface: {
          DEFAULT: "var(--surface)",
          raised: "var(--surface-raised)",
        },
        border: "var(--border)",
        accent: {
          DEFAULT: "var(--accent)",
          muted: "var(--accent-muted)",
          dim: "var(--accent-dim)",
        },
        gain: "var(--gain)",
        loss: "var(--loss)",
      },
      fontFamily: {
        sans: [
          "var(--font-noto-sans-tc)",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
