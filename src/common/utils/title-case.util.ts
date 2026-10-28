const LOCALE = 'es-MX';

/**
 * "hemoglobina GLICOSILADA" -> "Hemoglobina Glicosilada": trims, collapses
 * spaces and capitalizes the first letter of every word (also right after
 * "(", "[", "/" or "-"), lowercasing the rest. Accents are kept.
 */
export const toTitleCase = (text: string): string =>
  text
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase(LOCALE)
    .replace(
      /(^|[\s([/-])(\p{L})/gu,
      (_match, separator: string, letter: string) =>
        separator + letter.toLocaleUpperCase(LOCALE),
    );

/** For `@Transform(titleCaseTransform)` on DTO string fields. */
export const titleCaseTransform = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? toTitleCase(value) : value;
