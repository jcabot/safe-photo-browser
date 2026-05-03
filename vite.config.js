import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const serverPort = process.env.SERVER_PORT ?? process.env.PORT ?? "5174";
const serverTarget = `http://localhost:${serverPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": serverTarget,
      "/auth": serverTarget
    }
  }
});
