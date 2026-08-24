import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  sourcemap: true,
  // `pg` is an optionalDependency loaded through a dynamic import, so it must
  // stay external. Bundling it rewrites `import("pg")` into a generated chunk,
  // which defeats the whole point twice over: the ~180KB driver ends up in
  // every install including the ones that will never load it, and the runtime
  // check for "is pg installed?" can no longer answer honestly, because the
  // import no longer resolves against node_modules at all.
  external: ["pg"],
  clean: true,
  dts: false,
});
