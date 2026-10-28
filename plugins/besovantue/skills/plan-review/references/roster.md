# Reviewer roster

Each reviewer answers exactly one question. They don't overlap: if an issue fits another reviewer's question, it belongs to that reviewer. Every prompt is assembled as:

1. `reviewer-preamble.md`
2. `spec-plan/references/needs-human.md`
3. `Plan folder: {path}. Repository root: {path}.`
4. the brief
5. the return shape

**Model.** `inherit` means omit the `model` parameter, so the agent runs on the session's model. The judgment-heavy reviewers use it. Lookup-heavy reviewers run on `sonnet`, verifiers on `haiku`.

## Reviewer return shape

> Return a list. Each item has:
> - **Conf**: per the rubric.
> - **Target**: `file#Heading`, relative to the plan folder.
> - **Finding**: what is wrong, with the evidence (`path:line` where relevant).
> - **Fix**: the concrete change. For needs-human, the exact question a human must answer, plus options and a recommendation when the type is decision-needed.
> - **Fix kind**: `auto` or `needs-human`, decided strictly by the needs-human rules.
> - **Type**: one blocker type for needs-human, `—` for auto.
>
> Return `None` if you find nothing.

## Always run

### business-logic — *does the plan build everything the requirement asks?* · model: inherit

> The requirement file is ground truth. README's Restatement is the author's interpretation and may itself be wrong, so do not trust it. Check whether README (Restatement, Approach, Scope including NOT Building, Acceptance Criteria) and `tasks/*.md` together deliver everything the requirement asks. Report:
> - misread intent;
> - behavior the requirement states or clearly implies but no task delivers;
> - wrong business rules or calculations;
> - edge cases the requirement names but the plan doesn't handle;
> - anything placed under NOT Building that the requirement asks for.
>
> Report only what is missing or wrong. Work built *beyond* the requirement is not yours.

### scope-skeptic — *does the plan build more than needed, or something more complex than needed?* · model: inherit

> Your stance is skeptical: for every piece of work, ask "do we actually need this?". Compare README (Approach, Alternatives Considered, Scope › Building), `context.md` Files to Change and `tasks/*.md` against the requirement file. Report:
> - work that no requirement statement needs: gold-plating, speculative configurability or extension points, "while we're here" refactors;
> - new abstractions, layers, services or dependencies with one implementation and no second use in sight;
> - a rejected alternative that is actually simpler and still meets the requirement;
> - a new pattern where an existing one in the repository (`context.md` G rows, or elsewhere) would do.
>
> Each finding names what to cut, or the simpler design. Do not report missing functionality.

### impact — *what else does this change touch that the plan doesn't list?* · model: inherit

> For every `context.md` Contracts row, and every Files to Change row with Action `UPDATE` or `DELETE`, search the repository for callers, importers, implementers, subclasses, serializers, consumers, routes and config that reference it. Use `git log` on those files when history explains a constraint. Report:
> - files that must change but are missing from Files to Change;
> - a backward-incompatible change to a contract (API shape, type, schema, event, message, config key) with no compatibility or migration step in any task;
> - existing data, caches, feature flags or environment config that must be migrated, invalidated or set;
> - generated code, API clients, docs or fixtures that need regenerating.
>
> Cite the real `path:line` of every affected reference.

### failure-mode — *what happens when it goes wrong?* · model: inherit

> For each new or changed flow in `tasks/*.md`, walk at least:
> - invalid or missing input;
> - a dependency (database, external service, queue, file system) failing or timing out;
> - a failure halfway through a multi-step write;
> - retries or duplicate delivery (idempotency);
> - concurrent access to the same record.
>
> For each case, check that some task's Action or an Acceptance Criterion handles it, using the repository's error-handling (G2) and logging (G3) patterns. A failure must be observable (logged or surfaced to the caller), never swallowed or hidden behind a silent fallback.
>
> Then check README Risks. Each significant failure the plan does not fully prevent needs a row, and each mitigation must be an action someone can take, not "be careful" or "add tests". Ignore failures the requirement explicitly accepts.

