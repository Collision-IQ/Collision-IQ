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
      danger: "#EF4444",
      warning: "#F59E0B",
      success: "#10B981",
    },

    fontFamily: {
      sans: ["Inter", "system-ui", "sans-serif"],
    },

    boxShadow: {
      panel: "0 10px 40px rgba(0,0,0,0.45)",
    },

    borderRadius: {
      xl: "14px",
    },

    backdropBlur: {
      xs: "2px",
    },

    /* ADD THIS BLOCK */

    backgroundColor: {
      glass: "rgba(255,255,255,0.05)",
    },

    borderColor: {
      glass: "rgba(255,255,255,0.10)",
    },

  },
},

  plugins: [typography],
} satisfies Config;