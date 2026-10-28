# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A personal **Claude Code plugin marketplace**: a set of plugins (agents, skills, commands, hooks, rules, MCP configs) that can be installed on any machine with `/plugin marketplace add` + `/plugin install`, instead of hand-copying files into `~/.claude/`.

The repo is currently empty. It is modeled on two local reference clones — read them before designing anything new:

| Reference | Path | Use it for |
|-----------|------|------------|
| `anthropics/claude-plugins-official` | `~/vscode/claude-plugins-official/` | Canonical plugin/marketplace layout. `plugins/example-plugin/` is the minimal template; `plugins/plugin-dev/skills/*/SKILL.md` documents commands, agents, skills, hooks, MCP, and `${CLAUDE_PLUGIN_ROOT}`. |
| `affaan-m/everything-claude-code` (ECC) | `~/vscode/everything-claude-code/` | Content to port (agents/skills/rules/hooks) and validator gotchas in `.claude-plugin/PLUGIN_SCHEMA_NOTES.md`. |
| Claude Code official docs | https://code.claude.com/docs | Authoritative reference for plugin/marketplace schema, hooks, skills, and CLI behavior — check when the local reference clones are ambiguous or out of date. |

The user's current `~/.claude/` (38 agents, 74 commands, `rules/{common,web,typescript,...}`) was installed manually from ECC. This repo exists to replace that with proper plugins — when porting, take the ECC copies as source, not `~/.claude/`.

## Target layout

```
.claude-plugin/marketplace.json     # marketplace root — lists every plugin under ./plugins
plugins/
  <plugin-name>/
    .claude-plugin/plugin.json      # required; name + version at minimum
    skills/<skill>/SKILL.md         # preferred for BOTH model-invoked skills and /slash commands
    commands/<cmd>.md               # legacy layout, loaded identically to skills/ — avoid for new work
    agents/<agent>.md               # auto-discovered
    hooks/hooks.json                # auto-discovered
    .mcp.json                       # auto-discovered
    scripts/                        # referenced from hooks via ${CLAUDE_PLUGIN_ROOT}
```

Split by concern (e.g. `core-workflow`, `<language>-review`, `hooks`, `rules`), not one monolithic plugin — ECC's single 292-skill plugin is what this repo is trying to slim down. Each plugin should be independently installable.

## Generated docs

`cdocs/` (repo root) is the designated home for **all** Claude-generated project documentation — summaries, analysis, generated reports. Plugins/skills that produce persistent docs (e.g. `besovantue`'s `/init` skill — overview/architecture/conventions/business-domain files) write there, not scattered at the repo root or under `.claude/`.

## Commands

```bash
claude plugin validate plugins/<name>          # validate a plugin manifest + its skills/agents/commands
claude plugin validate .                       # validate the marketplace manifest
claude plugin details <name>@<marketplace>     # component inventory + projected token cost (watch this — it is the budget)
claude plugin eval plugins/<name>              # run evals/ (case.yaml or prompt.md + graders/*.md)
claude plugin tag plugins/<name>               # create <name>--v<version> tag; checks plugin.json and marketplace entry agree

# Local install loop (from any project on this machine)
claude plugin marketplace add /Users/beso/Claude/ClaudeSetting
claude plugin install <name>@<marketplace-name>
claude plugin marketplace update <marketplace-name>   # after editing; restart Claude Code to reload
```

Remote install (what "use anywhere" means): `claude plugin marketplace add <github-user>/<repo>` then `claude plugin install <name>@<marketplace-name>`.

Note: the ECC marketplace is registered at `~/.claude/plugins/marketplaces/ecc` and `ecc@ecc` is disabled in `~/.claude/settings.json`; do not enable it while testing plugins here or hooks/skills will collide.

## Manifest rules (validator is strict and its errors are vague)

From ECC's `PLUGIN_SCHEMA_NOTES.md`, learned via repeated install failures:

- `plugin.json` **must** include `version`. Component path fields (`commands`, `skills`) must be **arrays** (`["./skills/"]`), never strings.
- **Do not** add an `agents` field — rejected with `agents: Invalid input`. `agents/*.md` is discovered by convention.
- **Do not** declare `hooks/hooks.json` in `plugin.json` — it is auto-loaded and declaring it errors with `Duplicate hooks file detected`. Only additional hook files may be declared.
- Set `"mcpServers": {}` in `plugin.json` if the plugin has a root `.mcp.json` you do **not** want auto-bundled (generated MCP tool names from long plugin slugs can exceed 64 chars on strict gateways). Keep plugin names short for the same reason.
- Marketplace `name` slugs are **immutable** once anyone has installed them; use `displayName` for labels, or the top-level `renames` map in `marketplace.json` to migrate.
- All paths relative to plugin root, starting with `./`. Hook commands must use `${CLAUDE_PLUGIN_ROOT}`, never absolute paths (ECC has a CI check, `validate-no-personal-paths.js`, for exactly this).

Minimal known-good `plugin.json`:

```json
{ "name": "x", "version": "0.1.0", "skills": ["./skills/"] }
```

## Component formats

- **Agent** (`agents/*.md`): YAML frontmatter `name`, `description`, `tools`, `model`. `tools` is a comma-separated **scalar** (`tools: Read, Grep, Glob`), not a YAML list. Description should state trigger conditions ("Use PROACTIVELY when…").
- **Skill** (`skills/<name>/SKILL.md`): frontmatter `name`, `description`, `version`. Model-invoked skills put the trigger phrases in `description`; user-invoked (slash) skills add `argument-hint` and `allowed-tools: [Read, Glob, Grep]` (list form is correct here). Supporting material goes in `references/`, `examples/`, `scripts/` beside `SKILL.md`.
- **Hooks** (`hooks/hooks.json`): `{ "hooks": { "<Event>": [ { "matcher": "...", "hooks": [ { "type": "command", "command": "...", "timeout": N } ] } ] } }`. `matcher` is a tool-name regex (`Edit|Write`); per-hook `if` narrows to argument patterns (`Bash(git commit:*)`); `asyncRewake` + `rewakeMessage` makes a hook non-blocking and re-invokes Claude with its output. See `claude-plugins-official/plugins/security-guidance/hooks/hooks.json` for a full example.
- Naming: kebab-case everywhere (`python-reviewer.md`, `tdd-workflow/`).

## Porting from ECC

- ECC agents carry a "Prompt Defense Baseline" block at the top of every agent — keep it out of ported agents unless deliberately adopting it; it costs tokens on every spawn.
- ECC's `hooks/hooks.json` wraps every hook in a long inline `node -e` bootstrap that searches `~/.claude/plugins/**` for its own root. That is unnecessary in a proper plugin — use `${CLAUDE_PLUGIN_ROOT}/scripts/...` directly.
- ECC ships language rule sets under `rules/<lang>/` extending `rules/common/`. Rules are not a plugin component type; either fold them into a skill that loads them on demand, or keep them as an install script target. Decide per plugin, and say which in the plugin's README.
- ECC's `legacy-command-shims/` and `commands/` are the old layout; port the underlying `skills/<name>/SKILL.md` instead.
