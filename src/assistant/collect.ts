// GitHub과 이 맥의 git 폴더에서 "최근에 손댄 프로젝트"를 모읍니다.
// Claude 없이 정해진 명령으로만 모으므로 빠르고 결과가 매번 같습니다.

import { readdirSync, statSync } from "fs";
import { basename, join } from "path";
import { exec, findBin } from "../exec";
import { AssistantConfig, expandHome } from "./config";
import { ymd } from "./datefmt";

export interface Commit {
  date: string;
  msg: string;
  author: string;
  mine: boolean;
}

export interface Issue {
  number: number;
  title: string;
  pr: boolean;
}

export interface Project {
  id: string;
  /** owner/name */
  repo?: string;
  url?: string;
  localPath?: string;
  description?: string;
  language?: string;
  /** 내 저장소가 아니면 true (팀·조직) */
  team: boolean;
  lastActivity: string;
  branch?: string;
  /** 저장 안 한(커밋 안 한) 파일 수 */
  dirty?: number;
  /** 올리지 않은 커밋 수 */
  unpushed?: number;
  commits: Commit[];
  weekCommits: number;
  myCommits: number;
  issues: Issue[];
}

export interface Snapshot {
  at: string;
  me: string;
  days: number;
  projects: Project[];
  errors: string[];
}

const MAX_COMMITS = 20;
const SKIP_DIRS = new Set(["node_modules", "Library", "Applications", "AppData", "dist", "build", "venv", ".venv", "$RECYCLE.BIN"]);

/* eslint-disable @typescript-eslint/no-explicit-any */

async function gh(gh: string, path: string): Promise<any> {
  const r = await exec(gh, ["api", path], { timeout: 20000 });
  if (!r.ok) throw new Error(`gh api ${path}: ${r.err.trim().split("\n")[0]}`);
  return JSON.parse(r.out);
}

function findGitDirs(root: string, depth: number, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  if (entries.includes(".git")) {
    out.push(root);
    return;
  }
  if (depth <= 0) return;
  for (const name of entries) {
    if (name.startsWith(".") || name.endsWith(".app") || SKIP_DIRS.has(name)) continue;
    const p = join(root, name);
    try {
      if (statSync(p).isDirectory()) findGitDirs(p, depth - 1, out);
    } catch {
      /* 권한 없음 등 */
    }
  }
}

function repoFromRemote(url: string): string | undefined {
  const m = url.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return m?.[1];
}

interface Local {
  path: string;
  repo?: string;
  last: string;
  branch: string;
  dirty: number;
  unpushed?: number;
  commits: Commit[];
}

async function readLocal(dir: string, since: string, me: string, myEmail: string): Promise<Local | null> {
  const git = (...a: string[]) => exec("git", ["-C", dir, ...a], { timeout: 15000 });
  const last = await git("log", "-1", "--format=%cI");
  if (!last.ok || !last.out.trim()) return null;
  const lastDate = last.out.trim().slice(0, 10);
  if (lastDate < since) return null;

  const [branch, status, remote, upstream, log] = await Promise.all([
    git("branch", "--show-current"),
    git("status", "--porcelain"),
    git("remote", "get-url", "origin"),
    git("rev-list", "--count", "@{u}..HEAD"),
    git("log", `--since=${since}`, `-n${MAX_COMMITS}`, "--format=%cI%x09%an%x09%ae%x09%s"),
  ]);
  const commits = log.out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [date, name, email, ...msg] = l.split("\t");
      return { date: date.slice(0, 10), msg: msg.join("\t"), author: name, mine: email === myEmail || name === me };
    });
  return {
    path: dir,
    repo: remote.ok ? repoFromRemote(remote.out) : undefined,
    last: lastDate,
    branch: branch.out.trim(),
    dirty: status.out.split("\n").filter(Boolean).length,
    unpushed: upstream.ok ? Number(upstream.out.trim()) || 0 : undefined,
    commits,
  };
}

function weekCount(commits: Commit[], today: Date): number {
  const weekAgo = ymd(new Date(today.getTime() - 7 * 86400000));
  return commits.filter((c) => c.date > weekAgo).length;
}

