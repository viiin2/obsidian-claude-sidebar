// 빌드 결과를 옵시디언 볼트의 플러그인 폴더로 복사합니다. macOS·Windows 공통.
// 사용법: npm run install-vault [-- "볼트 경로"]   (생략하면 옵시디언에 등록된 볼트 중 열려 있던 것)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfgPath =
  process.platform === "win32"
    ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "obsidian", "obsidian.json")
    : process.platform === "darwin"
      ? join(homedir(), "Library/Application Support/obsidian/obsidian.json")
      : join(homedir(), ".config/obsidian/obsidian.json");

let vault = process.argv[2];
if (!vault) {
  const vaults = Object.values(JSON.parse(readFileSync(cfgPath, "utf8")).vaults ?? {});
  vault = (vaults.find((v) => v.open) ?? vaults[0])?.path;
}
if (!vault || !existsSync(join(vault, ".obsidian"))) {
  console.error(`볼트를 못 찾았어요: ${vault ?? "(없음)"}`);
  process.exit(1);
}

const dest = join(vault, ".obsidian", "plugins", "claude-sidebar");
mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css", "assistant.js"]) copyFileSync(join(root, f), join(dest, f));

// 켜진 플러그인 목록에 추가
const listPath = join(vault, ".obsidian", "community-plugins.json");
let list = [];
try {
  list = JSON.parse(readFileSync(listPath, "utf8"));
} catch {}
if (!list.includes("claude-sidebar")) writeFileSync(listPath, JSON.stringify([...list, "claude-sidebar"], null, 2));

console.log(`설치됨 → ${dest}\n옵시디언을 완전히 껐다가 다시 켜세요.`);