### delivery — *can the plan be executed task by task, as written?* · model: sonnet

> Run a cold-start test on each `tasks/*.md`. You are an agent holding only that file, the `context.md` rows in its `files` and `mirrors`, and the README rows in its `satisfies`. Could you do its Action without searching the codebase or asking anyone? Report every missing fact the Brief leaves out: exact file, function, type, command, value, or name. Also report:
> - a task that uses something only a later task, or a task outside its `depends`, creates;
> - a `depends` entry that is missing or unnecessary;
> - a task that cannot be merged on its own without breaking the build or existing behavior;
> - a task larger than one reviewable PR. Signals: more than about 5 files, or unrelated concerns mixed together.

### codebase-fidelity — *does the plan match the repository as it really is?* · model: sonnet

> 1. For every `context.md` Codebase Grounding and Contracts row, verify that the file exists, the line range is about right, and the pattern and snippet match what is really there. Report fabricated, stale or misattributed rows, and "not found" rows where a real precedent exists (give its `path:line`).
> 2. Check that each task's `mirrors` rows actually fit what that task builds.
> 3. Read the project's written rules: `CLAUDE.md` files (at the root and in directories the plan touches), ADRs, and the `cdocs/*.md` conventions and architecture docs if present. Report any task or approach that violates a rule stated there, quoting the rule.

### testability — *can success actually be checked?* · model: sonnet

> 1. For each `tasks/*.md`, check that its Validate command can run in this repository as written: the script, test target or tool must exist (check `package.json`, `Makefile`, CI config and the like), and Expect must be something you can observe.
> 2. For each README Acceptance Criterion, check that someone other than the author can verify it objectively, and that its "Verified by" points to a task or command that really verifies it.
> 3. Report new behavior (especially branches and error paths) that no Validate command or Acceptance Criterion would catch if it broke.

## Run when triggered

`validate-plan.mjs --triggers <folder>` decides these from `triggers.json`. It matches `context.md` Contracts kinds, Files to Change paths and the requirement text. A reviewer runs only when its list of reasons is non-empty, and its prompt includes those reasons.

### security — *does what the plan builds open a security hole?* · model: inherit

> Review what the plan **will build**, not existing code. For each new or changed entry point (API route, handler, upload, webhook, job), check that the tasks cover:
> - authentication, and authorization on every path, including object-level access checks;
> - input validation at the boundary;
> - injection-safe data access (G4);
> - secrets kept out of code and logs;
> - sensitive data (PII, credentials, payment data) never logged or exposed in responses or errors;
> - rate limiting or abuse controls where the requirement implies public exposure.
>
> Report a task that bypasses the repository's existing security patterns. Name the OWASP Top 10 category where one applies.

### data-migration — *is every schema or data change safe to roll out, and is every new column needed?* · model: inherit

