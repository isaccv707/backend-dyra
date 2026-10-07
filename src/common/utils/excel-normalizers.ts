export type ExcelCellValue =
  string | number | boolean | Date | null | undefined;

export const toRequiredNumber = (v: ExcelCellValue): number => {
  if (v === null || v === undefined) return 0;

  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;

  const cleanString = String(v)
    .replace(/[^\d.-]/g, '')
    .trim();

  const n = parseFloat(cleanString);

  return Number.isFinite(n) ? n : 0;
};

export const toOptionalInt = (v: ExcelCellValue): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : (v as number | undefined);
};

export const toOptionalBool = (v: ExcelCellValue): boolean | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'si', 'sí', 'yes'].includes(s)) return true;
  if (['false', '0', 'no'].includes(s)) return false;
  return v as boolean | undefined;
};
