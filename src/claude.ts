// 설치된 Claude Code CLI를 볼트 폴더에서 실행합니다.
// 로그인된 구독으로 돌아가므로 API 키가 필요 없습니다.

import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { ClaudeEvent, StreamParser } from "./stream";

export interface RunOptions {
  claudePath: string;
  cwd: string;
  prompt: string;
  systemPrompt: string;
  model?: string;
  effort?: string;
  resume?: string | null;
  onEvent: (e: ClaudeEvent) => void;
}

export interface RunHandle {
  stop(): void;
  done: Promise<void>;
}

const CANDIDATES = [
  join(homedir(), ".local/bin/claude"),
  join(homedir(), ".claude/local/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
];

export function findClaude(custom?: string): string | null {
  if (custom?.trim()) return existsSync(custom.trim()) ? custom.trim() : null;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // 옵시디언은 터미널 PATH를 물려받지 않으므로 흔한 위치를 붙여 줍니다.
  const extra = [join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  env.PATH = [env.PATH ?? "", ...extra].filter(Boolean).join(":");
  // 터미널의 Claude Code 안에서 옵시디언을 켰을 때 중첩 실행으로 오인하지 않도록
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

export function runClaude(o: RunOptions): RunHandle {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    // 읽기 전용: 파일 수정은 사이드바의 [적용] 버튼으로만
    "--tools", "Read,Glob,Grep",
    "--permission-prompts", "none",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--append-system-prompt", o.systemPrompt,
  ];
  if (o.model) args.push("--model", o.model);
  if (o.effort) args.push("--effort", o.effort);
  if (o.resume) args.push("--resume", o.resume);

  let stopped = false;
  let stderr = "";
  const parser = new StreamParser(o.onEvent);
  const child = spawn(o.claudePath, args, { cwd: o.cwd, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c: string) => parser.push(c));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c: string) => {
    stderr = (stderr + c).slice(-4000);
  });
  child.stdin.on("error", () => undefined);
  child.stdin.end(o.prompt);

  const done = new Promise<void>((resolve) => {
    let settled = false;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      parser.end();
      if (!parser.gotResult) o.onEvent({ type: "result", ok: false, text });
      resolve();
    };
    child.on("error", (err) => finish(`Claude를 실행하지 못했어요: ${err.message}`));
    child.on("close", (code) => finish(stopped ? "멈췄어요" : stderr.trim() || `Claude가 종료됐어요 (코드 ${code})`));
  });

  return {
    stop() {
      stopped = true;
      child.kill("SIGTERM");
    },
    done,
  };
}

/** 설정 화면의 "연결 확인" 버튼용 */
export function claudeVersion(claudePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(claudePath, ["--version"], { env: childEnv() });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`코드 ${code}`))));
  });
}
