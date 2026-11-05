// 설치된 Claude Code CLI를 볼트 폴더에서 실행합니다.
// 로그인된 구독으로 돌아가므로 API 키가 필요 없습니다.

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { IS_WIN, findBin, toolEnv } from "./exec";
import { ClaudeEvent, StreamParser } from "./stream";

export interface RunOptions {
  claudePath: string;
  cwd: string;
  prompt: string;
  systemPrompt: string;
  model?: string;
  effort?: string;
  resume?: string | null;
  /** 볼트 밖에서 읽어도 되는 폴더 (프로젝트 폴더 등) */
  addDirs?: string[];
  /** git·gh 조회 명령 허용 (쓰기 명령은 막힘) */
  allowGitRead?: boolean;
  /** 웹 페이지 읽기 허용 (받은 링크 정리용) */
  allowWeb?: boolean;
  onEvent: (e: ClaudeEvent) => void;
}

// 조회만 허용. 그 밖의 명령은 --permission-prompts none 때문에 자동으로 거부됩니다.
const GIT_READ_RULES = [
  "Bash(git -C * log)", "Bash(git -C * log *)",
  "Bash(git -C * status)", "Bash(git -C * status *)",
  "Bash(git -C * diff)", "Bash(git -C * diff *)",
  "Bash(git -C * show *)",
  "Bash(git -C * branch --show-current)",
  "Bash(gh repo view *)", "Bash(gh repo list *)",
  "Bash(gh issue list *)", "Bash(gh issue view *)",
  "Bash(gh pr list *)", "Bash(gh pr view *)",
];
const GIT_READ_DENY = ["Bash(*--output*)", "Bash(*>*)"];

export interface RunHandle {
  stop(): void;
  done: Promise<void>;
}

export function findClaude(custom?: string): string | null {
  return findBin("claude", custom);
}

/**
 * 윈도우에서 npm으로 설치한 claude.cmd는 바로 spawn할 수 없으므로 (최신 Node는 .cmd 실행을 막음)
 * .cmd 안에 적힌 진짜 실행 파일(cli.js면 node로, .exe면 그대로)을 찾아 실행합니다.
 * (공식 설치 프로그램의 claude.exe는 그대로 실행)
 */
function command(claudePath: string, args: string[]): { cmd: string; args: string[] } {
  if (IS_WIN && /\.cmd$/i.test(claudePath)) {
    const dir = dirname(claudePath);
    const candidates: string[] = [];
    try {
      // npm이 만든 .cmd: "%dp0%\node_modules\...\cli.js" 또는 ...\claude.exe (node.exe 줄은 건너뜀)
      const shim = readFileSync(claudePath, "utf8");
      for (const m of shim.matchAll(/%~?dp0%?\\([^"%\r\n]+\.(?:js|exe))/gi)) {
        if (!/(^|\\)node\.exe$/i.test(m[1])) candidates.push(join(dir, m[1]));
      }
    } catch {
      /* 못 읽으면 기본 위치만 */
    }
    candidates.push(join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js"));
    for (const target of candidates) {
      if (!existsSync(target)) continue;
      if (/\.exe$/i.test(target)) return { cmd: target, args };
      const node = findBin("node");
      if (node) return { cmd: node, args: [target, ...args] };
    }
  }
  return { cmd: claudePath, args };
}

export function runClaude(o: RunOptions): RunHandle {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    // 읽기 전용: 파일 수정은 사이드바의 [적용] 버튼으로만
    "--tools", ["Read", "Glob", "Grep", o.allowGitRead ? "Bash" : "", o.allowWeb ? "WebFetch" : ""].filter(Boolean).join(","),
    "--permission-prompts", "none",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--append-system-prompt", o.systemPrompt,
  ];
  if (o.model) args.push("--model", o.model);
  if (o.effort) args.push("--effort", o.effort);
  if (o.resume) args.push("--resume", o.resume);
  const allow = [...(o.allowGitRead ? GIT_READ_RULES : []), ...(o.allowWeb ? ["WebFetch"] : [])];
  if (allow.length) args.push("--allowedTools", ...allow);
  if (o.allowGitRead) args.push("--disallowedTools", ...GIT_READ_DENY);
  const dirs = (o.addDirs ?? []).filter(Boolean);
  if (dirs.length) args.push("--add-dir", ...dirs);

  let stopped = false;
  let stderr = "";
  const parser = new StreamParser(o.onEvent);
  const c = command(o.claudePath, args);
  const child = spawn(c.cmd, c.args, { cwd: o.cwd, env: toolEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

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
    const c = command(claudePath, ["--version"]);
    const child = spawn(c.cmd, c.args, { env: toolEnv(), windowsHide: true });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`코드 ${code}`))));
  });
}
