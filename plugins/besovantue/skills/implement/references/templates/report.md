---
task: {task-id}
plan: {plan-folder-path}
date: {date}
---
# {task-id}: {title}

## Files Changed

| File | Action | Plan row |
|---|---|---|
| `{path}` | {file-action} | {F id, or unplanned} |

## Validation

| Check | Command | Result |
|---|---|---|
| {task-id} Validate | `{command}` | {pass or fail} — {what was observed vs Expect} |
| {ac-id} | `{command}` | {pass or fail} — {what was observed} |

## Deviations

| ID | What | Why |
|---|---|---|
| D1 | {what differs from the task's Action or files; name every unplanned `path`} | {why the plan could not be followed as written} |

## Review

- **Verdict**: {impl-review verdict of the last run}
- **Runs**: {1 or 2}
- **Fixed**: {count of auto findings fixed, by ID per run, or None}
- **Blockers raised**: {B ids, or None}
- **Notices**: {from the last run: `{new column}` ~ `{table.column}` — {question}, separated by " · ", or None}
