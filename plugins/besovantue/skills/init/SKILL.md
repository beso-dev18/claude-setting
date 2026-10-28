---
name: init
description: Analyze the current codebase and generate persistent summary docs into cdocs/ — overview, architecture, conventions, and a business-domain map derived from ERD/migration/schema files. Use when the user runs /init, says "analyze this codebase", "onboard me to this repo", "generate project docs", "explain the database schema", or asks for a summary of the project's business domain from its tables/migrations.
argument-hint: "[--business-domain-only] [--force]"
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit]
version: 0.1.0
---

# Init

Analyze an unfamiliar (or familiar) codebase and produce four scannable summary docs, written to `cdocs/` at the project root so they persist across sessions instead of being re-derived from scratch every time.

## Output contract

All output goes in `cdocs/` at the repo root:

```
cdocs/
├── OVERVIEW.md          # what the project is, tech stack, common tasks, where-to-look table
├── ARCHITECTURE.md      # detailed tech stack, architecture pattern, key directories, traced data flow
├── CONVENTIONS.md       # naming, code patterns, git/PR conventions
└── BUSINESS-DOMAIN.md   # tables grouped by purpose, derived from ERD/migrations/schema
```

`cdocs/` is this project's designated home for **all** Claude-generated docs (not just this skill's) — reuse it rather than scattering summary files elsewhere. If `CLAUDE.md` doesn't already mention `cdocs/`, add a one-line note to it (see Phase 6) so future sessions know where to look and where to write.

## When NOT to use

- A one-off "explain this function" question — just answer it, don't generate files.
- The user wants a guided step-by-step walkthrough — that's `code-tour` territory, not a flat summary.
- Only the CLAUDE.md itself needs editing, nothing else — just edit it directly.

## Workflow

### Phase 1: Reconnaissance

Use Glob/Grep, not Read — don't open files yet, just find them. Run these in parallel:

```
1. Package manifests     → package.json, go.mod, Cargo.toml, pyproject.toml, pom.xml,
                            build.gradle, Gemfile, composer.json, mix.exs, pubspec.yaml
2. Framework fingerprints → next.config.*, nuxt.config.*, angular.json, vite.config.*,
                            django settings, flask/fastapi entry, rails config
3. Entry points          → main.*, index.*, app.*, server.*, cmd/, src/main/
4. Directory tree         → top 2 levels, ignoring node_modules, vendor, .git, dist,
                            build, __pycache__, .next, cdocs
5. Config & tooling       → .eslintrc*, .prettierrc*, tsconfig.json, Makefile, Dockerfile,
                            docker-compose*, .github/workflows/, .env.example
6. Test structure         → tests/, test/, __tests__/, *_test.go, *.spec.ts, *.test.js
7. Schema / migration sources (for Phase 5) →
     - ORM schema files: prisma/schema.prisma, db/schema.rb, app/models/*.py (Django),
       models/*.py (SQLAlchemy), entities/*.entity.ts (TypeORM), models/*.js (Sequelize/Mongoose)
     - Migration dirs: migrations/, db/migrate/, alembic/versions/, priv/repo/migrations/
     - Raw SQL: schema.sql, *.dbml, db/structure.sql
```

Prefer a **consolidated** schema source over replaying incremental migrations: `prisma/schema.prisma`, `db/schema.rb`, or a `structure.sql`/dump reflect final state in one read. Only scan individual migration files when no consolidated file exists, and even then, read them in order and fold each table to its final shape — don't report a column a later migration dropped.

### Phase 2: Project overview → `OVERVIEW.md`

- **What it is**: 2-3 sentences on what the project does and who it serves — derived from README/package description, not invented.
- **Tech stack table**: language(s) + version constraints, framework(s) + major libraries, database(s) + ORM, build tool/bundler, test runner, CI/CD platform.
- **Common tasks**: every runnable command detected in Phase 1 — dev server, run tests, lint, typecheck, build for production, database migrations. Copy-paste ready, from actual `package.json`/`Makefile`/CI scripts, never guessed.
- **Where to look** — a quick-nav table from intent to path, e.g.:

  | I want to... | Look at... |
  |---|---|
  | Add an API endpoint | `<detected path>` |
  | Add a UI page/view | `<detected path>` |
  | Add a database table/migration | `<detected path>` |
  | Add a test | `<detected path>` |
  | Change build/CI config | `<detected path>` |

  Only include rows you can back with an actual detected path — omit rows you can't support instead of guessing.

### Phase 3: Architecture mapping → `ARCHITECTURE.md`

**Tech stack** (detail, not just names):
- Language(s) and version constraints (from `.nvmrc`, `engines`, `go.mod`, lockfiles).
- Framework(s) and major libraries actually imported, not just listed as a dependency.
- Database(s) and ORM/query layer.
- Build tools and bundlers.
- CI/CD platform.

**Architecture pattern**:
- Monolith, monorepo, microservices, or serverless.
- Frontend/backend split, or full-stack.
- API style: REST, GraphQL, gRPC, tRPC — identify from route/schema definitions, not assumption.

