// Retail barcode (GTIN) helpers — pure, so they can be unit-tested without a camera.
//
// The same product can be printed and read in several equivalent forms, and
// OpenFoodFacts stores each product under ONE of them:
//   · UPC-A (12 digits) is EAN-13 with an implied leading 0 — "012345678905" and
//     "0012345678905" are the same product.
//   · UPC-E (8 digits) is a zero-suppressed UPC-A printed on small packs; scanners hand
//     back the short form, OFF files the expanded one.
//   · GTIN-14 (outer cartons) pads EAN-13 with a leading packaging digit.
// Looking up only the literal scanned digits therefore turned real, known products into
// "No product found". barcodeCandidates() lists every equivalent form to try.

/** GTIN check digit for the payload (all digits except the check digit). */
function checkDigitFor(payload: string): number {
  let sum = 0
  // Weights run 3,1,3,1… starting from the rightmost payload digit.
  for (let i = 0; i < payload.length; i++) {
    const digit = payload.charCodeAt(payload.length - 1 - i) - 48
    sum += digit * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10
}

/** True when `code` is an 8/12/13/14-digit GTIN whose check digit adds up. Catches the
 *  typical typo (one wrong or swapped digit) in a hand-typed barcode. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false
  return checkDigitFor(code.slice(0, -1)) === Number(code[code.length - 1])
}

/** Expand an 8-digit UPC-E to its 12-digit UPC-A, or null if it isn't a valid UPC-E. */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null
  const ns = code[0]
  const d = code.slice(1, 7)
  const check = code[7]
  const last = d[5]
  let body: string
  if (last <= '2') body = `${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`
  else if (last === '3') body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`
  else if (last === '4') body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`
  else body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${last}`
  const upcA = `${ns}${body}${check}`
  return isValidGtin(upcA) ? upcA : null
}

/**
 * Every equivalent spelling of a scanned/typed barcode, most literal first. Non-digits
 * are stripped. The scanned form always comes first so a code OFF knows verbatim costs
 * exactly one lookup.
 */
export function barcodeCandidates(raw: string): string[] {
  const code = raw.replace(/\D/g, '')
  if (!code) return []
  const out = [code]
  if (code.length === 12) out.push(`0${code}`)
  if (code.length === 13 && code.startsWith('0')) out.push(code.slice(1))
  if (code.length === 14 && code.startsWith('0')) {
    out.push(code.slice(1))
    if (code.startsWith('00')) out.push(code.slice(2))
  }
  if (code.length === 8) {
    const upcA = expandUpcE(code)
    if (upcA) out.push(upcA, `0${upcA}`)
  }
  return [...new Set(out)]
}
