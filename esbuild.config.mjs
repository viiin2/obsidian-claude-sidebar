import esbuild from "esbuild";
import builtins from "builtin-modules";

const mode = process.argv[2];

if (mode === "test") {
  // obsidian 없이 돌아가는 순수 로직만 node로 테스트
  await esbuild.build({
    entryPoints: ["src/segments.test.ts", "src/diff.test.ts", "src/stream.test.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outdir: "test-out",
    logLevel: "warning",
  });
  process.exit(0);
}

const prod = mode === "production";
const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});
if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
