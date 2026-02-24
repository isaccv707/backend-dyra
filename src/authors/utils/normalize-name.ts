


export const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ');
export const normalizeKey = (name: string) =>
  normalizeName(name).toLowerCase();