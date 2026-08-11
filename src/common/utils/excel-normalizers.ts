export const toRequiredNumber = (v: any): number => {
  // 1. Si es null o undefined, directo a 0
  if (v === null || v === undefined) return 0;

  // 2. Si ya es un número puro de JavaScript, lo retornamos directo
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;

  // 3. Si es un string, removemos TODO lo que no sea un número, un punto o un signo menos
  // Esto elimina comas (,), signos de pesos ($), espacios normales y espacios invisibles ( )
  const cleanString = String(v)
    .replace(/[^\d.-]/g, '') // 🔥 Conserva solo dígitos, puntos y guiones. Adiós comas y espacios.
    .trim();

  const n = parseFloat(cleanString);

  // 4. Retornamos el número final si es válido
  return Number.isFinite(n) ? n : 0;
};

export const toOptionalInt = (v: any): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : v;
};

export const toOptionalBool = (v: any): boolean | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'si', 'sí', 'yes'].includes(s)) return true;
  if (['false', '0', 'no'].includes(s)) return false;
  return v;
};
