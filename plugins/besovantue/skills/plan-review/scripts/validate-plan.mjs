#!/usr/bin/env node
// Deterministic structure + cross-reference check for a spec-plan output folder.
// Usage: node validate-plan.mjs <cdocs/plans/folder>
//          Exit 0 = clean, 1 = errors (one per line on stdout), 2 = usage/setup error.
//        node validate-plan.mjs --triggers <cdocs/plans/folder>
//          Prints JSON { reviewer: [reasons] } for plan-review's conditional reviewers (references/triggers.json).
//          A reviewer runs when its list is non-empty. Exit 0, or 2 on usage error.
//
// Single source of truth: headings, frontmatter keys, table columns and blocker fields are derived
// from spec-plan's references/templates/*.md; enums and fixed values come from references/contract.json.
// Only rules a template cannot express (IDs, cross-references, derived status) are coded here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFrontmatter, asList, parseDoc, rows, tableOf } from './plan-md.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF = path.resolve(HERE, '../../spec-plan/references');
const contract = JSON.parse(fs.readFileSync(path.join(REF, 'contract.json'), 'utf8'));
const { enums } = contract;

const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

// ---------- templates ----------

const PLACEHOLDER = /\{[^}]+\}/;
const toRegex = (text) =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{.*?\\\}/g, '.+')}$`);

function loadTemplate(key) {
  const { fm, lines, offset } = splitFrontmatter(fs.readFileSync(path.join(REF, contract.templates[key]), 'utf8'));
  const fixed = [];
  const repeatable = [];
  for (const s of parseDoc(lines, offset).slice(1)) {
    const placeholder = PLACEHOLDER.test(s.text);
    // A placeholder in a level-1 heading is the document title; deeper ones mark a repeatable block.
    if (placeholder && s.level > 1) repeatable.push({ ...s, re: toRegex(s.text) });
    else fixed.push({ ...s, re: placeholder ? toRegex(s.text) : null });
  }
  return { fmKeys: Object.keys(fm), fixed, repeatable };
}
const TPL = Object.fromEntries(Object.keys(contract.templates).map((k) => [k, loadTemplate(k)]));

const hd = (s) => `${'#'.repeat(s.level)} ${s.text}`;

// Checks frontmatter keys, heading order, non-empty sections and table headers against a template.
// Returns { fm, sec(name), repeats } where sec() looks a fixed section up by its template heading text.
function checkShape(rel, text, key) {
  const tpl = TPL[key];
  const { fm, lines, offset } = splitFrontmatter(text);
  for (const k of tpl.fmKeys) if (!fm[k]) err(rel, `frontmatter: missing "${k}"`);
  for (const k of Object.keys(fm)) if (!tpl.fmKeys.includes(k)) err(rel, `frontmatter: unexpected key "${k}"`);

  const found = new Map();
  const repeats = [];
  const matches = (exp, s) => exp.level === s.level && (exp.re ? exp.re.test(s.text) : exp.text === s.text);
  let j = 0;
  for (const s of parseDoc(lines, offset).slice(1)) {
    // Resync on the next matching fixed heading so one wrong heading doesn't cascade.
    const k = tpl.fixed.findIndex((exp, i) => i >= j && matches(exp, s));
    if (k >= 0) {
      for (const miss of tpl.fixed.slice(j, k)) err(rel, `missing heading "${hd(miss)}" (before line ${s.line})`);
      found.set(tpl.fixed[k].text, s);
      j = k + 1;
    } else if (tpl.repeatable.some((r) => r.level === s.level && r.re.test(s.text))) {
      repeats.push(s);
    } else {
      err(rel, `line ${s.line}: unexpected heading "${hd(s)}"`);
    }
  }
  for (const exp of tpl.fixed.slice(j)) err(rel, `missing heading "${hd(exp)}"`);

  const noneOk = contract.noneAllowed[key] ?? [];
  for (const exp of tpl.fixed) {
    const s = found.get(exp.text);
    if (!s) continue;
    if (noneOk.includes(exp.text) && s.content === 'None') {
      s.none = true;
      continue;
    }
    if (!exp.blank && s.blank) err(rel, `line ${s.line}: section "${exp.text}" is empty${noneOk.includes(exp.text) ? ' (write None if it does not apply)' : ''}`);
    if (exp.table) {
      if (!s.table) err(rel, `line ${s.line}: section "${exp.text}" has no table`);
      else if (s.table.header.join('|') !== exp.table.header.join('|'))
        err(rel, `line ${s.table.line}: table columns must be | ${exp.table.header.join(' | ')} |`);
      else if (!s.table.rows.length) err(rel, `line ${s.table.line}: table in "${exp.text}" has no rows`);
    }
  }
  return { fm, sec: (name) => found.get(name), repeats };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const checkEnum = (rel, where, value, name) => {
  if (!enums[name].includes(value)) err(rel, `${where}: "${value}" is not one of ${enums[name].join(' | ')}`);
};
const checkDate = (rel, keyName, value) => {
  if (value && !DATE.test(value)) err(rel, `frontmatter: "${keyName}" must be YYYY-MM-DD`);
};
function checkIds(rel, list, prefix, where) {
  const seen = new Set();
  for (const r of list) {
    if (!new RegExp(`^${prefix}\\d+$`).test(r.ID)) err(rel, `line ${r.line}: ${where} ID "${r.ID}" must look like ${prefix}1`);
    if (seen.has(r.ID)) err(rel, `line ${r.line}: duplicate ID "${r.ID}"`);
    seen.add(r.ID);
  }
  return seen;
}
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

// ---------- main ----------

const argv = process.argv.slice(2);
const triggersMode = argv.includes('--triggers');
const arg = argv.find((a) => !a.startsWith('--'));
if (!arg) {
  console.error('usage: validate-plan.mjs [--triggers] <cdocs/plans/folder>');
  process.exit(2);
}
const planDir = path.resolve(arg);
if (!fs.statSync(planDir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`not a directory: ${arg}`);
  process.exit(2);
}
const root = path.resolve(planDir, ...contract.paths.plans.split('/').map(() => '..'), '..');
const folder = path.basename(planDir);

// --triggers: decide plan-review's conditional reviewers. Tolerant of an invalid plan — it only reads what it can.
if (triggersMode) {
  const { reviewers } = JSON.parse(fs.readFileSync(path.resolve(HERE, '../references/triggers.json'), 'utf8'));
  const ctx = read(path.join(planDir, 'context.md'));
  const contracts = tableOf(ctx, 'Contracts');
  const files = tableOf(ctx, 'Files to Change');
  const reqPath = splitFrontmatter(read(path.join(planDir, 'README.md')) ?? '').fm.requirement;
  const reqText = reqPath ? splitFrontmatter(read(path.join(root, reqPath)) ?? '').lines.join('\n') : '';
  const out = {};
  for (const [name, t] of Object.entries(reviewers)) {
    const reasons = [];
    for (const c of contracts) if ((t.contractKinds ?? []).includes(c.Kind)) reasons.push(`${c.ID} kind ${c.Kind}`);
    for (const f of files) {
      const p = f.File.replace(/`/g, '');
      const hit = (t.pathPatterns ?? []).find((re) => new RegExp(re, 'iu').test(p));
      if (hit) reasons.push(`${f.ID} ${p} ~ /${hit}/`);
    }
    for (const re of t.requirementPatterns ?? []) if (new RegExp(re, 'iu').test(reqText)) reasons.push(`requirement ~ /${re}/`);
    out[name] = reasons;
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(folder)) err(folder, 'folder name must be kebab-case');

