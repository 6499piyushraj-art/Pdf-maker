import { defineConfig } from "vite";

export default defineConfig({
  // This app is deployed at the domain root on Vercel and uses Vercel serverless /api routes.
  base: "/",
  build: {
    target: "es2022",
    sourcemap: false
  },
  server: {
    host: "0.0.0.0"
  }
});
