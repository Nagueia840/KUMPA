/**
 * Parser de números de mercado para el guard anti-alucinación (FASE C).
 * Tolera formatos argentinos e internacionales:
 *   78.429 / 78,429 / 78.429,7 / 78,429.7 / 78.4k / 1.2M / 0,0004% / -0,0004% / −38.6
 * No asume que "1.971" sea decimal: valida grupos de miles (1.971 → 1971).
 */
export function parseMarketNumber(token: string): number | null {
  let s = token.trim();
  if (!s) return null;
  s = s.replace(/[~≈]/g, '').replace(/[$€]/g, '').replace(/[−–]/g, '-').replace(/\s+/g, '');
  s = s.replace(/\b(USD|USDT|d[oó]lares?|dolares?|ARS)\b/gi, '').trim();
  if (!/^[+-]?[\d.,]+[kKmMbB%]?$/.test(s)) return null;

  let mult = 1;
  const last = s[s.length - 1];
  // Porcentaje: el separador se interpreta como decimal (ej "‑1,095%" = -1.095, no 1095).
  const percentMode = /%$/.test(s.trim());
  if (last === 'k' || last === 'K') {
    mult = 1e3;
    s = s.slice(0, -1);
  } else if (last === 'm' || last === 'M') {
    mult = 1e6;
    s = s.slice(0, -1);
  } else if (last === 'b' || last === 'B') {
    mult = 1e9;
    s = s.slice(0, -1);
  } else if (last === '%') {
    s = s.slice(0, -1);
  }
  if (!/^[+-]?\d[\d.,]*$/.test(s)) return null;

  const neg = s.startsWith('-');
  const body = s.replace(/^[+-]/, '');
  if (!/^\d[\d.,]*$/.test(body) || !/\d$/.test(body)) return null;

  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;
  let mantissa: string;

  if (dots > 0 && commas > 0) {
    // Ambos separadores: el último es decimal, el otro es de miles.
    const decSep = body.lastIndexOf(',') > body.lastIndexOf('.') ? ',' : '.';
    const thouSep = decSep === ',' ? '.' : ',';
    mantissa = body.split(thouSep).join('').replace(decSep, '.');
  } else if (dots === 1 || commas === 1) {
    const sep = dots === 1 ? '.' : ',';
    const idx = body.indexOf(sep);
    const intPart = body.slice(0, idx);
    const decPart = body.slice(idx + 1);
    if (decPart.length === 3 && intPart !== '0' && intPart.length > 0 && !percentMode) {
      mantissa = intPart + decPart; // separador de miles (78.429 → 78429)
    } else {
      mantissa = `${intPart}.${decPart}`; // decimal (79,3 → 79.3; 0,0007 → 0.0007)
    }
  } else {
    mantissa = body;
  }

  const n = Number(mantissa) * mult;
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
