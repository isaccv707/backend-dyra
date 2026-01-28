

export const toRequiredNumber = (v:any) => {
    if (v === null || v === undefined || v === "") return NaN;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

export const toOptionalInt = (v: any): number | undefined => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? Math.trunc(n) : v;
}

export const toOptionalBool = (v: any): boolean | undefined => {
    if (v === null || v === undefined || v === "") return undefined;
    const s = String(v).trim().toLowerCase();
    if (["true", "1", "si", "sí", "yes"].includes(s)) return true;
    if (["false", "0", "no"].includes(s)) return false;
    return v;
}