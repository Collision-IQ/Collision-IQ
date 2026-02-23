import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

export default {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: "#07090D",
        card: "#0F1620",
        border: "#1B2633",
        text: "#E8EEF6",
        muted: "#9FB0C3",
        accent: "#D65B2A",
      },
    },
  },
  plugins: [typography],
} satisfies Config;
