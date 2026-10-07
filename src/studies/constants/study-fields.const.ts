export const STUDY_GENDERS = ['M', 'F', 'A'] as const;
export type StudyGender = (typeof STUDY_GENDERS)[number];

export const STUDY_AGE_FORMATS = ['DIAS', 'AÑOS'] as const;
export type StudyAgeFormat = (typeof STUDY_AGE_FORMATS)[number];

export const STUDY_MAX_DECIMALS = 6;

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
