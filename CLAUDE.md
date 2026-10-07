## Project Overview

`backend-dyra` is a NestJS REST API for DYRA, a laboratory/healthcare services company. It manages lab studies, pricing, branch locations, blog content, and generates PDF quotations.

## Commands

```bash
yarn start:dev       # Dev server with watch mode
yarn build           # Generates Prisma client then compiles (npx prisma generate && nest build)
npm run lint            # ESLint with auto-fix
npm run test            # Unit tests (Jest)
npm run test:e2e        # E2E tests
npm run test:cov        # Coverage report
npx prisma generate     # Regenerate Prisma client after schema changes
npx prisma studio       # Database GUI
npx prisma db push      # Push schema to DB (used in prod deploy)
npx prisma db seed      # Run seed script (ts-node prisma/seed.ts)
```

Run a single test file:

```bash
npx jest src/studies/studies.service.spec.ts
```

## Architecture

All routes are prefixed with `/api`. The app uses a standard NestJS module-per-feature layout under `src/`.

**Modules:** `authors`, `banners`, `branches`, `posts`, `price-sheets`, `quotations`, `reviews`, `services`, `states`, `studies`, `study-catalogs`, `tickets`

**Database:** PostgreSQL via Prisma. The `PrismaService` lives at `prisma/prisma/prisma.service.ts` (note the double-nested path) and uses the `@prisma/adapter-pg` native adapter. `PrismaModule` is global, so `PrismaService` is available throughout without re-importing.

**Global setup in `main.ts`:**

- `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`
- `PrismaClientExceptionFilter` maps Prisma errors to HTTP codes (P2002 → 409, P2025 → 404, P2003 → 400)
- CORS origins from `CORS_ORIGINS` env var

## Key Patterns

**Adding a new entity:**

1. Add model to the matching module file in `prisma/schema/` (multi-file schema: one `.prisma` per module, `generator`/`datasource` live in `prisma/schema/schema.prisma`; shared inventory enums in `inventory-enums.prisma`). Models reference each other across files without imports
2. Run `npx prisma generate` (and `npx prisma db push` for local dev)
3. Create a NestJS module under `src/<entity>/` with `controller`, `service`, and `dto/` subdirectory
4. Import the module in `src/app.module.ts`

**Error handling:** Use `handleDatabaseErrors()` from `src/common/handle-db-errors.ts` inside service catch blocks. The global `PrismaClientExceptionFilter` handles most Prisma exceptions automatically.

**Slugs:** Use `generateSlug()` from `src/common/utils/slugger.ts` when creating/updating `posts`, `services`, or `studies`.

**Branch scoping:** There is no "global" content concept in this app — every branch-owned resource belongs to exactly one branch via a required single `branchId` FK (never a `Branch[]` many-to-many). This applies to `Service`, `Author`, `Post`, `Banner`, `PriceSheets`, and `Study`. `Create*Dto`/`Update*Dto` take a single `branchId`, not `branchIds`. List endpoints accept an optional `branchId` query param and filter with a plain `where.branchId` match.
- `Post.authorId`, when set, must reference an `Author` in the same `branchId` — enforced in `posts.service.ts`, not at the DB level.
- `Study.branchId` must match the `branchId` of its `Study.service` (`assertServiceBelongsToBranch` in `studies.service.ts`), and `StudyOnPriceSheet` can only link a study to a `PriceSheets` row from that same branch — a study is never priced by another branch's tarifario. Both are enforced in the service layer, not at the DB level.
- **Study catalogs** (`src/study-catalogs/`): `StudySection`, `SampleType` and `StudyTechnique` (`id Int`, `name`, `isActive`, required `branchId`) are per-branch catalogs referenced by `Study.sectionId/sampleTypeId/techniqueId` (all nullable). One shared `StudyCatalogService` base + a controller factory serve `/api/study-sections`, `/api/sample-types` and `/api/study-techniques` (permissions `<route>:create/read/update/delete`). Names are unique per branch case-insensitively (checked in the service; the DB only enforces exact `@@unique([branchId, name])`). A catalog row used by any study can't be deleted (409) — deactivate it instead. `studies.service.ts` rejects catalog ids from another branch or inactive ones, and revalidates stored ids when a study changes branch. The price-sheet Excel import resolves the `section`/`sampleType`/`technique` name columns via `resolveStudyCatalogIds()` and **auto-creates** missing entries. Use `OR` of `equals` + `mode: 'insensitive'` for case-insensitive multi-name lookups — `in` + `mode: 'insensitive'` is broken with Prisma 7 + adapter-pg (it lowercases the column but not the values).
  - Migration in progress (phase 1): the old free-text columns are still in the DB as `Study.legacySection/legacySampleType/legacyTechnique` (`@map` to the original column names), globally omitted from query results in `PrismaService`, and only read by `prisma/scripts/backfill-study-catalogs.ts`. Phase 2 (after running the backfill in prod) removes those fields and the `omit` config. Note `start:prod` runs `prisma db push --accept-data-loss`, so dropping a column in the same deploy as its backfill loses data.
