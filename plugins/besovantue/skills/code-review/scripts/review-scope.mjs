#!/usr/bin/env node
// Deterministic scope for a code change, mechanical checks, and code-review's conditional reviewers.
// Usage (from the repository root): node review-scope.mjs [--base <rev>] [-- <path>...]
//   The change is the working tree (staged, unstaged and untracked) against merge-base(<base>, HEAD); default base HEAD,
//   i.e. uncommitted changes. `--base main` reviews a whole branch plus whatever is uncommitted on it. Git is read-only.
//   Prints JSON { base, mergeBase, files, errors, warnings, triggers } and exits 0; exit 2 = usage/setup error.
//   files    → reviewable files ({path, status, from?, additions, deletions, untracked}); skipped ones are in warnings.
//   errors   → each becomes a finding (reviewer review-scope, Conf 100, important).
//   warnings → context handed to every reviewer, never findings.
//   triggers → { reviewer: [reasons] }; a conditional reviewer runs when its list is non-empty.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { skip, reviewers } = JSON.parse(fs.readFileSync(path.resolve(HERE, '../references/triggers.json'), 'utf8'));
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const LARGE_DIFF_LINES = 2000;

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
const lines = (s) => s.split('\n').filter(Boolean);

// --- arguments ---
const argv = process.argv.slice(2);
const dd = argv.indexOf('--');
const opts = dd >= 0 ? argv.slice(0, dd) : argv;
const paths = dd >= 0 ? argv.slice(dd + 1) : [];
const bi = opts.indexOf('--base');
const base = bi >= 0 ? opts[bi + 1] : 'HEAD';
const extra = opts.filter((_, i) => bi < 0 || (i !== bi && i !== bi + 1));
if (!base || extra.length) fail('usage: review-scope.mjs [--base <rev>] [-- <path>...]');

// --- resolve the diff base ---
try {
  if (path.resolve(git('rev-parse', '--show-toplevel').trim()) !== path.resolve(process.cwd())) fail('run from the repository root');
} catch {
  fail('not a git repository — code-review needs git to know what changed');
}
const hasHead = (() => {
  try {
    git('rev-parse', '--verify', '--quiet', 'HEAD');
    return true;
  } catch {
    return false;
  }
})();
let mergeBase;
if (!hasHead) mergeBase = EMPTY_TREE; // no commits yet: everything is new
else {
  try {
    mergeBase = git('merge-base', base, 'HEAD').trim();
  } catch {
    fail(`cannot find a merge base between "${base}" and HEAD — is "${base}" a valid revision?`);
  }
}

// --- what changed ---
const warnings = [];
const errors = [];
const files = [];
const byPath = new Map();
for (const l of lines(git('diff', '--name-status', '-M', mergeBase, '--', ...paths))) {
  const [st, a, b] = l.split('\t');
  const f = { path: b ?? a, status: st[0], untracked: false, additions: 0, deletions: 0 };
  if (b) f.from = a;
  byPath.set(f.path, f);
}
for (const p of lines(git('ls-files', '--others', '--exclude-standard', '--', ...paths))) {
  byPath.set(p, { path: p, status: 'A', untracked: true, additions: 0, deletions: 0 });
}
for (const l of lines(git('diff', '--numstat', '-M', mergeBase, '--', ...paths))) {
  const [add, del, ...rest] = l.split('\t');
  const p = rest.join('\t').replace(/^(.*)\{(.*) => (.*)\}(.*)$/, '$1$3$4').replace(/^.* => /, '');
  const f = byPath.get(p);
  if (!f) continue;
  if (add === '-') f.binary = true;
  else Object.assign(f, { additions: Number(add), deletions: Number(del) });
}

for (const f of byPath.values()) {
  if (f.untracked && fs.readFileSync(f.path).subarray(0, 8000).includes(0)) f.binary = true;
}
const skipped = [];
for (const f of byPath.values()) {
  const reason = f.binary ? 'binary' : skip.pathPatterns.find((re) => new RegExp(re, 'iu').test(f.path));
  if (reason) skipped.push(`${f.path} (${f.binary ? 'binary' : 'lockfile/generated'})`);
  else files.push(f);
}
if (skipped.length) warnings.push(`not reviewed: ${skipped.join(', ')}`);
if (!byPath.size) warnings.push(`no changes against ${hasHead ? base : 'the empty tree'}${paths.length ? ` in ${paths.join(' ')}` : ''}`);

// --- added lines: mechanical checks and content triggers ---
const added = []; // { path, line, text }
const reviewable = files.filter((f) => !f.untracked && f.status !== 'D').map((f) => f.path);
if (reviewable.length) {
  let cur = null;
  let n = 0;
  for (const l of git('diff', '-U0', '--no-color', '--no-ext-diff', '-M', mergeBase, '--', ...reviewable).split('\n')) {
    if (l.startsWith('+++ ')) cur = l === '+++ /dev/null' ? null : l.slice(6);
    else if (l.startsWith('@@')) n = Number(/\+(\d+)/.exec(l)?.[1] ?? 0);
    else if (cur && l.startsWith('+')) added.push({ path: cur, line: n++, text: l.slice(1) });
  }
}
for (const f of files.filter((x) => x.untracked)) {
  const all = fs.readFileSync(f.path, 'utf8').replace(/\n$/, '').split('\n');
  f.additions = all.length;
  all.forEach((t, i) => added.push({ path: f.path, line: i + 1, text: t }));
}

const CHECKS = [
  [/^(<{7}|>{7})( |$)|^={7}$/, 'merge conflict marker left in the file'],
  [/\b(describe|it|test|context)\.only\(|\b(fdescribe|fit)\(/, 'focused test (.only / fdescribe / fit) skips the rest of the suite'],
];
for (const a of added) for (const [re, msg] of CHECKS) if (re.test(a.text)) errors.push(`${a.path}:${a.line}: ${msg}`);

const total = files.reduce((s, f) => s + f.additions + f.deletions, 0);
if (total > LARGE_DIFF_LINES)
  warnings.push(`large change: ${total} changed lines in ${files.length} files — consider narrowing with -- <path>; reviewers prioritize logic over boilerplate`);

// --- conditional reviewers ---
const triggers = { history: [] };
for (const f of files) if (['M', 'D', 'R'].includes(f.status)) triggers.history.push(`${f.path} ${f.status === 'R' ? `renamed from ${f.from}` : f.status}`);
for (const [name, t] of Object.entries(reviewers)) {
  const reasons = [];
  for (const f of files) {
    const hit = t.pathPatterns.find((re) => new RegExp(re, 'iu').test(f.path));
    if (hit) reasons.push(`${f.path} ~ /${hit}/`);
  }
  for (const re of t.contentPatterns) {
    const rx = new RegExp(re, 'iu');
    const hit = added.find((a) => rx.test(a.text));
    if (hit) reasons.push(`${hit.path}:${hit.line} ~ /${re}/`);
  }
  triggers[name] = reasons;
}

console.log(JSON.stringify({ base: hasHead ? base : null, mergeBase, files, errors, warnings, triggers }, null, 2));
