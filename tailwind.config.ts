import type { Config } from "tailwindcss";

function themeColor(token: string) {
  return `color-mix(in srgb, var(--${token}) calc(<alpha-value> * 100%), transparent)`;
}

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
        page: themeColor("page"),
        foreground: themeColor("foreground"),
        muted: themeColor("muted"),
        surface: {
          DEFAULT: themeColor("surface"),
          raised: themeColor("surface-raised"),
        },
        border: themeColor("border"),
        accent: {
          DEFAULT: themeColor("accent"),
          muted: themeColor("accent-muted"),
          dim: themeColor("accent-dim"),
          button: themeColor("accent-button"),
        },
        gain: themeColor("gain"),
        loss: themeColor("loss"),
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
