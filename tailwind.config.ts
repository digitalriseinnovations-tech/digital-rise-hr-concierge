import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#f0f4fb",
          100: "#dbe4f3",
          500: "#0040A0",
          600: "#003080",
          700: "#002060",
          900: "#001440",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Playfair Display", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 10px 28px -12px rgba(15,23,42,0.10)",
        "card-hover": "0 2px 4px rgba(15,23,42,0.05), 0 20px 40px -16px rgba(0,64,160,0.18)",
        glow: "0 24px 64px -20px rgba(0,64,160,0.30)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #0040A0 0%, #002060 100%)",
        "brand-radial": "radial-gradient(1200px circle at 100% -10%, rgba(0,64,160,0.10), transparent 55%)",
      },
      keyframes: {
        "fade-up": { "0%": { opacity: "0", transform: "translateY(6px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        shimmer: { "0%": { backgroundPosition: "-468px 0" }, "100%": { backgroundPosition: "468px 0" } },
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out both",
        "fade-in": "fade-in 0.25s ease-out both",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
