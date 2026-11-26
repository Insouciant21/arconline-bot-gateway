import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  base: "/admin",
  output: "static",
  outDir: "../dist/admin-ui",
  integrations: [react()],
  vite: {
    resolve: {
      alias: {
        "@": new URL("./src", import.meta.url).pathname,
      },
    },
  },
});
