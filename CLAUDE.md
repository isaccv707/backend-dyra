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

**Modules:** `authors`, `banners`, `branches`, `posts`, `price-sheets`, `quotations`, `reviews`, `services`, `states`, `studies`

**Database:** PostgreSQL via Prisma. The `PrismaService` lives at `prisma/prisma/prisma.service.ts` (note the double-nested path) and uses the `@prisma/adapter-pg` native adapter. `PrismaModule` is global, so `PrismaService` is available throughout without re-importing.

**Global setup in `main.ts`:**

- `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`
- `PrismaClientExceptionFilter` maps Prisma errors to HTTP codes (P2002 → 409, P2025 → 404, P2003 → 400)
- CORS origins from `CORS_ORIGINS` env var

## Key Patterns

**Adding a new entity:**

1. Add model to `prisma/schema.prisma`
2. Run `npx prisma generate` (and `npx prisma db push` for local dev)
3. Create a NestJS module under `src/<entity>/` with `controller`, `service`, and `dto/` subdirectory
4. Import the module in `src/app.module.ts`

**Error handling:** Use `handleDatabaseErrors()` from `src/common/handle-db-errors.ts` inside service catch blocks. The global `PrismaClientExceptionFilter` handles most Prisma exceptions automatically.

**Slugs:** Use `generateSlug()` from `src/common/utils/slugger.ts` when creating/updating `posts`, `services`, or `studies`.

**Branch scoping:** There is no "global" content concept in this app — every branch-owned resource belongs to exactly one branch via a required single `branchId` FK (never a `Branch[]` many-to-many). This applies to `Service`, `Author`, `Post`, `Banner`, `PriceSheets`, and `Study`. `Create*Dto`/`Update*Dto` take a single `branchId`, not `branchIds`. List endpoints accept an optional `branchId` query param and filter with a plain `where.branchId` match.
- `Post.authorId`, when set, must reference an `Author` in the same `branchId` — enforced in `posts.service.ts`, not at the DB level.
- `Study.branchId` must match the `branchId` of its `Study.service` (`assertServiceBelongsToBranch` in `studies.service.ts`), and `StudyOnPriceSheet` can only link a study to a `PriceSheets` row from that same branch — a study is never priced by another branch's tarifario. Both are enforced in the service layer, not at the DB level.
- `Banner.order` is a per-`(branchId, placement)` queue — reordering logic in `banners.service.ts` scopes its shifts by both fields, not just `placement`.
- `Service`, `Author`, `Post`, and `Study` uniqueness (`name`/`nameKey`, `slug`, `code`) is scoped per branch via composite `@@unique([branchId, ...])`, not global — the same name/slug/code can exist in two different branches; they're unrelated records (e.g. "Análisis Clínicos" can be a separate `Service` row in two branches).
- `Resguardo.branchId` must match the `branchId` of its `Resguardo.employee` (derived from the employee, never taken from the request body) — enforced in `resguardos.service.ts`, not at the DB level.

Intentional exceptions to the "single required `branchId`" rule:
- `Review`: strict `where.branchId` match, no "global" concept, but `branchId` is nullable (a review not tied to any branch is allowed).
- `User`: assigned to branches via a genuine `Branch[]` many-to-many (staff can work across branches) — see `src/common/utils/branch-access.util.ts` for scoping admin queries/writes to a user's assigned branches (used by `reviews`, `price-sheets`, `quotations`).

**DTOs:** Use `class-validator` decorators. Always use `@Type(() => ...)` from `class-transformer` for nested objects and numeric coercion (query params arrive as strings).

**Pagination:** All list endpoints follow the same shape: `{ data: T[], total: number, page: number, limit: number, totalPages: number }`.

**Excel import (Studies):** The `POST /api/studies/import` endpoint accepts `.xlsx`/`.xls` files via `FileInterceptor`. Batch processing uses 100-item chunks with a 60-second Prisma timeout; the response includes per-row success/error details.

**PDF generation (Quotations, Resguardos):** Uses `pdfkit` with server-side rendering. Company logo is embedded from `dist/assets/`. `resguardos` generates an equipment-custody document (`ADM.F.00`) for an employee with up to three optional, combinable sections (computer/mobile/vehicle); a vehicle section adds a second page with a fixed inspection checklist (`src/resguardos/constants/vehicle-inspection-items.const.ts`).

## Environment Variables

```
DATABASE_URL="postgresql://user:pass@localhost:5432/dyra_db?schema=public"
DB_USER=
DB_PASSWORD=
DB_NAME=
CORS_ORIGINS="http://localhost:4321"
PORT=3000
```

A local PostgreSQL instance (or the `docker-compose.yaml` container) is required for development.
