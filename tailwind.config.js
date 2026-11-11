/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tide: {
          peak: "#ef4444",
          offpeak: "#10b981",
          panel: "#171b22",
        },
      },
    },
  },
  plugins: [],
};
