import { readFile } from "node:fs/promises";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "license-notices",
      async generateBundle() {
        for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
          this.emitFile({
            type: "asset",
            fileName: name,
            source: await readFile(new URL(name, import.meta.url), "utf8"),
          });
        }
      },
    },
  ],
});
