#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function git(args, cwd, allowFailure = false) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = error?.stderr?.toString().trim() || error?.message || "git command failed";
    throw new Error(`git ${args.join(" ")}: ${detail}`);
  }
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function lines(value) {
  return value ? value.split("\n").map((item) => item.trim()).filter(Boolean) : [];
}

function changedFiles(from, to, cwd) {
  return new Set(lines(git(["diff", "--name-only", `${from}..${to}`], cwd)));
}

function dirtyFiles(cwd) {
  return new Set(lines(git(["status", "--porcelain=v1", "--untracked-files=all"], cwd)).map((row) => {
    const raw = row.slice(3);
    return raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
  }));
}

function intersection(left, right) {
  return [...left].filter((value) => right.has(value)).sort();
}

function worktrees(cwd) {
  const result = [];
  let current = null;
  for (const row of git(["worktree", "list", "--porcelain"], cwd).split("\n")) {
    if (row.startsWith("worktree ")) {
      if (current) result.push(current);
      current = { path: row.slice("worktree ".length), branch: null, prunable: false };
    } else if (current && row.startsWith("branch ")) {
      current.branch = row.slice("branch refs/heads/".length);
    } else if (current && row.startsWith("prunable")) {
      current.prunable = true;
    }
  }
  if (current) result.push(current);
  return result;
}

function fail(findings) {
  console.error("\nIntegration safety FAILED:\n");
  for (const finding of findings) console.error(`- ${finding}`);
  console.error("\nUse a fresh worktree from the latest main, reconcile every overlap, then rerun this check.");
  process.exit(1);
}

const root = git(["rev-parse", "--show-toplevel"], process.cwd());
const branch = git(["branch", "--show-current"], root);
const head = git(["rev-parse", "HEAD"], root);
const baseInput = argument("base-sha") ?? argument("base-ref") ?? "origin/main";
const base = git(["rev-parse", `${baseInput}^{commit}`], root, true);
const findings = [];

if (!branch || branch === "main" || branch === "master") {
  findings.push(`candidate branch is ${branch || "detached"}; production work requires a dedicated codex/* branch`);
}
if (!base) {
  findings.push(`cannot resolve production base ${baseInput}; fetch or resolve the latest remote main first`);
}
if (!flag("allow-dirty")) {
  const dirty = dirtyFiles(root);
  if (dirty.size > 0) findings.push(`candidate worktree is dirty (${[...dirty].slice(0, 8).join(", ")}${dirty.size > 8 ? ", …" : ""})`);
}

if (base) {
  const containsBase = git(["merge-base", "--is-ancestor", base, head], root, true) !== null;
  if (!containsBase) {
    const behind = git(["rev-list", "--count", `${head}..${base}`], root, true) ?? "unknown";
    findings.push(`candidate does not contain latest production base ${base.slice(0, 12)} (${behind} base commit(s) missing)`);
  }

  if (!flag("skip-worktree-overlap")) {
    const candidateFiles = changedFiles(base, head, root);
    const currentPath = path.resolve(root);
    for (const worktree of worktrees(root)) {
      if (path.resolve(worktree.path) === currentPath) continue;
      if (worktree.prunable || !existsSync(worktree.path)) continue;
      const otherDirty = dirtyFiles(worktree.path);
      const dirtyOverlap = intersection(candidateFiles, otherDirty);
      if (dirtyOverlap.length > 0) {
        findings.push(`${worktree.branch ?? worktree.path} has overlapping uncommitted files: ${dirtyOverlap.join(", ")}`);
      }
    }
  }
}

if (findings.length > 0) fail(findings);

console.log(`Integration safety passed: ${branch} @ ${head.slice(0, 12)} contains ${baseInput} @ ${base.slice(0, 12)}.`);
