// 외부 명령(git, gh, claude, osascript, launchctl) 실행 도우미.
// 옵시디언과 launchd는 터미널 PATH를 물려받지 않으므로 흔한 위치를 붙여 줍니다.

import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const HOME = homedir();
const EXTRA_PATH = [join(HOME, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

export function toolEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.PATH = [env.PATH ?? "", ...EXTRA_PATH].filter(Boolean).join(":");
  // 터미널의 Claude Code 안에서 실행돼도 중첩 실행으로 오인하지 않도록
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export function findBin(name: string, custom?: string): string | null {
  if (custom?.trim()) return existsSync(custom.trim()) ? custom.trim() : null;
  const extra = name === "claude" ? [join(HOME, ".claude/local/claude")] : [];
  return [...EXTRA_PATH.map((d) => join(d, name)), ...extra].find((p) => existsSync(p)) ?? null;
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
      { cwd: opts.cwd, env: toolEnv(), timeout: opts.timeout ?? 30000, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout), err: String(stderr || error?.message || "") }),
    );
  });
}
