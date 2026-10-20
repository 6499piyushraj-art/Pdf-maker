import { defineConfig } from "vite";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

export default defineConfig({
  // Vercel serves at the domain root; GitHub project Pages uses /Pdf-maker/.
  base: isGitHubPages ? "/Pdf-maker/" : "/",
  build: {
    target: "es2022",
    sourcemap: false
  },
  server: {
    host: "0.0.0.0"
  }
});
