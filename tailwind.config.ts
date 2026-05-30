import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        bg: "var(--bg)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        line: "var(--line)",
        "line-bright": "var(--line-bright)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        amber: "var(--amber)",
        "amber-deep": "var(--amber-deep)",
        ok: "var(--ok)",
        warn: "var(--warn)",
        err: "var(--err)",
        sky: "var(--sky)",
      },
    },
  },
  plugins: [],
} satisfies Config;
