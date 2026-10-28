#!/usr/bin/env node
// Deterministic scope check for one implemented task, and impl-review's conditional reviewers.
// Usage: node review-scope.mjs <cdocs/plans/folder> <T01> [--base <rev>]
//   Reads the task, context.md and the implementation record cdocs/reports/<folder>/<T01>.md written by `implement`,
//   and compares the record against the task's F rows and against `git diff <base>` (read-only git; default base HEAD).
//   Prints JSON { task, base, record, files, errors, warnings, triggers } and exits 0; exit 2 = usage/setup error.
//   errors   → each becomes a finding (reviewer review-scope, Conf 100, important, auto).
//   warnings → context handed to every reviewer, never findings.
//   triggers → { reviewer: [reasons] }; a conditional reviewer runs when its list is non-empty.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { splitFrontmatter, asList, tableOf } from '../../plan-review/scripts/plan-md.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../spec-plan/references/contract.json'), 'utf8'));
const { reviewers: planTriggers } = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../plan-review/references/triggers.json'), 'utf8'));

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const unquote = (s) => s.replace(/`/g, '').trim();

const argv = process.argv.slice(2);
const bi = argv.indexOf('--base');
const base = bi >= 0 ? argv[bi + 1] : 'HEAD';
const [arg, taskArg] = argv.filter((a, i) => !a.startsWith('--') && (bi < 0 || i !== bi + 1));
if (!arg || !/^T\d{2}$/.test(taskArg ?? '') || !base) fail('usage: review-scope.mjs <cdocs/plans/folder> <T01> [--base <rev>]');

const planDir = path.resolve(arg);
if (!fs.statSync(planDir, { throwIfNoEntry: false })?.isDirectory()) fail(`not a directory: ${arg}`);
const root = path.resolve(planDir, ...contract.paths.plans.split('/').map(() => '..'), '..');
const folder = path.basename(planDir);
const reportsDir = path.join(root, contract.paths.reports, folder);

// --- the task and its F rows ---
const tasksDir = path.join(planDir, contract.paths.tasksDir);
const taskName = fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir).find((n) => n.startsWith(`${taskArg.slice(1)}-`)) : null;
if (!taskName) fail(`no task file for ${taskArg} in ${arg}/${contract.paths.tasksDir}`);
const taskFiles = asList(splitFrontmatter(fs.readFileSync(path.join(tasksDir, taskName), 'utf8')).fm.files) ?? [];
const context = read(path.join(planDir, 'context.md'));
const fRows = new Map(tableOf(context, 'Files to Change').map((r) => [r.ID, { path: unquote(r.File), action: r.Action }]));
const contracts = tableOf(context, 'Contracts');

// --- the implementation record ---
const recordFor = (id) => path.join(reportsDir, `${id}.md`);
const recordText = read(recordFor(taskArg));
if (!recordText) fail(`no implementation record ${path.relative(root, recordFor(taskArg))} — run /implement first`);
const recordFiles = (text) => tableOf(text, 'Files Changed').map((r) => ({ line: r.line, path: unquote(r.File), action: r.Action, plan: r['Plan row'] }));
const files = recordFiles(recordText);
const deviations = tableOf(recordText, 'Deviations');

const errors = [];
const warnings = [];
const rel = path.relative(root, recordFor(taskArg));
if (!files.length) errors.push(`${rel}: Files Changed has no rows (columns must be | File | Action | Plan row |)`);

// --- git, read-only ---
let changed = null;
let atBase = null; // paths that exist in <base>, i.e. have history worth reading
try {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const paths = files.map((f) => f.path);
  changed = new Set();
  atBase = new Set();
  if (paths.length) {
    changed = new Set([
      ...git('diff', '--name-only', base, '--', ...paths).split('\n'),
      ...git('ls-files', '--others', '--exclude-standard', '--', ...paths).split('\n'),
    ].filter(Boolean));
    atBase = new Set(git('ls-tree', '-r', '--name-only', base, '--', ...paths).split('\n').filter(Boolean));
  }
} catch {
  changed = null;
  atBase = null;
  warnings.push(`git diff against ${base} unavailable — reviewers see final file contents only, so pre-existing issues can't be told apart from new ones`);
}

// --- record vs plan ---
const planned = new Set();
for (const f of files) {
  if (!contract.enums.fileAction.includes(f.action)) errors.push(`${rel}: line ${f.line}: Action "${f.action}" is not one of ${contract.enums.fileAction.join(' | ')}`);
  if (f.plan === 'unplanned') {
    if (!deviations.some((d) => d.What.includes(`\`${f.path}\``)))
      errors.push(`${rel}: line ${f.line}: unplanned file ${f.path} is not explained in any Deviations row`);
  } else if (!taskFiles.includes(f.plan)) {
    errors.push(`${rel}: line ${f.line}: Plan row ${f.plan} is not one of ${taskArg}'s files (${taskFiles.join(', ') || 'none'})`);
  } else {
    planned.add(f.plan);
    const row = fRows.get(f.plan);
    if (row && row.path !== f.path) errors.push(`${rel}: line ${f.line}: ${f.plan} is ${row.path} in context.md, not ${f.path}`);
  }
  if (changed && !changed.has(f.path)) errors.push(`${rel}: line ${f.line}: ${f.path} is recorded as ${f.action} but has no change against ${base}`);
}
for (const id of taskFiles) {
  if (planned.has(id)) continue;
  const row = fRows.get(id);
  if (row) errors.push(`${contract.paths.tasksDir}/${taskName}: ${id} ${row.path} (${row.action}) is in ${taskArg}'s files but not in the implementation record`);
}

// --- other tasks' uncommitted work in the same files ---
const others = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).filter((n) => /^T\d{2}\.md$/.test(n) && n !== `${taskArg}.md`) : [];
for (const f of files) {
  if (changed && !changed.has(f.path)) continue;
  const sharedWith = others.filter((n) => recordFiles(read(path.join(reportsDir, n))).some((o) => o.path === f.path)).map((n) => n.slice(0, -3));
  if (sharedWith.length) {
    f.sharedWith = sharedWith;
    warnings.push(`${f.path} is also in the record of ${sharedWith.join(', ')}; its diff against ${base} may include their changes — report only lines this task's Action explains`);
  }
}

// --- conditional reviewers ---
const triggers = { history: [] };
for (const f of files) {
  if ((f.action === 'UPDATE' || f.action === 'DELETE') && (!atBase || atBase.has(f.path))) triggers.history.push(`${f.path} ${f.action}`);
}
for (const [name, t] of Object.entries(planTriggers)) {
  const reasons = [];
  for (const f of files) {
    const hit = (t.pathPatterns ?? []).find((re) => new RegExp(re, 'iu').test(f.path));
    if (hit) reasons.push(`${f.path} ~ /${hit}/`);
  }
  for (const c of contracts) {
    const loc = unquote(c.Location).replace(/:[\d-]+$/, '');
    if ((t.contractKinds ?? []).includes(c.Kind) && files.some((f) => f.path === loc)) reasons.push(`${c.ID} kind ${c.Kind} at ${loc}`);
  }
  triggers[name] = reasons;
}

const out = files.map(({ line, ...f }) => ({ ...f, changed: changed ? changed.has(f.path) : null }));
console.log(JSON.stringify({ task: taskArg, base, record: rel, files: out, errors, warnings, triggers }, null, 2));
