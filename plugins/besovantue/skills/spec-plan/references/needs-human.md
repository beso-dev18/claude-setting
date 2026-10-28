# needs-human rules

Decides whether an issue in a plan is `needs-human` (it becomes a blocker in `summary.md`) or `auto` (it gets fixed and leaves no trace). `spec-plan` uses this file in its clarify gate and review loop. `plan-review` hands it verbatim to every reviewer. `implement` and `impl-review` apply the same test to problems found while writing or reviewing a task's code. Blockers hold **only** `needs-human` items, and **every** `needs-human` item becomes a blocker, whatever its severity.

**For code.** A finding whose fix is a code change inside the task's Action and files — a bug, a missed pattern, a missing test, a swallowed error — is `auto`, however serious. It is `needs-human` only when the right fix can't be decided from the sources (the requirement is silent on the behavior, two valid behaviors exist) or would change the plan's substance (a task's Action or files, a Contracts row, an acceptance criterion).

## The test

An issue is `needs-human` only if **all three** hold. Otherwise it is `auto`.

1. **Not answerable from the sources.** The fix needs information or a decision that is not in the requirement file, the repository, the plan files, or the public docs of libraries the repository already uses.
2. **It changes the plan's substance.** The answer would change *what is built* or *how it is verified*: README Restatement, Scope or Acceptance Criteria; a task's Action, Validate, `files` or `depends`; or a `context.md` Contracts row.
3. **No precedent settles it.** If the repository already handles the same case in a similar feature, the fix is "follow the precedent", and that is `auto`.

## Types

Every `needs-human` issue gets exactly one type. The type becomes the blocker's Type (`contract.json` → `enums.blockerType`), and the Owner column gives the blocker's default Owner role. If more than one seems to fit, take the first matching row.

| Type | Use when | Owner |
|---|---|---|
| `requirement-gap` | The requirement is silent or contradicts itself on a business rule, behavior, edge case or data rule that changes what is built | PO |
| `decision-needed` | Two or more options are each consistent with the requirement and the repository, the choice changes scope, acceptance criteria, tasks, contracts or UX, and no precedent decides. The issue must list the options and a recommendation | PO if it changes behavior or UX, otherwise tech-lead |
| `dependency` | It needs something owned outside this repository: another team's API, schema or service, a third-party contract, an external sign-off | team-{owning team} |
| `access` | It needs credentials, environments, data or permissions the implementer doesn't have | whoever grants it (e.g. `devops`, `team-{x}`) |
| `technical` | Feasibility can't be determined from the repository and docs. It needs an experiment: a spike, a load test on real data, a vendor confirmation | tech-lead |

## Always `auto`

These never become blockers, even when the plan got them badly wrong:

- Any `validate-plan.mjs` error.
- A fabricated or stale Grounding/Contracts row: find the real precedent, or mark the row `notFound`.
- A Validate step that can't run: find the repository's real command.
- Missing or generic risks, wrong task order, missing acceptance-criteria or file coverage.
- Wording and clarity.
- Anything the requirement or the repository answers.

## Tie-breaks

- **Reviewer uncertainty is not `needs-human`.** "I couldn't verify X" is a low-confidence `auto` finding, and the confidence threshold handles it. It never gets escalated to a human.
- **No duplicates.** An issue already covered by an `open` blocker in `summary.md` is not a new finding.
- **What to ask.** For a `needs-human` issue, the fix is the exact question a human must answer. A `decision-needed` issue also gives `A) … · B) … — recommended: X`.