- **Panels (perfiles):** a `Study` with `isPanel = true` has ordered child studies through the `StudyPanelItem` join table (`panelId` → `childId`, many-to-many: one study can be in several panels, and a child can itself be a panel). Rules enforced in the service layer (`studies.service.ts`, price-sheet Excel import) using `src/studies/utils/panel-tree.util.ts`: only `isPanel` studies can have children; children must be in the panel's branch; no self-reference, duplicates or cycles (checked against the whole branch graph); `isPanel` can't be turned off while the panel has children; a study that belongs to any panel can't be deleted (deleting a panel cascades its links); a study with panel links can't change branch. Children are replaced as a whole via `PUT /api/studies/:id/panel-items`; `GET /api/studies/:id/panel-tree` returns the nested tree. `Study.isOrderable = false` marks parameters that only exist inside a panel — quotations reject them, and the public catalog should list with `isOrderable=true`. Quotations store a snapshot of a panel's breakdown in `QuotationItem.components` (rendered under the panel row in the PDF), so later panel edits never alter issued quotations.
- `Banner.order` is a per-`(branchId, placement)` queue — reordering logic in `banners.service.ts` scopes its shifts by both fields, not just `placement`.
- `Service`, `Author`, `Post`, and `Study` uniqueness (`name`/`nameKey`, `slug`, `code`) is scoped per branch via composite `@@unique([branchId, ...])`, not global — the same name/slug/code can exist in two different branches; they're unrelated records (e.g. "Análisis Clínicos" can be a separate `Service` row in two branches).
- `Safeguard.branchId` must match the `branchId` of its `Safeguard.employee` (derived from the employee, never taken from the request body) — enforced in `safeguards.service.ts`, not at the DB level.
- `Ticket.branchId` is required and set from `CreateTicketDto.branchId` — creating a ticket still validates `branchId` against the creator's assigned branches (`assertBranchAccess`). But once created, a ticket's *ownership* is deliberately decoupled from branch: a user without `tickets:update` can only create tickets (requires `tickets:create`) and see/comment/attach on tickets they created themselves (`Ticket.createdById === user.id`), and that access **never depends on branch** — not the ticket's branch, not the branches currently assigned to the user (`TicketsService.assertTicketAccess()` intentionally skips `assertBranchAccess` for the owner path) — so a user's full ticket history stays visible even after being reassigned to a different branch. A user with `tickets:update` (IT support) is the exception that *does* stay branch-scoped: they see/manage every ticket across their assigned branches, and are the only ones who can see internal notes (`TicketComment.isInternal`), change status/priority/assignees, or join the `ti_staff_room` realtime socket room.
  - **Assignees:** a ticket has N assignees via the `TicketAssignee` join table (no "primary" assignee — all count equally, incl. in `analytics/by-assignee`). Only `tickets:update` replaces the list via `PUT /api/tickets/:id/assignees` (`{ userIds }`, `[]` unassigns all). Any active user can be assigned (no `tickets:update` needed) as long as they have access to the ticket's branch and aren't its creator — checked in `assertAssigneesAreValid()`. `GET /api/tickets/:id/assignable-users` (`tickets:update`, optional `search`) returns exactly those candidates with an `isAssigned` flag — it exists because the `Soporte TI` role has no `users:read`. A current assignee without `tickets:update` can see/comment the ticket (no internal notes, no management) and gets in-app/socket notifications like the creator; that access is purely "is assigned right now" and ends the moment they're removed. `GET /api/tickets` for non-IT users returns created **or** assigned tickets; filters `assigneeId` and `assignedToMe=true`. Newly added assignees get an email (`MailService.sendTicketAssignedEmail`, link built from `ADMIN_APP_URL`, default `https://admin.dyranalitica.com`) sent fire-and-forget — a mail failure is logged, never rolls back the assignment. The SLA-overdue cron notifies only the ticket creator (plus the live `ti_staff_room` broadcast), not assignees.
  - **Ticket forms:** a `TicketSubcategory` can declare a `formType` (enum `TicketFormType`; each type is tied to one `Category` in `src/tickets/forms/ticket-forms.const.ts`, e.g. `STUDY_CREATE` → `COGNITI`). Creating a ticket in such a subcategory requires `CreateTicketDto.form`, stored in the 1:1 `TicketForm` (`type`, `data` JSON, `appliedAt/appliedBy`, `result`); a subcategory without `formType` rejects `form`. Each type has a handler (`TicketFormHandler`: data DTO + apply DTO, both validated manually with `validateFormPayload` since the bodies are untyped JSON) registered in `TicketFormsService` — adding a form = new enum value + definition + DTOs + handler. The creator or `tickets:update` can replace the data via `PATCH /api/tickets/:id/form` until it's applied; `POST /api/tickets/:id/form/apply` (`tickets:update`) re-validates and runs the action (`STUDY_CREATE` calls `StudiesService.create` in the ticket's branch with TI-provided `code`/`serviceId`/`title`/`abbreviation`…; prices must cover **every active** price sheet of the branch; a panel request (`isPanel: true`) may add ordered `panelItems`, each either `{ studyId }` (existing study of the branch) or `{ newStudy }` (new child: no prices, no `isPanel`, created with `isOrderable = false` — only the panel is priced), and at apply TI sends `newStudies` (code etc. per new child, same order); codes are pre-checked, then panel → children → `setPanelItems`, removing what was created if any step fails; `STUDY_UPDATE` takes `studyId` plus only the fields to change and optional per-price-sheet `prices` (any subset, upserted keeping `showPrice`), applies only what still differs from the current study via `StudiesService.update` + `StudyOnPriceSheet` upserts, and stores the before/after diff in `result`). Apply is claimed atomically via `appliedAt` and released if the action fails; it doesn't change the ticket status. A ticket with a form can't change category, and can only move to a subcategory with the same `formType`.

