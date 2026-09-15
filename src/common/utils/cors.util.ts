// CORS_ORIGINS vacío o ausente antes producía [''] (un origin vacío) en vez
// de "sin orígenes permitidos" — con Socket.IO en particular eso puede
// bloquear todas las conexiones o comportarse de forma inconsistente según
// el motor de CORS. Filtrar cadenas vacías después del trim deja un arreglo
// vacío explícito en ese caso.
export function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
