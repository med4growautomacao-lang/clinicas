/**
 * Normaliza string para busca: minúsculo, sem acentos, espaços comprimidos.
 * Ex: "Ana Lúcia" → "ana lucia"
 */
export function normalizeText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Mantém apenas dígitos. Útil pra normalizar phone, CPF, CNPJ.
 * Ex: "(11) 99999-9999" → "11999999999"
 */
export function digitsOnly(s: string | null | undefined): string {
  if (!s) return "";
  return s.toString().replace(/\D/g, "");
}

/**
 * Verifica se a query bate com qualquer um dos campos fornecidos.
 * - Quebra a query em termos por espaço; TODOS os termos precisam aparecer em pelo menos UM dos campos
 * - Campos texto: comparação normalizada (sem acentos, case-insensitive)
 * - Campos numéricos (phone/CPF/CNPJ): comparação só de dígitos
 *
 * Exemplo:
 *   matchesSearch("11 9999", { phone: "(11) 99999-9999", name: "Maria" }, ["phone"], ["name"])
 *   → true (porque "119999" está em "11999999999")
 */
export function matchesSearch(
  query: string,
  fields: Record<string, string | null | undefined>,
  numericKeys: string[] = [],
  textKeys?: string[]
): boolean {
  const q = (query || "").trim();
  if (!q) return true;

  // Quebra a query em termos. Cada termo precisa bater com algum campo.
  const terms = q.split(/\s+/).filter(Boolean);

  // Pré-normaliza todos os campos textuais e numéricos para evitar reprocessar por termo
  const allKeys = textKeys || Object.keys(fields).filter(k => !numericKeys.includes(k));
  const normalizedText: Record<string, string> = {};
  allKeys.forEach(k => { normalizedText[k] = normalizeText(fields[k]); });

  const normalizedNumeric: Record<string, string> = {};
  numericKeys.forEach(k => { normalizedNumeric[k] = digitsOnly(fields[k]); });

  // Para cada termo da query:
  //   1. Normaliza o termo (texto): bate contra qualquer textKey
  //   2. Se o termo tiver dígitos, também bate contra qualquer numericKey (só dígitos do termo)
  return terms.every(term => {
    const termText = normalizeText(term);
    const termDigits = digitsOnly(term);

    const matchText = termText.length > 0 && allKeys.some(k =>
      normalizedText[k] && normalizedText[k].includes(termText)
    );

    const matchNumeric = termDigits.length > 0 && numericKeys.some(k =>
      normalizedNumeric[k] && normalizedNumeric[k].includes(termDigits)
    );

    return matchText || matchNumeric;
  });
}