**Key directories** — map every top-level (and notable second-level) directory to its purpose in a table, e.g.:

```
src/components/  → React UI components
src/api/         → API route handlers
src/lib/         → Shared utilities
src/db/          → Database models and migrations
tests/           → Test suites
scripts/         → Build and deployment scripts
```

**Data flow** — trace one concrete request end to end and name the actual files/functions involved at each hop:
- Where does a request enter? (router, handler, controller)
- How is it validated? (middleware, schemas, guards)
- Where does the business logic live? (services, models, use cases)
- How does it reach the database? (ORM, raw queries, repositories)

### Phase 4: Convention detection → `CONVENTIONS.md`

**Naming conventions**:
- File naming: kebab-case, camelCase, PascalCase, or snake_case — state which one, from actual filenames, not the language's default.
- Component/class naming patterns.
- Test file naming: `*.test.ts`, `*.spec.ts`, `*_test.go`, etc.

**Code patterns**:
- Error handling style: try/catch, Result/Either types, error codes.
- Dependency injection vs. direct imports.
- State management approach (if frontend).
- Async patterns: callbacks, promises, async/await, channels/goroutines.

**Git conventions** (from `git log --oneline -30` and `git branch -a`):
- Branch naming pattern from recent branches.
- Commit message style from recent commits (conventional commits, imperative mood, ticket-prefixed, etc.).
- PR workflow: squash, merge commit, or rebase — infer from merge commit shapes if visible.
- If the repo has no commits yet, or history is too shallow (e.g. `git clone --depth 1`) to detect any of the above, say so explicitly instead of guessing — "Git history unavailable or too shallow to detect conventions."

### Phase 5: Business domain mapping → `BUSINESS-DOMAIN.md`

From the schema/migration sources found in Phase 1:

1. **Extract tables**: name, columns (name + type + key constraints), foreign keys, indexes where visible.
2. **Build the relationship graph**: which tables reference which via FK.
3. **Group tables into categories inferred from what you actually found** — do not force a fixed taxonomy. Typical buckets that emerge (use only the ones that fit, name them for this project):
   - Identity & Access (users, roles, sessions, permissions, auth_*)
   - Core domain entities (whatever this project is actually about — products, orders, patients, listings...)
   - Transactions / billing (orders, payments, invoices, transactions)
   - Content (posts, comments, media, attachments)
   - Configuration / lookup (small reference tables mostly pointed *to*, rarely pointing out — enum-like)
   - Junction / many-to-many (two FKs, little else)
   - Audit / logging (audit_log, events, notifications)
4. **For each table**, write: one-line purpose (inferred from name + columns, not guessed business meaning you can't support), key columns, relationships (references / referenced by).
5. If no schema or migration source is found, write a short `BUSINESS-DOMAIN.md` stub stating that none was detected — don't fabricate a schema.

Suggested format:

```markdown
# Business Domain

## <Category name>
### `<table_name>`
Purpose: <one line>
Key columns: <col (type), ...>
Relationships: references <table>.<col>; referenced by <table>.<col>

...
```

### Phase 6: Write files

- Create `cdocs/` if it doesn't exist (`mkdir -p cdocs`).
- For each of the four files: if it already exists, **read it first** and merge/update rather than blindly overwrite — call out what changed. Pass `--force` to skip the merge and regenerate from scratch.
- **`CLAUDE.md` handling**:
  - If the project's `CLAUDE.md` doesn't already reference `cdocs/`, append a short note (don't restructure the rest of the file):
    ```markdown
    ## Generated docs
    `cdocs/` holds Claude-generated project documentation (overview, architecture, conventions, business domain) — see `/init`. Regenerate with `/init --force`; edit directly for corrections.
    ```
  - If the project has **no `CLAUDE.md` at all**, offer to generate a minimal starter (not a copy of `OVERVIEW.md` — just the day-to-day essentials): detected build/dev/test/lint commands, key directory map, and the `cdocs/` note above. Ask before creating it; never silently create project instruction files.
  - If `CLAUDE.md` already exists, never replace it outright — only append, and show what was added.
- Report the list of files written/updated to the user. Don't print full contents back into chat — the files are the deliverable.

## Best practices

1. **Don't read everything** — reconnaissance is Glob/Grep; `Read` only ambiguous or high-signal files (a consolidated schema, package.json scripts, entry point).
2. **Verify, don't guess** — if config suggests one framework but the code uses another, trust the code. If a business meaning can't be supported by column/table evidence, say "purpose unclear" rather than inventing one.
3. **Respect existing `cdocs/` files and `CLAUDE.md`** — merge and call out diffs, don't silently clobber.
4. **Stay concise** — each file should be scannable in under 2 minutes.
5. **Flag unknowns explicitly** — "could not determine test runner" beats a wrong guess.

## Anti-patterns

- Don't dump every dependency — only the ones that shape how code is written.
- Don't describe self-evident directory names (`src/` doesn't need an explanation).
- Don't replay every migration line-by-line in `BUSINESS-DOMAIN.md` — report final table shape, not history.
- Don't write any of these four files outside `cdocs/`.
