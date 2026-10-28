---
name: spec-plan
description: Turn a requirement (a cdocs/requirements file pulled from Jira/Confluence, a Jira key, another spec file, or pasted text) into a reviewed, implementation-ready plan folder under cdocs/plans/ — README, codebase context, one file per task, and a summary.md holding task status and blockers. Runs plan-review and revises until clean; anything needing a human becomes a blocker. Use when the user asks to "plan this feature", "make an implementation plan", "break this down into tasks", runs /spec-plan, hands over a requirement, PRD or Jira key before writing code, or asks to revise an existing plan or resolve its blockers.
argument-hint: "[cdocs/requirements/KEY.md | KEY | path/to/spec.md | requirement text | cdocs/plans/<folder>]"
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit, AskUserQuestion, Skill]
version: 0.1.0
---

# Spec Plan

Turn a requirement into a plan folder that someone with no access to this conversation can implement from, grounded in the codebase's real patterns. Audit it with `plan-review`, apply the fixes, and record whatever still needs a human as blockers.

## Output contract

The shape of every output file is defined in `references/` — read the relevant template before writing a file, and copy it rather than writing from memory. Same input, same shape, every run.

| Reference | Defines |
|---|---|
| `references/contract.json` | paths, enums, fixed Grounding rows, complexity thresholds, which sections may be `None` |
| `references/templates/requirement.md` | `cdocs/requirements/{KEY}.md` |
| `references/templates/README.md` | restatement, approach, scope, acceptance criteria, risks, complexity |
| `references/templates/context.md` | codebase grounding, contracts, files to change |
| `references/templates/task.md` | one `tasks/NN-{slug}.md` |
| `references/templates/summary.md` | plan status, task status, blockers |
| `references/needs-human.md` | which issues become blockers (`needs-human`) and which get fixed (`auto`), and each blocker's Type |

```
cdocs/requirements/{KEY}.md          ← the requirement, verbatim
cdocs/plans/{folder}/
  README.md  context.md  summary.md
  tasks/01-{slug}.md  02-{slug}.md …
```

`plan-review/scripts/validate-plan.mjs` is the executable form of this contract. A plan is not finished until it passes.

### Rules the templates can't show

- **One fact, one file.** Status and blockers live only in `summary.md`; patterns, contracts and files only in `context.md`; acceptance criteria and risks only in `README.md`; the requirement only in its requirement file. Elsewhere, refer by ID (`G2`, `C1`, `F3`, `AC1`, `R1`, `T01`, `B1`) — never copy content.
- **Exact shape.** Frontmatter keys, headings and table columns are exactly the template's: same text, same order, nothing added or removed. Replace every `{placeholder}`. A section listed in `noneAllowed` that doesn't apply has the body `None` and no table; every other section is filled.
- **IDs.** `G1–G6` are fixed rows in `groundingCategories` order. `C`, `F`, `AC`, `R`, `B` count from 1 and are never renumbered on revision (gaps are fine). Task `T01` ⇔ file `tasks/01-{slug}.md`.
- **No precedent.** A Grounding row with nothing real to cite has Location `—`, Pattern = `notFound`, Snippet `—`. Never invent a plausible-looking pattern. A task with empty `mirrors` explains its new pattern under Gotchas.
- **Folder name.** Jira/Confluence: `{key lowercased}-{slug}`. File/inline sources: the key is `{source}-{slug}` and the folder is `{slug}`. Slug: kebab-case, at most `slugMaxWords` words.
- **Complexity** = the first level in `complexityMaxFiles` whose limit is ≥ the number of `F` rows.
- **Task status.** A task that isn't `done`/`dropped` is `blocked` if and only if an `open` blocker lists it under Blocks; its Note then names those blocker IDs.
- **Plan status**, first match wins: all tasks `done`/`dropped` → `done`; any task `blocked` → `blocked`; any task not `todo` → `in-progress`; else `draft` until the review loop ends, then `approved`.
- **Blockers hold only `needs-human` items**, and every `needs-human` item becomes one, whatever its severity, as decided by `references/needs-human.md`. `auto` issues are fixed and never recorded.
- **Blockers are never deleted.** To resolve: Status → `resolved`, Resolution → `{date}: {what was decided}`, then re-derive task and plan status. Open blockers have Resolution `—`. Options are listed only for `decision-needed`, otherwise `N/A`.
- **The requirement file is read-only once it exists.** Write one only for `file`/`inline` sources; Jira/Confluence ones come from the requirement-pull skill.
- Dates are `YYYY-MM-DD`. Bump `updated` in `README.md` / `summary.md` whenever that file changes.

## When NOT to use

