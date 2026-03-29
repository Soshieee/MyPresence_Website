import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef9f6",
          100: "#d7f1ea",
          500: "#1f8f77",
          600: "#19725f",
          700: "#14594a"
        }
      }
    }
  },
  plugins: []
};

export default config;