export async function collect(cfg: AssistantConfig, now = new Date()): Promise<Snapshot> {
  const errors: string[] = [];
  const since = ymd(new Date(now.getTime() - cfg.days * 86400000));
  const teamSince = ymd(new Date(now.getTime() - 7 * 86400000));
  const myEmail = (await exec("git", ["config", "--global", "user.email"])).out.trim();

  // ── GitHub ──
  const ghBin = findBin("gh");
  let me = "";
  let repos: any[] = [];
  if (!ghBin) errors.push("gh(GitHub CLI)가 없어 GitHub은 건너뜀");
  else {
    try {
      me = (await gh(ghBin, "user")).login;
      const list = await gh(ghBin, "user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100");
      repos = list.filter((r: any) => !r.archived && (r.pushed_at ?? "").slice(0, 10) >= since);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (!me) me = (await exec("git", ["config", "--global", "user.name"])).out.trim();

  // ── 이 맥의 폴더 ──
  const dirs: string[] = [];
  for (const root of cfg.scanRoots) findGitDirs(expandHome(root), 3, dirs);
  const locals = (await Promise.all(dirs.map((d) => readLocal(d, since, me, myEmail)))).filter((x): x is Local => !!x);
  const localByRepo = new Map(locals.filter((l) => l.repo).map((l) => [l.repo!.toLowerCase(), l]));

  const projects: Project[] = [];
  const usedLocal = new Set<Local>();

  await Promise.all(
    repos.map(async (r) => {
      const full: string = r.full_name;
      const local = localByRepo.get(full.toLowerCase());
      const team = r.owner?.login !== me;
      let commits: Commit[] = [];
      if (local) {
        commits = local.commits;
        usedLocal.add(local);
      } else {
        try {
          const list = await gh(ghBin!, `repos/${full}/commits?since=${since}T00:00:00Z&per_page=${MAX_COMMITS}`);
          commits = list.map((c: any) => ({
            date: (c.commit?.author?.date ?? "").slice(0, 10),
            msg: (c.commit?.message ?? "").split("\n")[0],
            author: c.author?.login ?? c.commit?.author?.name ?? "",
            mine: c.author?.login === me,
          }));
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
      const myCommits = commits.filter((c) => c.mine).length;
      const pushed = (r.pushed_at ?? "").slice(0, 10);
      // 내가 손댄 것, 또는 이번 주에 팀이 움직인 저장소만
      if (!local && myCommits === 0 && !(team && pushed >= teamSince)) return;

      let issues: Issue[] = [];
      if (r.open_issues_count > 0) {
        try {
          const list = await gh(ghBin!, `repos/${full}/issues?state=open&per_page=10`);
          issues = list.map((i: any) => ({ number: i.number, title: i.title, pr: !!i.pull_request }));
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
      const myLast = commits.find((c) => c.mine)?.date ?? "";
      projects.push({
        id: r.name,
        repo: full,
        url: r.html_url,
        localPath: local?.path,
        description: r.description ?? undefined,
        language: r.language ?? undefined,
        team,
        lastActivity: [local?.last ?? "", myLast, team ? pushed : ""].sort().pop() || pushed,
        branch: local?.branch,
        dirty: local?.dirty,
        unpushed: local?.unpushed,
        commits,
        weekCommits: weekCount(commits, now),
        myCommits,
        issues,
      });
    }),
  );

  // GitHub에 없거나 못 찾은 로컬 폴더
  for (const l of locals) {
    if (usedLocal.has(l)) continue;
    projects.push({
      id: l.repo ? l.repo.split("/")[1] : basename(l.path),
      repo: l.repo,
      localPath: l.path,
      team: !!l.repo && l.repo.split("/")[0] !== me,
      lastActivity: l.last,
      branch: l.branch,
      dirty: l.dirty,
      unpushed: l.unpushed,
      commits: l.commits,
      weekCommits: weekCount(l.commits, now),
      myCommits: l.commits.filter((c) => c.mine).length,
      issues: [],
    });
  }

  // 같은 이름이 둘이면 "이름 (소유자)"로 구분
  const count = new Map<string, number>();
  projects.forEach((p) => count.set(p.id.toLowerCase(), (count.get(p.id.toLowerCase()) ?? 0) + 1));
  for (const p of projects) {
    if ((count.get(p.id.toLowerCase()) ?? 0) > 1 && p.repo) p.id = `${p.id} (${p.repo.split("/")[0]})`;
  }

  projects.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return { at: now.toISOString(), me, days: cfg.days, projects, errors };
}
