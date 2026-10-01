// Valores permitidos para los campos de texto "enumerados" de Study. En la DB
// son String (no enum de Prisma), así que la validación vive en los DTOs.

// M = masculino, F = femenino, A = ambos
export const STUDY_GENDERS = ['M', 'F', 'A'] as const;
export type StudyGender = (typeof STUDY_GENDERS)[number];

// Unidad en la que se expresan minAge/maxAge
export const STUDY_AGE_FORMATS = ['DIAS', 'AÑOS'] as const;
export type StudyAgeFormat = (typeof STUDY_AGE_FORMATS)[number];

export const STUDY_MAX_DECIMALS = 6;

// Normaliza variantes comunes capturadas a mano (minúsculas, acentos, "ANOS")
// al valor canónico de STUDY_AGE_FORMATS. Devuelve el valor original si no
// coincide para que la validación del DTO reporte el error.
export function normalizeAgeFormat(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const upper = value.trim().toUpperCase();
  if (['DIAS', 'DÍAS', 'DIA', 'DÍA', 'D'].includes(upper)) return 'DIAS';
  if (['AÑOS', 'ANOS', 'AÑO', 'ANO'].includes(upper)) return 'AÑOS';
  return value;
}

export function normalizeGender(value?: string): string | undefined {
  return value === undefined ? undefined : value.trim().toUpperCase();
}