// Folder contents: exactly the three plan files plus tasks/.
const expectedEntries = ['README.md', 'context.md', 'summary.md', contract.paths.tasksDir];
for (const e of fs.readdirSync(planDir)) if (!expectedEntries.includes(e) && !e.startsWith('.')) err(e, 'unexpected file in plan folder');
for (const e of expectedEntries) if (!fs.existsSync(path.join(planDir, e))) err(e, 'missing');

// --- README.md ---
const readmeText = read(path.join(planDir, 'README.md'));
const readme = readmeText ? checkShape('README.md', readmeText, 'README.md') : null;
const acIds = new Set();
if (readme) {
  const { fm, sec } = readme;
  if (fm.complexity) checkEnum('README.md', 'frontmatter complexity', fm.complexity, 'complexity');
  checkDate('README.md', 'created', fm.created);
  checkDate('README.md', 'updated', fm.updated);
  checkIds('README.md', rows(sec('Acceptance Criteria')), 'AC', 'acceptance criterion').forEach((id) => acIds.add(id));
  const risks = rows(sec('Risks'));
  checkIds('README.md', risks, 'R', 'risk');
  for (const r of risks) {
    checkEnum('README.md', `line ${r.line} Likelihood`, r.Likelihood, 'level');
    checkEnum('README.md', `line ${r.line} Impact`, r.Impact, 'level');
  }
  const cx = sec('Complexity');
  if (cx && fm.complexity && !cx.content.startsWith(`${fm.complexity} — `))
    err('README.md', `line ${cx.line}: Complexity section must start with "${fm.complexity} — " (matching frontmatter)`);

  // --- requirement file ---
  if (fm.requirement) {
    const reqRel = fm.requirement;
    if (!reqRel.startsWith(`${contract.paths.requirements}/`))
      err('README.md', `frontmatter: requirement must live under ${contract.paths.requirements}/`);
    const reqText = read(path.join(root, reqRel));
    if (!reqText) err('README.md', `frontmatter: requirement file not found: ${reqRel}`);
    else {
      const req = checkShape(reqRel, reqText, 'requirement');
      const { key, source, fetched } = req.fm;
      if (source) checkEnum(reqRel, 'frontmatter source', source, 'source');
      checkDate(reqRel, 'fetched', fetched);
      if (key && source) {
        const synthetic = source === 'file' || source === 'inline';
        if (synthetic ? key !== `${source}-${folder}` : !folder.startsWith(`${key.toLowerCase()}-`))
          err(folder, synthetic ? `requirement key must be "${source}-${folder}"` : `folder name must start with "${key.toLowerCase()}-"`);
      }
    }
  }
}

