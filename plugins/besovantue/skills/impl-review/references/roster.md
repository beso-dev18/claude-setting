# Reviewer roster

Each reviewer answers exactly one question. They don't overlap: if an issue fits another reviewer's question, it belongs to that reviewer. Every prompt is assembled as:

1. `reviewer-preamble.md`
2. `spec-plan/references/needs-human.md`
3. the scope block (below)
4. the brief
5. the return shape

**Scope block.**

> Plan folder: {path}. Repository root: {path}. Task: {T id} (`tasks/{file}`). Implementation record: {path}. Diff base: {base}.
> Files: {one line per record row: `path` · Action · F row or unplanned}.
> Warnings: {review-scope warnings, or None}.

**Model.** `inherit` means omit the `model` parameter, so the agent runs on the session's model. The judgment-heavy reviewers use it. Pattern- and lookup-heavy reviewers run on `sonnet`, verifiers on `haiku`.

## Reviewer return shape

> Return a list. Each item has:
> - **Conf**: per the rubric.
> - **Target**: `path:line` (or `path:start-end`) in the repository. For a missing piece of the task, the task file and heading (`tasks/02-x.md#Action`).
> - **Finding**: what is wrong, with the evidence: the code, the rule or row it breaks, the input that triggers it.
> - **Fix**: the concrete code change. For needs-human, the exact question a human must answer, plus options and a recommendation when the type is decision-needed.
> - **Fix kind**: `auto` or `needs-human`, decided strictly by the needs-human rules.
> - **Type**: one blocker type for needs-human, `—` for auto.
>
> Return `None` if you find nothing.

## Always run

### plan-fidelity — *does the code do exactly what the task says, no less and no more?* · model: inherit

> The task file is the specification; the requirement is the ground truth behind it. Compare the diff against the task's Action, the `AC` rows in its `satisfies`, every `C` row in `context.md`, and README › Scope. Report:
> - an Action step that is missing, partly done, or done differently from what it says, with no Deviations row explaining it;
> - an acceptance criterion in `satisfies` the code can't meet as written (name the input or case);
> - a Contracts row the change breaks: a changed signature, response shape, schema, config key or flag with no compatibility step in the task;
> - code that builds something under NOT Building, something another task owns, or anything no Action step or Deviation asks for;
> - a Deviations row whose reason doesn't hold: the task could have been followed as written.
>
> Do not report bugs in code that does what the task says; that is correctness.

### correctness — *does the changed code have bugs?* · model: inherit

> Read each changed hunk with enough surrounding code to know what it does. Look for bugs that will be hit in practice: wrong logic or conditions, off-by-one, null/undefined or empty input, wrong units or rounding in calculations, unhandled edge cases the requirement names, broken control flow, race conditions or shared mutable state, resource leaks (unclosed handles, unbounded growth), and calls to existing functions with the wrong arguments or wrong assumptions about what they return (check the callee).
>
> For each finding, name the concrete input or sequence that triggers it and what goes wrong. Focus on substantial bugs; skip anything that only might matter.

### error-handling — *can a failure in the changed code go unnoticed?* · model: sonnet

> For every error path the change adds or touches — try/catch, returned errors, promise rejections, fallbacks, default values, retries — check against the repository's patterns in `context.md` G2 (error handling) and G3 (logging). Report:
> - an error caught and dropped, or reduced to a log line where the caller needed to know;
> - a catch so broad it hides unrelated failures;
> - a fallback or default that silently returns wrong or partial data;
> - an error surfaced without the context needed to debug it, or logged in a way G3 doesn't;
> - a new failure point (I/O, network, parse) with no handling at all where the repository's precedent handles it;
> - sensitive values (credentials, tokens, personal data) written to a log or error message.

### conventions — *does the code follow this repository's written and shown conventions?* · model: sonnet

> 1. For each `G` row in the task's `mirrors`, compare the changed code with the precedent at its `path:line`: naming, structure, error and logging style, data access, test style. Report a departure the task's Gotchas or a Deviations row doesn't justify, citing both locations.
> 2. Read the project's written rules: `CLAUDE.md` files at the root and in directories of changed files, and the `cdocs/*.md` conventions and architecture docs if present. Report changed code that violates a rule, quoting the rule and its file. Rules are guidance for writing code; skip ones that don't apply to review.
> 3. Read the comments in and near the changed code (docstrings, TODOs with reasons, "do not…" notes). Report a change that contradicts what such a comment requires, and a comment the change made untrue.
>
> Report only departures with a written rule, a `G` row or a code comment behind them. Never report personal style preferences.

### tests — *would the tests catch it if this change broke?* · model: sonnet

> Map each new or changed behavior — every branch, error path and acceptance criterion in `satisfies` — to the test that pins it down, using the tests in the diff and existing ones. Report:
> - behavior no test exercises, worst first: business rules, error paths, then edge cases the requirement or Gotchas name;
> - a test that can't fail: no assertion, an assertion on a mock rather than behavior, or a condition that is always true;
> - a test tied to implementation details (private calls, call counts, exact log text) where the repository's G5 pattern tests behavior;
> - test setup that leaks between tests or depends on order, time or network where G5 doesn't.
>
> Judge against the repository's own testing depth (G5), not an ideal coverage number.

## Run when triggered

`review-scope.mjs` decides these. `history` runs when a recorded file existed at the diff base and was updated or deleted; the others reuse `plan-review/references/triggers.json` against the recorded file paths and the `context.md` Contracts rows located in them. A reviewer runs only when its list of reasons is non-empty, and its prompt includes those reasons.

### history — *does the change undo something the code's history put there on purpose?* · model: sonnet

