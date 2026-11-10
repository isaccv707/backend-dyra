# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Role

DYRA REST API + WebSocket (multi-branch clinical laboratory). Owner of the database. **Consumers:** `../admin-dyra-web` (almost every route, with JWT, and the `/tickets` socket) and `../dira-astro` (only `@Public()` routes). System context: `../CLAUDE.md`.

## Stack

NestJS 11 · Prisma 7 (`@prisma/adapter-pg`, multi-file schema) · PostgreSQL 14 (docker) · TypeScript 5.7 · Jest 30 · Socket.IO 4 · `@nestjs/swagger` (CLI plugin) · `@nestjs/schedule` · `@nestjs/throttler` · pdfkit · xlsx · nodemailer · BullMQ (`@nestjs/bullmq` 11; 12 is ESM-only) · cloudinary. Node 22. Package manager: **yarn 1** (single lockfile `yarn.lock`; don't use npm).

## Commands

```bash
yarn install
docker compose up -d            # Postgres :5432, data in ./postgres
yarn start:dev                  # http://localhost:3000/api (watch)
yarn build                      # prisma generate + nest build → dist/
yarn test                       # unit (Jest, *.spec.ts in src/)
npx jest src/studies/studies.service.spec.ts   # one file
npx jest -t "test name"                        # one test
yarn test:cov
yarn lint                       # ESLint with --fix (modifies files)
yarn lint:check                 # ESLint without --fix (what CI runs)
yarn format                     # Prettier src/ and test/
npx prisma generate             # after changing prisma/schema/*.prisma
yarn db:migrate --name <change> # prisma migrate dev: creates and applies a migration on the local DB
yarn db:deploy                  # prisma migrate deploy (what start:prod runs)
yarn db:status                  # prisma migrate status
npx prisma db seed              # ts-node prisma/seed.ts
npx prisma studio
yarn openapi:export             # nest build + writes openapi.json (contract for the frontends)
```

- `yarn test:e2e` (`test/jest-e2e.json`): ticket forms, devices and vehicles with their transfers (`DEVICES_E2E_TRACE=<path>` / `VEHICLES_E2E_TRACE=<path>` dump normalized responses to compare before/after a refactor) against a real DB, Redis and `TICKET_SECRET_KEY` (creates and deletes its own data; local or CI DB only).
- Seed: always roles/permissions, admin user (`ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`; assigned to every existing branch) and ticket subcategories. Only if `SEED_DEV_BRANCH=true` and `NODE_ENV!=production`: states + default branch `a1b2c3d4-0001-4000-8000-000000000001` (must run before the admin). **Never** enable `SEED_DEV_BRANCH` against production: `seedBranches` updates the row if it exists.

## Structure

```
src/<module>/        controller, service, dto/, *.spec.ts  (one Nest module per feature)
src/auth/            login/OTP/reset, JwtStrategy, global guards, @Public/@Permissions/@CurrentUser
src/common/          Prisma filter, handle-db-errors, paginate.util, branch-access.util,
                     slugger.util, excel utils, cors.util, cloudinary/, pdf/
src/devices/         DevicesService (logic-free façade) + services/ device-write, device-query,
                     device-assignment, device-transfer, device-validation, device-safeguard
src/vehicles/        VehiclesService (logic-free façade) + services/ vehicle-write, vehicle-query,
                     vehicle-assignment, vehicle-transfer, vehicle-validation, vehicle-safeguard
src/safeguards/      SafeguardsService (logic-free façade) + services/ safeguard-generation (versions from
                     assigned devices), -records, -signature (Cloudinary), -pdf (ADM.F.18);
                     e2e in test/safeguards.e2e-spec.ts (SAFEGUARDS_E2E_TRACE=<path>, mocked Cloudinary)
src/vehicle-safeguards/  VehicleSafeguardsService: same pattern (generation with checklist, records, signature,
                     pdf ADM.F.01); e2e in test/vehicle-safeguards.e2e-spec.ts (VEHICLE_SAFEGUARDS_E2E_TRACE)
src/mail/            MailService (nodemailer) + MailQueueService/MailProcessor (BullMQ queue `mail`, 5 retries)
src/tickets/         REST + WS gateway /tickets + SLA cron (hourly); TicketsService (lifecycle, logic-free façade
                     over services/ ticket-create, ticket-query, ticket-update, ticket-classification;
                     e2e in test/tickets.e2e-spec.ts with TICKETS_E2E_TRACE=<path>)
                     + notifications/ (TicketNotificationsService: façade over services/ -dispatch, -inbox,
                     ticket-email-preferences; logs with context TicketNotificationsService; e2e in
                     test/ticket-notifications.e2e-spec.ts with TICKET_NOTIFICATIONS_E2E_TRACE=<path>),
                     comments/, assignees/, forms/ticket-form-workflow (façade over
                     forms/workflow/ ticket-form-edit, -decision, -access, -state; logs with context
                     TicketFormWorkflowService; e2e in test/ticket-form-workflow.e2e-spec.ts with
                     TICKET_FORM_WORKFLOW_E2E_TRACE=<path>);
                     shared types/labels in tickets.shared.ts; specs with testing/tickets-test-context
src/studies/         StudiesService (logic-free façade: controllers and other modules only use this one)
                     + services/ study-validation, study-write, study-query, study-panel, study-price, study-export;
                     includes in constants/study-includes.const, helpers in utils/study-mappers.util
src/services/        ServicesService (logic-free façade) + services/ service-write, service-public-query,
                     service-admin-query; e2e in test/services.e2e-spec.ts (SERVICES_E2E_TRACE=<path>)
src/quotations/      QuotationsService (logic-free façade) + services/ quotation-create (prices from the
                     price sheet, panel snapshot, totals with VAT included), -records, -pdf; e2e in
                     test/quotations.e2e-spec.ts (QUOTATIONS_E2E_TRACE=<path>, includes the site's POST /quotations/pdf)
src/swagger.ts       createOpenApiDocument(): used by main.ts and src/scripts/export-openapi.ts
openapi.json         generated contract (versioned; CI fails if it is out of date)
prisma/schema/       one .prisma per module; generator/datasource in schema.prisma
prisma/migrations/   0_init (baseline = main's schema as of 2026-10-20) + new migrations
prisma/migrations-legacy/  history prior to the baseline; reference only, Prisma doesn't read it
prisma/prisma/       PrismaModule (global) and PrismaService (doubly nested path)
prisma/seeds/, prisma/constants/   seeds and catalogs (roles-permissions.ts)
prisma/scripts/      one-off backfills for data migrations
src/assets/          logo for PDFs (copied to dist/assets)
```

Modules: auth, users, roles-permissions, branches, states, services, studies, study-catalogs, price-sheets, quotations, posts, authors, banners, reviews, contact-messages, employees, locations, devices, safeguards, vehicles, vehicle-safeguards, tickets.

## Patterns and conventions

- **Bootstrap (`src/main.ts`):** global prefix `/api`; Swagger at `/api` (`/api-json`) with `createOpenApiDocument()` from `src/swagger.ts` (always after `setGlobalPrefix`); `ValidationPipe({ whitelist, forbidNonWhitelisted })`; `PrismaClientExceptionFilter` (P2002→409, P2025→404, P2003→400); CORS from `CORS_ORIGINS`; `extended` query parser.
- **New entity:** model in `prisma/schema/<module>.prisma` (models reference each other across files without imports) → `yarn db:migrate --name <change>` (generates the migration and the client) → `src/<entity>/` with controller/service/dto → import in `src/app.module.ts` → permissions in `prisma/constants/roles-permissions.ts`. Mimic `src/services/` or `src/studies/`.
- **Response DTOs:** tickets documents its responses with classes in `src/tickets/dto/ticket-response.dto.ts` (`@ApiResponse({ type })`); `ticket-response.dto.spec.ts` compares those classes (via `openapi.json`) with Prisma columns and includes: when adding a column or include, update the DTO and run `yarn openapi:export`.
- **DTOs:** `class-validator`; `@Type(() => …)` for nested objects and numbers (query params arrive as strings). Swagger is inferred from the DTO; document with `@ApiOperation`/`@ApiResponse` as in `services.controller.ts`.
- **Errors:** `handleDatabaseErrors()` (`src/common/handle-db-errors.ts`) in service catch blocks; messages in Spanish (studies: `handleStudyDbErrors()`).
- **Pagination:** `{ data, total, page, limit, totalPages }` via `src/common/utils/paginate.util.ts`.
- **Slugs:** `generateSlug()` from `src/common/utils/slugger.util.ts` (posts, services, studies).
- **Permissions:** `@Permissions('module:action')`, global guard in `auth.module.ts`. Open routes: `@Public()`. Seeded roles: `Administrador` (everything), `Usuario` (read-only except users/roles/permissions/contact-messages + `tickets:create`), `Soporte TI` (Usuario + `tickets:update`). `tickets` only has `create` and `update`.
- **Prisma:** for case-insensitive searches over several names use `OR` of `equals` + `mode: 'insensitive'`; `in` + `insensitive` is broken with Prisma 7 + adapter-pg.

## Domain rules

**Branch (`branchId`):** there is no "global" content. `Service`, `Author`, `Post`, `Banner`, `PriceSheets`, `Study` have a single required `branchId` (never `Branch[]`); DTOs receive `branchId`, not `branchIds`; lists filter with an optional `where.branchId`. Uniqueness (`name`/`nameKey`, `slug`, `code`) is per branch (`@@unique([branchId, …])`).
- Exceptions: `Review.branchId` is nullable; `User` ↔ `Branch[]` is a real many-to-many — admin writes and reads are scoped with `assertBranchAccess`/`userBranchFilter` (`src/common/utils/branch-access.util.ts`).
- Validated in the service, not in the DB: `Post.authorId` same branch; `Study.branchId` = its `service`'s branch (`assertServiceBelongsToBranch`); `StudyOnPriceSheet` only with price sheets of the same branch; `Safeguard.branchId` is derived from the employee.
- `Service` writes scoped with `assertBranchAccess`: create validates `dto.branchId`; edit/delete, the service's branch (404 before 403); moving (`branchId` in PATCH) also validates the destination.
- Signed responsibility forms: `Employee.hasSignedResponsibility` is only the device one (`Safeguard`, ADM.F.18) and `Employee.hasSignedVehicleResponsibility` the vehicle one (`VehicleSafeguard`, ADM.F.01); they are independent (some employees have devices and no vehicle, and vice versa). Signing the current version sets its flag to `true`; generating a new version sets it back to `false`.
- `Banner.order` is a queue per `(branchId, placement)`.

**Studies:**
- `branchId` is set on create and never changes (no transfers). Every write and admin read validates the user's branches; public reads don't.
- `DELETE /studies/:id` only deactivates; reactivate with `PATCH isActive: true`. Public reads only return active ones; admin uses `/inactive`. Quotations reject inactive ones.
- `code` is trimmed and uppercased. `slug` comes from the DTO or from `name`; renaming doesn't change the slug. `title` optional (default `name`; responses use `studyTitle()`). Slugs unique per branch → `GET /studies/by-slug/:slug?branchId=` (required); `/:id` only accepts UUIDs. `deliveryTime` in days.
- **Orderable = has a price:** active and with `StudyOnPriceSheet` in an active price sheet. Public: `GET /studies/orderable` (public price sheets only); admin: `GET /studies/admin/orderable`.
- `eligiblePatients` (M/F/A, DIAS/AÑOS) is flattened into columns and `toStudyResponse()` regroups it. `referenceValues[]` are quantitative (`minValue`/`maxValue`, `gender` MASCULINO/FEMENINO/AMBOS, `unitAge`) or qualitative (`text`); rules in `assertValidReferenceValues()`; sending the list replaces it entirely.
- **Catalogs** (`StudySection`, `SampleType`, `StudyTechnique`, per branch): `sectionId` and `sampleTypeId` required on create and cannot be cleared; `techniqueId` optional (accepts `null`). A controller factory serves `/api/study-sections|sample-types|study-techniques`. Names unique case-insensitive (validated in the service). In use → not deleted (409), deactivated instead. Bulk import `POST /api/study-catalogs/import?branchId=` only creates (existing → `skipped`).
- Migration in progress (phase 1): columns `Study.legacySection/legacySampleType/legacyTechnique` globally omitted in `PrismaService`; only `prisma/scripts/backfill-study-catalogs.ts` reads them. Phase 2 drops them **in a deploy after** the backfill.
- **Panels (profiles):** `isPanel = true` with ordered children via `StudyPanelItem` (many-to-many, a child can be a panel). Rules in `src/studies/utils/panel-tree.util.ts`: only panels have children, same branch, no cycles/duplicates/self-reference, active children, a study inside a panel can't be deactivated, `isPanel` can't be turned off while it has children. Full replacement with `PUT /studies/:id/panel-items`; tree at `GET /studies/:id/panel-tree`. A panel has no `units`/`decimals`/`referenceValues`. Quotations store a snapshot in `QuotationItem.components`.
- **Study Excel import:** `StudyExcelImportService` (`src/studies/study-excel-import.service.ts`) serves `POST /studies/import?branchId=` (no prices; a row with `price` → error). It orchestrates, in this order, `services/study-import-*`: `parser` (file and single row) → `rules` (against existing studies) → `panels.rejectCyclicPanels` (`parametros` cycles with current or in-file panels: the row goes to `invalid` and isn't saved) → `writer` (upserts) → `panels`; `template` generates the template. The `parametros` column (child codes, panels only) is applied last. Resolves/auto-creates catalogs with `resolveStudyCatalogIds()`. Slug only on create (`assignNewStudySlugs()`). Response: `invalid`, `importErrors`, `panelErrors`, `created`/`updated`. E2E: `test/study-import.e2e-spec.ts` (`STUDY_IMPORT_E2E_TRACE=<path>` dumps responses and state to compare before/after a refactor).
- **Price import:** `POST /price-sheets/:id/import-excel` (`PriceSheetPriceImportService`, permission `price-sheets:update`) only upserts `StudyOnPriceSheet` by `code` + `price` (`name` is ignored; empty `price` → `skipped`; missing/inactive code → `invalid`). It never creates or edits studies nor touches `showPrice`. Response: `{ totalRows, created, updated, skipped, invalid }`.

**Tickets:**
- `branchId` required and validated against the creator's branches. Whoever lacks `tickets:update` can only create and see/comment/attach their own (`createdById`) or those they're assigned to — **regardless of branch** (`assertTicketAccess()` skips `assertBranchAccess` on purpose).
- `tickets:update` (Soporte TI) is scoped by branch: manages every ticket of their branches, sees internal notes (`TicketComment.isInternal`), changes status/priority/assignees and joins the socket room `ti_staff_room`.
- N assignees (`TicketAssignee`, no primary): `PUT /tickets/:id/assignees`; valid candidates in `GET /tickets/:id/assignable-users` (`assertAssigneesAreValid()`: active, with access to the branch, not the creator). **Notifications:** who receives what (in-app and email) is defined only in `TICKET_NOTIFICATION_RULES` (`src/tickets/notifications/ticket-notification-rules.ts`) and sent with `TicketNotificationsService.dispatch()`; the actor never receives their own notification. IT = active users with `tickets:update` for the branch or global. Emails always go through the queue (`MailQueueService.enqueue`, never `await` SMTP inside a request); exception: the form access email, which reports `emailSent`. A notification failure doesn't fail ticket creation.
- **Time-based lifecycle** (`TicketSlaService`, cron every 10 min in `tickets-sla.cron.ts`): warning at 75% of the SLA (assignees or IT), overdue notice (creator + assignees; email to assignees), escalation to the `Administrador` role if still overdue and unassigned after `TICKET_ESCALATION_HOURS` business hours, and auto-close of RESOLVED tickets after `TICKET_AUTO_CLOSE_DAYS` business days. Each step claims the ticket with a conditional `updateMany` (`slaWarnedAt`, `overdueNotifiedAt`, `escalatedAt`); changing priority/reopening clears them. If the creator comments on a RESOLVED ticket, it reopens to IN_PROGRESS. System actions: `TicketComment.authorId`/`TicketEvent.actorId` = null.
- **Form secrets** (TeamViewer password, the handler's `secretField`): stored encrypted (AES-256-GCM) in `TicketForm.encryptedSecret`, never in `data`; the column is globally omitted in `PrismaService` and only `GET /tickets/:id/form/secret` reads it (branch IT or assignees, not the creator; only with the ticket `IN_PROGRESS`). It is single-session: it only exists in `FORM_SECRET_STATUSES` (`OPEN`, `IN_PROGRESS`); every path that moves the ticket out of those must call `purgeFormSecret()` inside its transaction. To work on it again, it is re-entered by editing the form with the ticket in progress.
- **Analytics** (`/tickets/analytics/*`, permission `tickets:update`, scoped to the user's branches): `TicketsAnalyticsService` is a logic-free façade over `analytics/services/`: `filters` (from/to as local day in `BUSINESS_TIMEZONE`, Prisma `where` and SQL fragments), `summary` (summary and trend), `breakdown` (by user, assignee and category), `report` (xlsx/pdf). Breakdowns go from highest to lowest `total`/`count`; ties by name (user, assignee, subcategory) or by category label (`localeCompare` `es`). The summary's `byStatus`/`byPriority` follow `groupBy` order (not guaranteed). E2E: `test/tickets-analytics.e2e-spec.ts` (`TICKETS_ANALYTICS_E2E_TRACE=<path>` dumps normalized responses to compare before/after a refactor).

**Contact messages** (`src/contact-messages/`): the site's `/contact` form → `POST /contact-messages` (`@Public`, throttled 5 per 10 min per IP, honeypot `website`: filled → 201 without storing, `privacyAccepted` must be `true` → `privacyAcceptedAt`). Required `branchId` (active branch). Status `NEW → IN_PROGRESS → RESOLVED | DISCARDED`; `PATCH /:id/status` changes status and/or adds a note, and every call (plus the creation) leaves a `ContactMessageStatusChange` (who/when). Email to active users with `contact-messages:update` for the branch or global, through the queue; a notification failure doesn't fail the submission. `GET /pending-count` (NEW, user's branches) feeds the admin badge. Patient personal data: `contact-messages:*` is excluded from the `Usuario` role.

**PDF:** server-side pdfkit (quotations, device safeguards `ADM.F.18` with computer/mobile sections and vehicle safeguards `ADM.F.01`; checklist in `src/vehicle-safeguards/constants/vehicle-inspection-items.const.ts`). Logo from `dist/assets/`. Signed documents: direct upload to Cloudinary with a signature generated here (the secret never leaves the backend).

## Environment variables (see `.env.example`)

| Variable | Use |
|---|---|
| `DATABASE_URL` | Prisma connection |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Postgres container in `docker-compose.yaml` |
| `PORT` | HTTP port (default 3000) |
| `CORS_ORIGINS` | Allowed origins for REST + WS, comma-separated |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | JWT signing and lifetime (default 7d) |
| `ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Seed admin user |
| `SEED_DEV_BRANCH` | `true` = seed the development branch (local only) |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM` | SMTP (OTP, ticket assignment) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Signing uploads of signed documents |
| `ADMIN_APP_URL` | Base for links in emails (optional) |
| `TICKET_AUTO_CLOSE_DAYS`, `TICKET_ESCALATION_HOURS` | Auto-close (default 3 business days) and escalation (default 2 business hours) |
| `REDIS_URL` | **Required.** Mail queue (BullMQ) and Socket.IO across instances (`docker compose` starts redis) |
| `TRUST_PROXY` | Proxy hops to trust (e.g. `1` behind Railway) so `req.ip` is the client's: per-IP rate limits (login, contact form). Empty locally |
| `TICKET_SECRET_KEY` | **Required.** 32 bytes in base64: encrypts ticket form secrets. The app doesn't start without it |

## Integration

- Changing a route, DTO, response shape or permission **requires checking both frontends**: `../admin-dyra-web/src/api/` + `src/interfaces/` and `../dira-astro/src/api/` + `src/interfaces/`. Warn about what breaks.
- The public site only uses: `GET /studies`, `/studies/by-slug/:slug`, `/studies/:id/panel-tree`, `/services`, `/services/:idOrSlug`, `/branches`, `/branches/:id`, `/posts`, `/banners/active/:placement`, `/reviews/approved`, `POST /quotations/pdf`, `POST /reviews`, `POST /contact-messages`. Removing `@Public()` from any of them breaks the site.
- The WS gateway (`/tickets`) lives outside `/api` and authenticates with `handshake.auth.token`.

## Migrations

- Every schema change ships with its migration (`yarn db:migrate --name <change>`); CI applies the migrations to an empty DB and fails if they differ from the schema. Don't use `db push` except on a disposable local DB.
- `start:prod` runs `prisma migrate deploy`. Renaming a column: edit the generated SQL (`ALTER ... RENAME`) instead of the DROP + ADD Prisma proposes. Backfill and column removal in separate deploys.
- **Switching production to migrations (one time, before the first deploy with `migrate deploy`):**
  1. Back up the production DB.
  2. With the prod `DATABASE_URL`: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` must show **only** the SQL of `20261020000000_auth_hardening` (if it shows more, prod isn't on `main`'s schema: resolve that first).
  3. Check there are no duplicate roles (`SELECT name FROM "Role" GROUP BY name HAVING count(*) > 1`); if there are, the unique index fails.
  4. `npx prisma migrate resolve --applied 0_init`.
  5. Deploy: `start:prod` applies `auth_hardening`. If step 4 is skipped, `migrate deploy` fails and the app doesn't start (it doesn't touch data).
- Local DB that came from `db push`: `npx prisma db push` and then `npx prisma migrate resolve --applied <each migration>`; or recreate it with `yarn db:deploy` + seed.

## Common mistakes / avoid

- `yarn lint` applies `--fix`: review the diff afterwards.
- Don't use npm (it generates `package-lock.json`).
- Don't forget `npx prisma generate` after editing the schema (`@prisma/client` types go stale).

## Definition of done

1. `yarn test` green (add/adjust specs for the touched service).
2. `yarn lint:check` with no errors and `yarn build` successful.
3. If the schema changed: migration created with `yarn db:migrate` and applied locally.
4. If a route or DTO changed: `yarn openapi:export`, commit `openapi.json`, and in each affected frontend `pnpm api:types` + review its interfaces (see `../CLAUDE.md` §6).

CI (`.github/workflows/ci.yml`, PRs to `dev`/`main`): lint:check, test, build, migrations vs schema, `openapi.json` up to date.