- A one-off, single-file change with an obvious approach — just make it.
- The user wants an audit of an existing plan, not changes — that's `plan-review`.
- Pure product framing (success metrics, user research) with no intent to plan implementation yet.

## Workflow

### Phase 0: Detect input

| Input | Mode |
|---|---|
| `cdocs/requirements/*.md` | New plan from that requirement |
| Bare key (`PROJ-123`) | Use `cdocs/requirements/PROJ-123.md`; if it doesn't exist, stop and ask the user to pull it first or paste the text |
| Path to any other file | Copy its content verbatim into a new requirement file: `source: file`, `url:` the path |
| Free text | Save it verbatim as a requirement file: `source: inline`, `url: N/A` |
| `cdocs/plans/{folder}` | Revision: read every file in it, apply the user's change or resolved blockers, go to Phase 4 |
| Empty | Ask what to plan — never guess |

If a plan folder for this requirement already exists, it's a revision — never overwrite it silently.

### Phase 1: Restate & clarify

Write the Restatement bullets and confirm them with the user. Stop and ask (`AskUserQuestion`) when the deliverable is vague or has several readings, success is undefined, or the approach has a major fork that changes the plan. When the user can't answer now, don't guess. Apply the `references/needs-human.md` test to the open question:
- **It passes:** note it for a blocker in Phase 4, with the Type from that file and Raised `{date} · clarify gate`. Plan the rest around it.
- **It fails:** the requirement or the repository answers it, so resolve it yourself.

### Phase 2: Ground in the codebase

Glob/Grep first; `Read` only high-signal files. Fill `G1–G6` with real `path:line` and a real snippet from the area this change touches. Record the contracts the change must honor (types, API shapes, schema, config, flags) and the files to change.

### Phase 3: Architect & break down

- Approach in at most 5 sentences, at least one rejected alternative (none usually means the search was too shallow), and an explicit NOT Building list covering anything adjacent a reader might assume is included.
- Tasks: each at most one PR. The Brief plus the referenced `G`/`C`/`F` rows must be enough for an agent with no other context. Validate is a command that runs in this repo, plus an observable Expect.
- Every `AC` is satisfied by at least one task; every `F` is touched by at least one task.
- Risks: concrete, with actionable mitigations. Skip generic ones that fit every plan.

### Phase 4: Write & validate

1. `mkdir -p` the folders; write the requirement file (if this mode creates one), `README.md`, `context.md`, `tasks/*.md`, and `summary.md` (status `draft`, tasks `todo`, blockers from Phase 1 or `None`).
2. Run the validator from the repository root and fix until it passes:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/skills/plan-review/scripts/validate-plan.mjs" cdocs/plans/{folder}
   ```

### Phase 5: Review loop

Invoke `plan-review` with the `Skill` tool on the folder. It writes nothing; it returns a findings table (format: `plan-review/references/findings.md`).

- **`auto` findings**, any severity: fix them in the plan files. Record nothing.
- **Notices** (a planned column that resembles an existing one, not confirmed as a duplicate): change nothing and raise no blocker. Keep the notices from the last `plan-review` run for the hand-off.
- **`needs-human` findings**, any severity: add one blocker each, mapped from the finding:

  | Blocker field | Comes from |
  |---|---|
  | Title | short form of the Finding |
  | Type | the finding's Type |
  | Owner | the Type's Owner in `needs-human.md` |
  | Problem | the Finding |
  | Evidence | the Finding's evidence |
  | Needed to unblock | the Fix question |
  | Options | from the Fix for `decision-needed`, otherwise `N/A` |
  | Raised | `{date} · plan-review {P-id}` |
  | Blocks | the affected tasks (all tasks if plan-wide) |

  Then re-derive task status.

If anything was fixed, run `plan-review` again — **at most 2 runs** in total. After the last run, apply any remaining `auto` fixes and re-run only the validator. Then set plan status by the rule above. The review itself leaves no trace in the files.

### Phase 6: Hand off

Report the folder path, plan status, task count, each open blocker (ID, Type, Owner, Needed to unblock), and every notice from the last `plan-review` run (the planned column, the existing column it resembles, and its Question) — if the answer is "same data", revise the plan with `/spec-plan cdocs/plans/{folder}`. Then **stop**: implementing is the user's call, one task at a time with `/implement {KEY} {N}`.

## Anti-patterns

- Writing a file from memory instead of from its template — that's how runs drift apart.
- Copying a pattern, an acceptance criterion or a status into a second file instead of citing its ID.
- Restating the requirement so loosely that the Restatement could describe two different features.
- Skipping the clarify gate to "keep momentum", or guessing where a blocker belongs.
- A Validate step that can't run as written.
- Starting implementation after the hand-off.