> For each changed hunk in the triggering files, read `git blame` on the lines it replaces or removes, and `git log` (messages and diffs) of the commits that introduced them. Report a change that removes or reverses a bug fix, a guard, a workaround or a constraint whose commit explains why it exists, and the task doesn't say to remove it. Cite the commit and quote its reason.

### security — *does the changed code open a security hole?* · model: inherit

> For each new or changed entry point (route, handler, upload, webhook, job, CLI argument) and each place untrusted data reaches a query, command, path, template or deserializer, check:
> - authentication, and authorization on every path, including object-level access checks;
> - input validation at the boundary;
> - injection-safe data access (G4): no string-built SQL, shell commands, paths or HTML from untrusted input;
> - secrets kept out of code, logs and responses;
> - sensitive data (personal, credential, payment) never exposed in responses or errors;
> - the repository's existing security middleware or helpers used, not bypassed.
>
> Name the OWASP Top 10 category where one applies, and the input that exploits it.

### data-migration — *is every schema change and query in this diff safe on real data, and is every new column needed?* · model: inherit

> 1. **Rollout safety.** For each migration or schema change: it uses the repository's migration tool; it is safe on a live table (no long locks, batched backfills, a `NOT NULL` column on existing rows has a default or a backfill, indexes created concurrently where supported); it stays compatible with the currently deployed code during rollout; it has a rollback path or a stated reason none is needed. For each new or changed query: no N+1 in a loop, filtered and joined columns are indexed, no unbounded result set where the caller can't page.
> 2. **Column necessity.** For each column the diff adds to an existing table (migration, schema file, or ORM entity/model field), build the table's current column list as of the diff base: its migrations history, schema dumps (`schema.sql`, `structure.sql`, `schema.rb`, `schema.prisma` and the like), and its entity/model class. Read each existing column's name, type, constraints, comments, and how the code writes and reads it. Then compare the new column with every existing one and classify it:
>    - **Duplicate — report as a finding.** An existing column already stores the same fact: same meaning (a synonym or reworded name, e.g. `phone` / `phone_number`, `created` / `created_at`, `is_deleted` / `deleted`), a compatible type, and the code fills them from the same source. A new column whose value is a direct function of existing columns in the same row (`is_active` next to `status`, `full_name` next to `first_name` + `last_name`) also counts. The Fix is to use the existing column (or derive the value) and drop the new one. Not a duplicate when the task, a Deviations row or the requirement gives a reason to keep both (a deliberate denormalization, a migration that will retire the old column, a different unit or time zone).
>    - **Similar but uncertain — report as a notice, not a finding.** The names or meanings overlap, but the code, comments, requirement and history don't settle whether they hold the same fact (`phone` / `contact_phone`, `status` / `state`, `amount` / `amount_vnd`, `note` / `remark`). Never turn this into a finding and never drop it because you are unsure: uncertainty is exactly what a notice is for.
>    - **Distinct** — say nothing.
>
>    Cite both columns' definitions with `path:line`.
>
> In addition to the standard return list, return a **Notices** list (or `Notices: None`). Each notice has:
> - **Target**: `path:line` of the new column's definition.
> - **Similar to**: the existing column, `table.column` and the `path:line` of its definition.
> - **Overlap**: what the two columns have in common (name, type, values, where the code writes them).
> - **Why unsure**: what would make them different, and what you couldn't verify.
> - **Question**: the exact question a human answers to settle it (e.g. "Does `contact_phone` hold the same number as `phone`, or a separate contact person's number?").

### ui-a11y — *does the changed UI work in every state and for every user?* · model: sonnet

> For each changed UI file: loading, empty, error and disabled states are handled; existing components and design tokens are used instead of new ones; WCAG 2.2 AA holds — keyboard operation and focus order, accessible names for controls, color contrast, error messages linked to their fields, screen-reader announcements for dynamic changes; responsive behavior where the requirement implies it.

## Verifier · model: haiku

There is one verifier per merged finding, each a fresh agent that never sees the other findings. It receives the preamble, the needs-human rules, the scope block, the finding (Target, Finding, Fix, and the Fix kind and Type the reviewer proposed), and this brief:

> Independently check this single finding against the diff and the repository. Do not look for other issues. Decide:
> 1. Is it real? Score it with the rubric. Score 0 if it is one of the listed false positives, if the line it cites wasn't changed by this task, or if the evidence it cites does not exist.
> 2. Is it `auto` or `needs-human`? Apply the needs-human rules yourself; the reviewer's proposal is only a suggestion.
> 3. For needs-human, which Type?
>
> If you change the Fix kind, rewrite the Fix to match: the exact question (plus options and a recommendation for decision-needed) when it becomes needs-human, or the concrete code change when it becomes auto.
>
> Return exactly: `Conf: n · Fix kind: … · Type: … · Fix: {only if Fix kind changed, else "unchanged"} · Reason: one sentence`.

### Notice verifier · model: haiku

One per merged notice, built the same way as the finding verifier, with the notice (Target, Similar to, Overlap, Why unsure, Question) in place of the finding, and this brief:

> Independently compare these two columns against the repository: their definitions, every place the code writes and reads them, comments, migrations history and the requirement. Do not look for other issues. Decide:
> - `duplicate` — the evidence shows they store the same fact and nothing gives a reason to keep both. Score it with the rubric, decide `auto` or `needs-human` and the Type per the needs-human rules, and write the Fix.
> - `unsure` — anything else, including "probably different". Sharpen the Question if you can.
>
> Return exactly: `Verdict: duplicate | unsure · Conf: n · Fix kind: … · Type: … · Fix: … · Question: {unchanged, or the sharper question} · Reason: one sentence` (Conf, Fix kind, Type and Fix only for `duplicate`, otherwise `—`).
