/**
 * Overprint normalization (CR-3, Citation fix v2 — 26 Aug 2026).
 *
 * Mitchell (and some Audatex) bold rows print every glyph twice, so text
 * extraction yields "$$77,,117744..8811" for "$7,174.81" and
 * "DDeellttaa RReeppoorrtt" for "Delta Report". No money or label regex
 * matches the doubled form: Test 100 read NEITHER totals block because the
 * shared reader choked on the Mitchell side, and the changelog partition
 * admitted 7 phantom rows because its marker check ran on the raw layer.
 *
 * Structure-keyed test, no vocabulary: a token whose even-index characters
 * equal its odd-index characters is an overprint pair — collapse it.
 *
 * CR-3a row guard: a UNIFORM token ("1111", "0000") satisfies the even/odd
 * test but is far more likely a real 4-digit value (qty, part code, year)
 * than an overprinted "11". A uniform token collapses ONLY when the same row
 * carries a non-uniform overprint token — the row itself proves it is bold.
 *
 * Applied per line BEFORE any money/label regex; plain text passes through
 * unchanged, so calling this on CCC documents is a no-op.
 */

/** "$411.60$411.60" — two money tokens fused without a separator. */
const ADJACENT_MONEY = /(\$[\d,]+\.\d{2}\*?)(?=\$)/g;
/** "3.1$100.00" — an hours value fused onto the money that follows it. */
const FUSED_MONEY = /(?<=\d)\$(?=[\d$])/g;

function isOverprint(token: string): boolean {
  if (token.length < 4 || token.length % 2 !== 0) return false;
  const half = token.length / 2;
  for (let index = 0; index < half; index += 1) {
    if (token[index * 2] !== token[index * 2 + 1]) return false;
  }
  return true;
}

function collapse(token: string): string {
  let out = "";
  for (let index = 0; index < token.length; index += 2) out += token[index];
  return out;
}

function isUniform(token: string): boolean {
  for (let index = 1; index < token.length; index += 1) {
    if (token[index] !== token[0]) return false;
  }
  return true;
}

export function normalizeOverprintLine(line: string): string {
  const tokens = line.split(/(\s+)/);
  const rowIsBold = tokens.some(
    (token) => !/^\s*$/.test(token) && isOverprint(token) && !isUniform(token)
  );
  const collapsed = tokens
    .map((token) => {
      if (/^\s*$/.test(token)) return token;
      if (isOverprint(token) && (!isUniform(token) || rowIsBold)) return collapse(token);
      return token;
    })
    .join("");
  return collapsed.replace(ADJACENT_MONEY, "$1 ").replace(FUSED_MONEY, " $");
}

export function normalizeOverprintText(text: string): string {
  if (!text) return text;
  return text
    .split("\n")
    .map((line) => normalizeOverprintLine(line))
    .join("\n");
}
