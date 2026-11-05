// 외부 명령(git, gh, claude, node 등) 실행 도우미. macOS와 Windows를 함께 다룹니다.
// 옵시디언(맥)과 예약 실행은 터미널 PATH를 물려받지 않으므로 흔한 설치 위치를 붙여 줍니다.

import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { delimiter, join } from "path";

export const HOME = homedir();
export const IS_WIN = process.platform === "win32";
export const IS_MAC = process.platform === "darwin";

function extraDirs(): string[] {
  if (IS_WIN) {
    const pf = process.env.ProgramFiles ?? "C:\\Program Files";
    const appData = process.env.APPDATA ?? join(HOME, "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA ?? join(HOME, "AppData", "Local");
    return [
      join(HOME, ".local", "bin"),
      join(appData, "npm"),
      join(pf, "nodejs"),
      join(pf, "GitHub CLI"),
      join(pf, "Git", "cmd"),
      join(local, "Programs", "claude"),
      join(HOME, "scoop", "shims"),
    ];
  }
  return [join(HOME, ".local/bin"), join(HOME, ".claude/local"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
}

function pathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
}

export function toolEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const key = pathKey(env);
  env[key] = [env[key] ?? "", ...extraDirs()].filter(Boolean).join(delimiter);
  // 터미널의 Claude Code 안에서 실행돼도 중첩 실행으로 오인하지 않도록
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export function findBin(name: string, custom?: string): string | null {
  if (custom?.trim()) return existsSync(custom.trim()) ? custom.trim() : null;
  const env = process.env;
  const dirs = [...(env[pathKey(env)] ?? "").split(delimiter), ...extraDirs()].filter(Boolean);
  const exts = IS_WIN ? [".exe", ".cmd"] : [""];
  for (const d of dirs) {
    for (const e of exts) {
      const p = join(d, name + e);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export interface ExecResult {
  ok: boolean;
  out: string;
  err: string;
}

export function exec(cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, env: toolEnv(), timeout: opts.timeout ?? 30000, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout), err: String(stderr || error?.message || "") }),
    );
  });
}