// --- context.md ---
const contextText = read(path.join(planDir, 'context.md'));
const gIds = new Set();
const fIds = new Set();
if (contextText) {
  const { sec } = checkShape('context.md', contextText, 'context.md');
  const grounding = rows(sec('Codebase Grounding'));
  if (grounding.length && grounding.length !== contract.groundingCategories.length)
    err('context.md', `Codebase Grounding must have exactly ${contract.groundingCategories.length} rows (G1–G${contract.groundingCategories.length})`);
  grounding.forEach((r, i) => {
    gIds.add(r.ID);
    if (r.ID !== `G${i + 1}` || r.Category !== contract.groundingCategories[i])
      err('context.md', `line ${r.line}: row ${i + 1} must be "G${i + 1} | ${contract.groundingCategories[i]}"`);
    if (r.Pattern === contract.notFound) {
      if (r.Location !== contract.empty || r.Snippet !== contract.empty)
        err('context.md', `line ${r.line}: a not-found row has Location and Snippet "${contract.empty}"`);
    } else if (!/^`[^`]+:\d+(-\d+)?`$/.test(r.Location)) {
      err('context.md', `line ${r.line}: Location must be \`path:line\` or the row must say "${contract.notFound}"`);
    }
  });
  const contracts = rows(sec('Contracts'));
  checkIds('context.md', contracts, 'C', 'contract');
  for (const r of contracts) checkEnum('context.md', `line ${r.line} Kind`, r.Kind, 'contractKind');
  const files = rows(sec('Files to Change'));
  checkIds('context.md', files, 'F', 'file').forEach((id) => fIds.add(id));
  for (const r of files) {
    checkEnum('context.md', `line ${r.line} Action`, r.Action, 'fileAction');
    if (!/^`[^`]+`$/.test(r.File)) err('context.md', `line ${r.line}: File must be a \`path\``);
  }
  if (readme?.fm.complexity && fIds.size) {
    const expected = Object.entries(contract.complexityMaxFiles).find(([, max]) => max === null || fIds.size <= max)[0];
    if (readme.fm.complexity !== expected)
      err('README.md', `frontmatter: complexity must be ${expected} for ${fIds.size} file(s) in context.md`);
  }
}

