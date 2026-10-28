# Plan Review output format

`plan-review` returns exactly this block (to `spec-plan` during its review loop, or to the user when run standalone). It is never written to a file.

```markdown
## Plan Review: {plan folder path}

Verdict: {Approve | Approve with changes | Request changes}
Reviewers: validator {✓ | n} · business-logic {✓ | n} · scope-skeptic {✓ | n} · impact {✓ | n} · failure-mode {✓ | n} · delivery {✓ | n} · codebase-fidelity {✓ | n} · testability {✓ | n}[ · security {✓ | n}][ · data-migration {✓ | n}][ · ui-a11y {✓ | n}]
Verification: {k} findings verified · {d} dropped · {p} notices promoted
Notices: {m} to confirm

| ID | Severity | Conf | Reviewer(s) | Target | Finding | Fix | Fix kind | Type |
|---|---|---|---|---|---|---|---|---|
| P1 | {critical | important | minor} | {0–100} | {reviewer, reviewer} | {file}#{Heading} | {what is wrong, with evidence} | {the concrete change, or the question for a human} | {auto | needs-human} | {blocker type, or —} |

### Notices — confirm with a human

| ID | Target | Similar to | Overlap | Why unsure | Question |
|---|---|---|---|---|---|
| N1 | {file}#{Heading} | `{table.column}` · `{path}:{line}` | {what the two columns share} | {what could make them different} | {the exact question to settle it} |
```

## Rules

- **Reviewers line**: every reviewer that ran, in the order of `roster.md`. Triggered reviewers appear only when they ran. `✓` means the reviewer contributed no surviving finding; otherwise the number shows how many of its findings survived verification. Never omit a reviewer that ran.
- **Verification line**: `k` is the number of merged reviewer findings sent to verifiers. `d` is how many the verifiers scored below the threshold. Validator rows are never verified.
- **Conf**: the verifier's score. Validator rows are always 100.
- **Rows**: sorted by Severity (critical → important → minor), then Conf descending. IDs `P1…` are per run and not stable across runs.
- **Target**: `file#Heading` relative to the plan folder (`README.md#Scope`, `tasks/02-add-route.md#Validate`). Use just `file` when the issue is file-wide, and the requirement path for requirement-level issues.
- **Fix kind and Type** are decided by `spec-plan/references/needs-human.md`, never by feel:
  - `auto` rows: Type `—`, and Fix is the change to make.
  - `needs-human` rows: Type is one `blockerType`, and Fix is the exact question for a human. `decision-needed` rows also give `A) … · B) … — recommended: X`.
  - The verifier's decision is final: it re-applies the test itself, so the reviewer's proposal and any disagreement between merged reviewers don't matter.
- **Severity** depends on which part of the plan the fix touches. Take the first that applies:
  - `critical` — the fix changes README Restatement, Scope (Building / NOT Building) or Acceptance Criteria. These change *what* is built.
  - `important` — the fix changes a task (Action, Validate, `files`/`depends`/`satisfies`/`mirrors`), a `context.md` G/C/F row, or adds a risk. Any validator error is also important. These change *how* it is built or verified.
  - `minor` — the fix changes prose only: Brief/Gotchas/Approach wording, Alternatives, Mitigation wording, Likelihood/Impact.

  A `needs-human` row is therefore never `minor`, because test 2 of `needs-human.md` already requires it to change substance.
- **Verdict**: `Request changes` if any row is critical or important; `Approve with changes` if all rows are minor; `Approve` if there are no rows.
- **No findings**: replace the table with the single line `None`.
- **Notices** come only from `data-migration`'s column-necessity check: a planned column that resembles an existing one, where nobody could tell from the requirement and the repository whether it is a duplicate.
  - `p` on the Verification line counts notices a verifier confirmed as `duplicate`; each becomes a normal row (reviewer `data-migration`, severity per the rules above) and leaves the Notices table.
  - Every other notice stays in the Notices table, whatever its confidence: notices are never filtered by the threshold and never dropped.
  - Notices don't change the Verdict and never become blockers on their own. `spec-plan` reports them in its hand-off so a human sees and answers them.
  - IDs `N1…` are per run. The `Notices:` line and the `### Notices` section are always present; with none, the line reads `Notices: 0 to confirm` and the section body is the single line `None`.
