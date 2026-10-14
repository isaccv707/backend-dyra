/**
 * `Study.title` is nullable only for legacy rows pending
 * `prisma/scripts/backfill-study-titles.ts`; those fall back to `name`.
 */
export const studyTitle = (study: { name: string; title: string | null }) =>
  study.title ?? study.name;
