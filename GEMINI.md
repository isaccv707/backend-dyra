# Gemini CLI Project Configuration: backend-dyra

This document provides context and guidelines for Gemini CLI when working on the `backend-dyra` project.

## Project Overview
`backend-dyra` is a NestJS-based backend for a laboratory or healthcare service provider (DYRA). It manages services, laboratory studies, branches, banners, and a blog (posts/authors). It also includes a quotation system with PDF generation.

## Tech Stack
- **Framework:** NestJS
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Validation:** class-validator & class-transformer
- **PDF Generation:** pdfkit
- **Excel Processing:** xlsx
- **Development Tools:** ESLint, Prettier, Jest

## Project Structure
- `src/`: Application source code.
  - `authors/`: Author management for the blog.
  - `banners/`: Homepage banner management.
  - `branches/`: Physical branch locations.
  - `common/`: Shared utilities and error handlers.
  - `posts/`: Blog posts and content blocks.
  - `quotations/`: Quotation generation logic (includes PDF renderer).
  - `services/`: High-level categories of studies.
  - `states/`: Geographic states for branches.
  - `studies/`: Laboratory studies (price, preparation, etc.).
- `prisma/`: Prisma schema, migrations, and seeds.
- `test/`: E2E tests.

## Coding Standards & Patterns
- **Global Prefix:** All API routes are prefixed with `/api`.
- **Validation:** `ValidationPipe` is enabled globally with `whitelist: true` and `forbidNonWhitelisted: true`.
- **Slug Generation:** Slugs are used for SEO-friendly URLs in `posts`, `services`, and `studies`.
- **DB Error Handling:** Use `handle-db-errors.ts` for consistent database exception management.
- **DTOs:** Always use DTOs for request validation and transformation.
- **Prisma:** Use the `PrismaService` from `prisma/prisma/prisma.service.ts` (note the nested path).

## Common Commands
- `npm run start:dev`: Start the development server with watch mode.
- `npx prisma generate`: Regenerate the Prisma client.
- `npx prisma studio`: Open Prisma Studio to explore the database.
- `npm run lint`: Run ESLint and fix issues.
- `npm run test`: Run unit tests.
- `npm run test:e2e`: Run end-to-end tests.

## Development Guidelines
- When adding a new entity, update `prisma/schema.prisma`, run `npx prisma generate`, and create a corresponding module in `src/`.
- Ensure all new controllers follow the `/api` prefix and include proper validation via DTOs.
- For business logic involving laboratory studies or quotations, check `src/studies/` and `src/quotations/`.
- Maintain the existing pattern of separating entities, DTOs, and services within each module.
