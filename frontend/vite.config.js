import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true, // lets phones on the same Wi-Fi open the site (for QR scanning)
    allowedHosts: [
      "bobsled-shorter-unrigged.ngrok-free.dev",
      ".ngrok-free.dev",
      ".ngrok-free.app",
    ],
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});