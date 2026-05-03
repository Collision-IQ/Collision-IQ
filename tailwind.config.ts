import type { Config } from "tailwindcss";
import type { PluginAPI } from "tailwindcss/plugin";
import typography from "@tailwindcss/typography";

export default {
  darkMode: "class",

  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],

  theme: {
  extend: {
    colors: {
      background: "var(--background)",
      foreground: "var(--foreground)",
      card: "var(--card)",
      "card-foreground": "var(--card-foreground)",
      muted: "var(--muted)",
      "muted-foreground": "var(--muted-foreground)",
      border: "var(--border)",
      input: "var(--input)",
      ring: "var(--ring)",
      bg: "var(--color-bg)",
      text: "var(--color-text)",
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

  plugins: [
    typography,
    ({ addUtilities }: PluginAPI) => {
      addUtilities({
        ".color-scheme-dark": {
          colorScheme: "dark",
        },
      });
    },
  ],
} satisfies Config;