// --- tasks/ ---
const tasksDir = path.join(planDir, contract.paths.tasksDir);
const tasks = new Map(); // id -> { file, fm }
if (fs.existsSync(tasksDir)) {
  const names = fs.readdirSync(tasksDir).filter((n) => !n.startsWith('.')).sort();
  if (!names.length) err(contract.paths.tasksDir, 'no task files');
  for (const name of names) {
    const rel = `${contract.paths.tasksDir}/${name}`;
    const m = /^(\d{2})-[a-z0-9]+(-[a-z0-9]+)*\.md$/.exec(name);
    if (!m) {
      err(rel, 'task file name must be NN-kebab-slug.md');
      continue;
    }
    const { fm, sec } = checkShape(rel, fs.readFileSync(path.join(tasksDir, name), 'utf8'), 'task');
    if (fm.id !== `T${m[1]}`) err(rel, `frontmatter: id must be T${m[1]} to match the file name`);
    const title = TPL.task.fixed[0];
    const titleSec = sec(title.text);
    if (titleSec && fm.id && titleSec.text !== `${fm.id}: ${fm.title}`) err(rel, `line ${titleSec.line}: title heading must be "# ${fm.id}: ${fm.title}"`);
    for (const k of ['depends', 'files', 'mirrors', 'satisfies']) if (fm[k] && !asList(fm[k])) err(rel, `frontmatter: ${k} must be a [list]`);
    const validate = sec('Validate');
    if (validate) {
      const cmd = validate.body.filter((b) => b.inFence && !/^\s*```/.test(b.text) && b.text.trim());
      if (!cmd.length) err(rel, `line ${validate.line}: Validate needs a non-empty \`\`\`bash block`);
      if (!validate.body.some((b) => !b.inFence && /^Expect: \S/.test(b.text))) err(rel, `line ${validate.line}: Validate needs an "Expect: …" line`);
    }
    if (fm.id) tasks.set(fm.id, { rel, name, fm, gotchasNone: sec('Gotchas')?.none });
  }
}
const usedF = new Set();
const usedAC = new Set();
for (const [id, t] of tasks) {
  const refs = (k) => asList(t.fm[k]) ?? [];
  for (const d of refs('depends')) if (!tasks.has(d)) err(t.rel, `depends: unknown task ${d}`);
  if (!refs('files').length) err(t.rel, 'files: a task must touch at least one F row');
  for (const f of refs('files')) fIds.has(f) ? usedF.add(f) : err(t.rel, `files: ${f} is not in context.md Files to Change`);
  for (const g of refs('mirrors')) if (!gIds.has(g)) err(t.rel, `mirrors: ${g} is not a Codebase Grounding row`);
  if (!refs('mirrors').length && t.gotchasNone) err(t.rel, 'mirrors is empty (no precedent) — Gotchas must explain the new pattern, not None');
  for (const a of refs('satisfies')) acIds.has(a) ? usedAC.add(a) : err(t.rel, `satisfies: ${a} is not in README.md Acceptance Criteria`);
  // dependency cycle via DFS from this task
  const stack = [...refs('depends')];
  const seen = new Set();
  while (stack.length) {
    const d = stack.pop();
    if (d === id) {
      err(t.rel, 'depends: dependency cycle');
      break;
    }
    if (seen.has(d) || !tasks.has(d)) continue;
    seen.add(d);
    stack.push(...(asList(tasks.get(d).fm.depends) ?? []));
  }
}
for (const f of fIds) if (!usedF.has(f)) err('context.md', `${f} is not used by any task`);
for (const a of acIds) if (!usedAC.has(a)) err('README.md', `${a} is not satisfied by any task`);

