import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding, Severity } from "./check-ci.js";
import type { AgentStandards } from "./standards.js";

const exec = promisify(execCb);

const DEFAULTS = {
  required_branches: ["main", "dev"],
  default_branch: "main",
  feature_branch_pattern: "^(feat|fix|chore|docs|test|ci|refactor)/[a-z0-9._-]+$",
  mode: "soft" as const,
};

interface GitRunOk { ok: true; out: string }
interface GitRunErr { ok: false; err: string }
type GitRun = GitRunOk | GitRunErr;

async function git(args: string[], cwd: string): Promise<GitRun> {
  try {
    const { stdout } = await exec(`git ${args.map((a) => JSON.stringify(a)).join(" ")}`, {
      cwd,
      timeout: 10_000,
    });
    return { ok: true, out: stdout.trim() };
  } catch (err) {
    return { ok: false, err: (err as Error).message };
  }
}

export async function checkBranching(
  repoRoot: string,
  standards: AgentStandards
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const policy = {
    required_branches: standards.branching?.required_branches ?? DEFAULTS.required_branches,
    default_branch: standards.branching?.default_branch ?? DEFAULTS.default_branch,
    feature_branch_pattern: standards.branching?.feature_branch_pattern ?? DEFAULTS.feature_branch_pattern,
    mode: standards.branching?.mode ?? DEFAULTS.mode,
  };

  // Severity for "real violations": warn in soft mode, error in hard mode.
  const violation: Severity = policy.mode === "hard" ? "error" : "warn";

  // Confirm we're inside a git work tree.
  const insideGit = await git(["rev-parse", "--is-inside-work-tree"], repoRoot);
  if (!insideGit.ok || insideGit.out !== "true") {
    findings.push({
      severity: "error",
      code: "BRANCH_NOT_A_GIT_REPO",
      message: `${repoRoot} is not a git repository.`,
    });
    return findings;
  }

  // Check current local branch name against the feature pattern.
  const currentBranch = await git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
  if (currentBranch.ok && currentBranch.out !== "HEAD") {
    const name = currentBranch.out;
    const isProtected = policy.required_branches.includes(name);
    if (!isProtected && policy.feature_branch_pattern) {
      const re = new RegExp(policy.feature_branch_pattern);
      if (!re.test(name)) {
        findings.push({
          severity: violation,
          code: "BRANCH_NAME_VIOLATES_PATTERN",
          message: `Current branch '${name}' does not match the feature-branch pattern ${policy.feature_branch_pattern}.`,
          fix: `Rename the branch to match, e.g. 'feat/your-thing': git branch -m ${name} feat/${name.replace(/[^a-z0-9._-]+/gi, "-")}`,
        });
      }
    }
  }

  // Has the repo got a remote? If not, we can't check required branches — degrade gracefully.
  const remotes = await git(["remote"], repoRoot);
  const hasRemote = remotes.ok && remotes.out.length > 0;
  if (!hasRemote) {
    findings.push({
      severity: "warn",
      code: "BRANCH_NO_REMOTE",
      message: "No git remote configured — branching policy can only be checked locally.",
      fix: "Add a remote: git remote add origin <url>",
    });
    // Fall through to local-branch checks.
  }

  // Refresh remote refs (best-effort). If we have a remote but fetch fails (offline,
  // auth), we degrade to checking local branches and emit a warning.
  let useRemote = hasRemote;
  if (hasRemote) {
    const fetched = await git(["fetch", "--prune", "origin"], repoRoot);
    if (!fetched.ok) {
      useRemote = false;
      findings.push({
        severity: "warn",
        code: "BRANCH_FETCH_FAILED",
        message: `Could not fetch from origin (offline or auth issue) — falling back to local branches. Detail: ${fetched.err.split("\n")[0]}`,
      });
    }
  }

  // Resolve the set of branches we'll check against.
  const branchListArgs = useRemote
    ? ["branch", "-r", "--format=%(refname:short)"]
    : ["branch", "--format=%(refname:short)"];
  const branchList = await git(branchListArgs, repoRoot);
  if (!branchList.ok) {
    findings.push({
      severity: "error",
      code: "BRANCH_LIST_FAILED",
      message: `Could not list branches: ${branchList.err.split("\n")[0]}`,
    });
    return findings;
  }
  const knownBranches = new Set(
    branchList.out
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean)
      .map((b) => (useRemote ? b.replace(/^origin\//, "") : b))
      .filter((b) => b !== "HEAD")
  );

  for (const required of policy.required_branches) {
    if (!knownBranches.has(required)) {
      findings.push({
        severity: violation,
        code: "BRANCH_REQUIRED_MISSING",
        message: `Required branch '${required}' does not exist${useRemote ? " on origin" : " locally"}.`,
        fix: useRemote
          ? `git branch ${required} ${policy.default_branch} && git push -u origin ${required}`
          : `git branch ${required}`,
      });
    }
  }

  // Default branch sanity: it should exist (covered above) but also should be the default.
  // We can't check the GitHub-side default-branch setting without `gh api` and a token, so
  // we just confirm the local HEAD of origin (if available) matches.
  if (useRemote) {
    const headRef = await git(["symbolic-ref", "refs/remotes/origin/HEAD"], repoRoot);
    if (headRef.ok) {
      const remoteDefault = headRef.out.replace(/^refs\/remotes\/origin\//, "");
      if (remoteDefault !== policy.default_branch) {
        findings.push({
          severity: "warn",
          code: "BRANCH_DEFAULT_MISMATCH",
          message: `Remote default branch is '${remoteDefault}' but standards declare '${policy.default_branch}'.`,
          fix: `Update the GitHub repo's default-branch setting to '${policy.default_branch}'.`,
        });
      }
    }
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      code: "BRANCH_OK",
      message: `Branching policy satisfied (required: ${policy.required_branches.join(", ")}; default: ${policy.default_branch}).`,
    });
  }

  return findings;
}
