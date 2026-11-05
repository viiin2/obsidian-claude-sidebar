import esbuild from "esbuild";
import builtins from "builtin-modules";

const mode = process.argv[2];

if (mode === "test") {
  // obsidian 없이 돌아가는 순수 로직만 node로 테스트
  await esbuild.build({
    entryPoints: ["src/segments.test.ts", "src/diff.test.ts", "src/stream.test.ts", "src/assistant/projects.test.ts", "src/assistant/officetext.test.ts", "src/assistant/agenda.test.ts", "src/assistant/routines.test.ts", "src/assistant/calendar.test.ts"],
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

// 비서 실행 파일 (옵시디언 없이 node로 돌아감: launchd가 매일 아침 실행)
const cli = {
  entryPoints: ["src/assistant/cli.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: "assistant.js",
  logLevel: "info",
};
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
  await esbuild.build(cli);
  process.exit(0);
} else {
  await ctx.watch();
  await (await esbuild.context(cli)).watch();
}