// --- summary.md ---
const summaryText = read(path.join(planDir, 'summary.md'));
if (summaryText) {
  const { fm, sec, repeats } = checkShape('summary.md', summaryText, 'summary.md');
  if (fm.status) checkEnum('summary.md', 'frontmatter status', fm.status, 'planStatus');
  checkDate('summary.md', 'updated', fm.updated);

  const status = new Map();
  const taskRows = rows(sec('Tasks'));
  const listed = new Set();
  for (const r of taskRows) {
    const m = /^\[(T\d{2})\]\(([^)]+)\)$/.exec(r.Task);
    if (!m) {
      err('summary.md', `line ${r.line}: Task must be a link like [T01](tasks/01-slug.md)`);
      continue;
    }
    const t = tasks.get(m[1]);
    listed.add(m[1]);
    if (!t) err('summary.md', `line ${r.line}: ${m[1]} has no task file`);
    else {
      if (m[2] !== t.rel) err('summary.md', `line ${r.line}: link must point to ${t.rel}`);
      if (r.Title !== t.fm.title) err('summary.md', `line ${r.line}: Title must match ${t.rel} ("${t.fm.title}")`);
    }
    checkEnum('summary.md', `line ${r.line} Status`, r.Status, 'taskStatus');
    status.set(m[1], r);
  }
  for (const id of tasks.keys()) if (!listed.has(id)) err('summary.md', `${id} is missing from the Tasks table`);
  const order = taskRows.map((r) => /^\[(T\d{2})\]/.exec(r.Task)?.[1]).filter(Boolean);
  if (order.join() !== [...order].sort().join()) err('summary.md', 'Tasks table must be ordered by task ID');

  const blockerRows = rows(sec('Blockers'));
  checkIds('summary.md', blockerRows, 'B', 'blocker');
  const blockedBy = new Map(); // task id -> open blocker ids
  const detailTpl = TPL['summary.md'].repeatable[0];
  const labels = detailTpl ? [...detailTpl.content.matchAll(/^- \*\*(.+?)\*\*:/gm)].map((x) => x[1]) : [];
  const details = new Map(repeats.map((s) => [s.text.split(':')[0], s]));
  for (const r of blockerRows) {
    checkEnum('summary.md', `line ${r.line} Type`, r.Type, 'blockerType');
    checkEnum('summary.md', `line ${r.line} Status`, r.Status, 'blockerStatus');
    if (!r.Owner || r.Owner === contract.empty) err('summary.md', `line ${r.line}: Owner is required`);
    const blocks = r.Blocks.split(',').map((s) => s.trim()).filter(Boolean);
    if (!blocks.length) err('summary.md', `line ${r.line}: Blocks must list at least one task`);
    for (const b of blocks) {
      if (!tasks.has(b)) err('summary.md', `line ${r.line}: Blocks references unknown task ${b}`);
      if (r.Status === 'open') blockedBy.set(b, [...(blockedBy.get(b) ?? []), r.ID]);
    }
    const d = details.get(r.ID);
    if (!d) {
      err('summary.md', `${r.ID} has no "### ${r.ID}: ${r.Title}" detail block`);
      continue;
    }
    details.delete(r.ID);
    if (d.text !== `${r.ID}: ${r.Title}`) err('summary.md', `line ${d.line}: heading must be "### ${r.ID}: ${r.Title}"`);
    const values = Object.fromEntries([...d.content.matchAll(/^- \*\*(.+?)\*\*:\s*(.*)$/gm)].map((x) => [x[1], x[2].trim()]));
    for (const l of labels) if (!values[l]) err('summary.md', `line ${d.line}: ${r.ID} is missing "- **${l}**:"`);
    if (values.Resolution !== undefined) {
      const open = values.Resolution === contract.empty;
      if (r.Status === 'open' && !open) err('summary.md', `line ${d.line}: ${r.ID} is open, so Resolution must be "${contract.empty}"`);
      if (r.Status === 'resolved' && open) err('summary.md', `line ${d.line}: ${r.ID} is resolved but has no Resolution`);
    }
    if (values.Options !== undefined && (r.Type === 'decision-needed') === (values.Options === 'N/A'))
      err('summary.md', `line ${d.line}: ${r.ID} Options must be ${r.Type === 'decision-needed' ? 'listed for decision-needed' : '"N/A" unless decision-needed'}`);
  }
  for (const [id, d] of details) err('summary.md', `line ${d.line}: detail block ${id} has no row in the Blockers table`);

  // Derived status rules.
  const finished = (s) => s === 'done' || s === 'dropped';
  for (const [id, r] of status) {
    const open = blockedBy.get(id) ?? [];
    if (finished(r.Status)) continue;
    if ((r.Status === 'blocked') !== open.length > 0)
      err('summary.md', `line ${r.line}: ${id} must be ${open.length ? `blocked (open ${open.join(', ')})` : 'not blocked — no open blocker lists it'}`);
    for (const b of open) if (!r.Note.includes(b)) err('summary.md', `line ${r.line}: Note for ${id} must name ${b}`);
  }
  if (fm.status && status.size) {
    const all = [...status.values()].map((r) => r.Status);
    const expected = all.every(finished)
      ? ['done']
      : all.includes('blocked')
        ? ['blocked']
        : all.some((s) => s !== 'todo')
          ? ['in-progress']
          : ['draft', 'approved'];
    if (!expected.includes(fm.status)) err('summary.md', `frontmatter: status must be ${expected.join(' or ')} given the task statuses`);
  }
}

if (errors.length) {
  console.log(errors.join('\n'));
  console.log(`\n${errors.length} error(s) in ${arg}`);
  process.exit(1);
}
console.log(`OK: ${arg}`);