> 1. **Rollout safety.** For every schema change or data migration in the plan, check:
>    - there is a task using the repository's migration tool;
>    - it is safe on a live table: no long locks, backfills batched, a `NOT NULL` column on existing rows has a default or a backfill, indexes are created concurrently where the database supports it;
>    - it stays compatible with the currently deployed code during rollout (expand → migrate → contract);
>    - there is a rollback path, or a stated reason none is needed;
>    - new foreign keys and frequently filtered columns are indexed;
>    - what happens to existing data is concrete. "Handle later" is a finding.
> 2. **Column necessity.** List every column the plan adds to an existing table: `context.md` Contracts rows of kind `schema`, Files to Change rows for migrations, schema files and entities/models, and the tasks' Actions. For each table, build its current column list from the repository: its migrations history, schema dumps (`schema.sql`, `structure.sql`, `schema.rb`, `schema.prisma` and the like), and its entity/model class. Read each existing column's name, type, constraints, comments, and how the code writes and reads it. Then compare each planned column with every existing one and classify it:
>    - **Duplicate — report as a finding.** An existing column already stores the same fact: same meaning (a synonym or reworded name, e.g. `phone` / `phone_number`, `created` / `created_at`, `is_deleted` / `deleted`) and a compatible type, and what the plan would write into the new column is what the code already writes into the old one. A planned column whose value is a direct function of existing columns in the same row (`is_active` next to `status`, `full_name` next to `first_name` + `last_name`) also counts. The Fix changes the affected tasks and Contracts/Files rows to use the existing column (or derive the value) instead of adding one. Not a duplicate when the requirement or the plan gives a reason to keep both (a deliberate denormalization, retiring the old column, a different unit or time zone).
>    - **Similar but uncertain — report as a notice, not a finding.** The names or meanings overlap, but the requirement, code, comments and history don't settle whether they hold the same fact (`phone` / `contact_phone`, `status` / `state`, `amount` / `amount_vnd`, `note` / `remark`). Never turn this into a finding and never drop it because you are unsure: uncertainty is exactly what a notice is for.
>    - **Distinct** — say nothing.
>
>    Cite where the plan introduces the column (`file#Heading`) and the existing column's definition (`path:line`).
>
> In addition to the standard return list, return a **Notices** list (or `Notices: None`). Each notice has:
> - **Target**: `file#Heading` in the plan folder where the new column is introduced.
> - **Similar to**: the existing column, `table.column` and the `path:line` of its definition.
> - **Overlap**: what the two columns have in common (name, type, values, where the code writes them).
> - **Why unsure**: what would make them different, and what you couldn't verify.
> - **Question**: the exact question a human answers to settle it (e.g. "Does `contact_phone` hold the same number as `phone`, or a separate contact person's number?").

### ui-a11y — *does the UI work for every state and every user?* · model: sonnet

> For each UI file in the plan, check:
> - loading, empty, error and disabled states are each covered by a task or an Acceptance Criterion;
> - existing components and design tokens are reused instead of new ones;
> - WCAG 2.2 AA: keyboard operation and focus order, accessible names for controls, color contrast, error messages linked to their fields, screen-reader announcements for dynamic changes;
> - responsive and mobile behavior, where the requirement implies it.

## Verifier · model: haiku

There is one verifier per merged finding, each a fresh agent that never sees the other findings. It receives the preamble, the needs-human rules, `Plan folder: … Repository root: …`, the finding (Target, Finding, Fix, and the Fix kind and Type the reviewer proposed), and this brief:

> Independently check this single finding against the plan and the repository. Do not look for other issues. Decide:
> 1. Is it real? Score it with the rubric. Score 0 if it is one of the listed false positives, or if the evidence it cites does not exist.
> 2. Is it `auto` or `needs-human`? Apply the needs-human rules yourself; the reviewer's proposal is only a suggestion.
> 3. For needs-human, which Type?
>
> If you change the Fix kind, rewrite the Fix to match: the exact question (plus options and a recommendation for decision-needed) when it becomes needs-human, or the concrete change when it becomes auto.
>
> Return exactly: `Conf: n · Fix kind: … · Type: … · Fix: {only if Fix kind changed, else "unchanged"} · Reason: one sentence`.

### Notice verifier · model: haiku

One per merged notice, built the same way as the finding verifier, with the notice (Target, Similar to, Overlap, Why unsure, Question) in place of the finding, and this brief:

> Independently compare the planned column with the existing one: the requirement, the plan, the existing column's definition, every place the code writes and reads it, comments and migrations history. Do not look for other issues. Decide:
> - `duplicate` — the evidence shows they would store the same fact and nothing gives a reason to keep both. Score it with the rubric, decide `auto` or `needs-human` and the Type per the needs-human rules, and write the Fix.
> - `unsure` — anything else, including "probably different". Sharpen the Question if you can.
>
> Return exactly: `Verdict: duplicate | unsure · Conf: n · Fix kind: … · Type: … · Fix: … · Question: {unchanged, or the sharper question} · Reason: one sentence` (Conf, Fix kind, Type and Fix only for `duplicate`, otherwise `—`).
