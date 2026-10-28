# Impl Review output format

`impl-review` returns exactly this block (to `implement` during its review loop, or to the user when run standalone). It is never written to a file.

```markdown
## Impl Review: {plan folder path} · {task id}

Verdict: {Approve | Approve with changes | Request changes}
Reviewers: review-scope {✓ | n} · plan-fidelity {✓ | n} · correctness {✓ | n} · error-handling {✓ | n} · conventions {✓ | n} · tests {✓ | n}[ · history {✓ | n}][ · security {✓ | n}][ · data-migration {✓ | n}][ · ui-a11y {✓ | n}]
Verification: {k} findings verified · {d} dropped · {p} notices promoted
Notices: {m} to confirm
Scope: {n} files vs {base}[ · warnings: {review-scope warnings, joined by "; "}]

| ID | Severity | Conf | Reviewer(s) | Target | Finding | Fix | Fix kind | Type |
|---|---|---|---|---|---|---|---|---|
| I1 | {critical | important | minor} | {0–100} | {reviewer, reviewer} | `{path}:{line}` | {what is wrong, with evidence} | {the concrete change, or the question for a human} | {auto | needs-human} | {blocker type, or —} |

### Notices — confirm with a human

| ID | Target | Similar to | Overlap | Why unsure | Question |
|---|---|---|---|---|---|
| N1 | `{path}:{line}` | `{table.column}` · `{path}:{line}` | {what the two columns share} | {what could make them different} | {the exact question to settle it} |
```

## Rules

- **Reviewers line**: every reviewer that ran, in the order of `roster.md`, with `review-scope` (the script) first. Triggered reviewers appear only when they ran. `✓` means the reviewer contributed no surviving finding; otherwise the number shows how many of its findings survived verification. Never omit a reviewer that ran.
- **Verification line**: `k` is the number of merged reviewer findings sent to verifiers. `d` is how many the verifiers scored below the threshold. Script rows are never verified.
- **Conf**: the verifier's score. Script rows are always 100.
- **Rows**: sorted by Severity (critical → important → minor), then Conf descending. IDs `I1…` are per run and not stable across runs.
- **Target**: `path:line` or `path:start-end` relative to the repository root. A missing piece of the task targets `tasks/{file}#{Heading}`; a script row targets the file its message names.
- **Fix kind and Type** are decided by `spec-plan/references/needs-human.md` (including its "For code" paragraph), never by feel:
  - `auto` rows: Type `—`, and Fix is the code change to make.
  - `needs-human` rows: Type is one `blockerType`, and Fix is the exact question for a human. `decision-needed` rows also give `A) … · B) … — recommended: X`.
  - The verifier's decision is final.
- **Severity**, take the first that applies:
  - `critical` — an acceptance criterion in the task's `satisfies` can't be met, a Contracts row is broken, a security hole, or data loss or corruption.
  - `important` — a bug that will be hit, a failure that goes unnoticed, a new column that duplicates an existing one, an Action step missing or not done as written, new behavior no test pins down, a violation of a written rule or a mirrored `G` row, a change that undoes a deliberate fix. Any script row is also important.
  - `minor` — clarity only: naming, a misleading comment, structure that doesn't change behavior.

  A `needs-human` row is never `minor`, because test 2 of `needs-human.md` already requires it to change substance.
- **Verdict**: `Request changes` if any row is critical or important; `Approve with changes` if all rows are minor; `Approve` if there are no rows.
- **No findings**: replace the table with the single line `None`.
- **Notices** come only from `data-migration`'s column-necessity check: a new column that resembles an existing one, where nobody could tell from the repository whether it is a duplicate.
  - `p` on the Verification line counts notices a verifier confirmed as `duplicate`; each becomes a normal row (reviewer `data-migration`, severity per the rules above) and leaves the Notices table.
  - Every other notice stays in the Notices table, whatever its confidence: notices are never filtered by the threshold and never dropped.
  - Notices don't change the Verdict and are never fixed or turned into blockers by `implement`. They exist so a human sees and answers them.
  - IDs `N1…` are per run. The `Notices:` line and the `### Notices` section are always present; with none, the line reads `Notices: 0 to confirm` and the section body is the single line `None`.
