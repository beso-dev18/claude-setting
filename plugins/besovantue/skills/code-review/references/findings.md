# Code Review output format

`code-review` returns exactly this block to whoever invoked it. It is never written to a file.

```markdown
## Code Review: {base} → working tree[ · {paths}]

Verdict: {Approve | Approve with changes | Request changes}
Reviewers: review-scope {✓ | n} · correctness {✓ | n} · error-handling {✓ | n} · conventions {✓ | n} · tests {✓ | n}[ · history {✓ | n}][ · security {✓ | n}][ · data-migration {✓ | n}][ · ui-a11y {✓ | n}]
Verification: {k} findings verified · {d} dropped · {p} notices promoted
Notices: {m} to confirm
Scope: {n} files, +{additions} −{deletions} vs merge base {short sha}[ · warnings: {review-scope warnings, joined by "; "}]

| ID | Severity | Conf | Reviewer(s) | Target | Finding | Fix |
|---|---|---|---|---|---|---|
| CR1 | {critical | important | minor} | {0–100} | {reviewer, reviewer} | `{path}:{line}` | {what is wrong, with evidence} | {the concrete change, or the question to settle} |

### Notices — confirm with a human

| ID | Target | Similar to | Overlap | Why unsure | Question |
|---|---|---|---|---|---|
| N1 | `{path}:{line}` | `{table.column}` · `{path}:{line}` | {what the two columns share} | {what could make them different} | {the exact question to settle it} |
```

## Rules

- **Reviewers line**: every reviewer that ran, in the order of `roster.md`, with `review-scope` (the script) first. Triggered reviewers appear only when they ran. `✓` means the reviewer contributed no surviving finding; otherwise the number shows how many of its findings survived verification. Never omit a reviewer that ran.
- **Verification line**: `k` is the number of merged reviewer findings sent to verifiers. `d` is how many the verifiers scored below the threshold. `p` counts notices a verifier confirmed as duplicates. Script rows are never verified.
- **Conf**: the verifier's score. Script rows are always 100.
- **Rows**: sorted by Severity (critical → important → minor), then Conf descending. IDs `CR1…` are per run and not stable across runs.
- **Target**: `path:line` or `path:start-end` relative to the repository root.
- **Severity**, take the first that applies:
  - `critical` — a security hole, data loss or corruption, or a break in a contract other code relies on (a public API, a response shape, a schema, an event or message format) with no compatibility step.
  - `important` — a bug that will be hit, a failure that goes unnoticed, a caller the change breaks, new behavior no test pins down, a violation of a written project rule, a change that undoes a deliberate fix, a new column that duplicates an existing one. Any script row is also important.
  - `minor` — clarity only: naming, a misleading comment, a departure from local convention that doesn't change behavior.
- **Verdict**: `Request changes` if any row is critical or important; `Approve with changes` if all rows are minor; `Approve` if there are no rows.
- **No findings**: replace the table with the single line `None`.
- **Notices** come only from `data-migration`'s column-necessity check: a new column that resembles an existing one, where nobody could tell from the repository whether it is a duplicate.
  - A notice a verifier confirmed as `duplicate` (Conf at or above the threshold) becomes a normal row (reviewer `data-migration`) and leaves the Notices table.
  - Every other notice stays in the Notices table, whatever its confidence: notices are never filtered by the threshold and never dropped.
  - Notices don't change the Verdict. They exist so a human sees and answers them.
  - IDs `N1…` are per run. The `Notices:` line and the `### Notices` section are always present; with none, the line reads `Notices: 0 to confirm` and the section body is the single line `None`.