Intentional exceptions to the "single required `branchId`" rule:
- `Review`: strict `where.branchId` match, no "global" concept, but `branchId` is nullable (a review not tied to any branch is allowed).
- `User`: assigned to branches via a genuine `Branch[]` many-to-many (staff can work across branches) — see `src/common/utils/branch-access.util.ts` for scoping admin queries/writes to a user's assigned branches (used by `reviews`, `price-sheets`, `quotations`).

**Permissions:** The catalog in `prisma/constants/roles-permissions.ts` (`PERMISSIONS`, seeded via `seedRolesAndPermissions`) follows a `<module>:create/read/update/delete` convention per module, checked declaratively with `@Permissions('module:action')` (guarded globally by `PermissionsGuard`, registered in `auth.module.ts`). `tickets` is the deliberate exception: it only has `tickets:create` (report a ticket, see/comment/attach on your own) and `tickets:update` (IT support — see/manage every ticket in your branches; see the `Branch scoping` bullet above), no `read`/`delete`. The seeded `ROLES` are `Administrador` (all permissions), `Usuario` (read-only across modules except `users`/`roles`/`permissions`, plus `tickets:create` so any employee can report a ticket), and `Soporte TI` (`Usuario`'s permission set plus `tickets:update`).

**DTOs:** Use `class-validator` decorators. Always use `@Type(() => ...)` from `class-transformer` for nested objects and numeric coercion (query params arrive as strings).

**Pagination:** All list endpoints follow the same shape: `{ data: T[], total: number, page: number, limit: number, totalPages: number }`.

**Excel import (price sheets → studies):** the `parametros` column (comma-separated child codes, only valid on `isPanel = true` rows) replaces that panel's children after all rows are upserted, so a panel can reference studies from the same file; panel failures are reported in `panelErrors`.

**Excel import (Studies):** The `POST /api/studies/import` endpoint accepts `.xlsx`/`.xls` files via `FileInterceptor`. Batch processing uses 100-item chunks with a 60-second Prisma timeout; the response includes per-row success/error details.

**PDF generation (Quotations, Safeguards):** Uses `pdfkit` with server-side rendering. Company logo is embedded from `dist/assets/`. `safeguards` generates an equipment-custody document (`ADM.F.00`) for an employee with up to three optional, combinable sections (computer/mobile/vehicle); a vehicle section adds a second page with a fixed inspection checklist (`src/safeguards/constants/vehicle-inspection-items.const.ts`).

## Environment Variables

```
DATABASE_URL="postgresql://user:pass@localhost:5432/dyra_db?schema=public"
DB_USER=
DB_PASSWORD=
DB_NAME=
CORS_ORIGINS="http://localhost:4321"
PORT=3000
ADMIN_APP_URL="https://admin.dyranalitica.com"   # optional; base for links in ticket emails
```

A local PostgreSQL instance (or the `docker-compose.yaml` container) is required for development.
