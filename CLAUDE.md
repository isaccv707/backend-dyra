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
npm run seed            # Run seed script (ts-node prisma/seed.ts)
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

**Branch scoping:** Use `branchScopeWhere(branchId)` from `src/common/utils/branch-scope.util.ts` for resources optionally scoped to a branch via a `Branch[]` many-to-many relation (currently: `Banner`, `Post`). A resource with no branches assigned is "global" (always shows); one with branches assigned only shows when `branchId` matches. Spread it unconditionally into the Prisma `where` — it no-ops (`{}`) when `branchId` is undefined.

Intentional exceptions — do not "unify" these into `branchScopeWhere`:
- `Review`: strict `where.branchId` match, no "global" concept. A branch's review must never appear as belonging to all branches.
- `Service`: strict `where.branchId` match via a required single `branchId` FK (not a `Branch[]` m2m). Every service belongs to exactly one branch — there is no "global" service. `CreateServiceDto`/`UpdateServiceDto` take a single `branchId`, not `branchIds`.
- `Study`/pricing: resolved via `PriceSheets.branchId -> StudyOnPriceSheet`, independent of `Service.branchId`. Variable pricing per branch, not visibility.

**DTOs:** Use `class-validator` decorators. Always use `@Type(() => ...)` from `class-transformer` for nested objects and numeric coercion (query params arrive as strings).

**Pagination:** All list endpoints follow the same shape: `{ data: T[], total: number, page: number, limit: number, totalPages: number }`.

**Excel import (Studies):** The `POST /api/studies/import` endpoint accepts `.xlsx`/`.xls` files via `FileInterceptor`. Batch processing uses 100-item chunks with a 60-second Prisma timeout; the response includes per-row success/error details.

**PDF generation (Quotations):** Uses `pdfkit` with server-side rendering. Company logo is embedded from `dist/assets/`.

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
