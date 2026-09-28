import { describe, it, expect } from 'vitest'
import { isValidGtin, expandUpcE, barcodeCandidates } from '../src/shared/barcode'

describe('isValidGtin', () => {
  it('accepts real EAN-13, UPC-A and EAN-8 codes', () => {
    expect(isValidGtin('5449000000996')).toBe(true) // EAN-13
    expect(isValidGtin('036000291452')).toBe(true) // UPC-A
    expect(isValidGtin('96385074')).toBe(true) // EAN-8
    expect(isValidGtin('00036000291452')).toBe(true) // GTIN-14
  })

  it('rejects a single mistyped or swapped digit', () => {
    expect(isValidGtin('5449000000995')).toBe(false)
    expect(isValidGtin('036000219452')).toBe(false)
  })

  it('rejects lengths that are not GTINs', () => {
    expect(isValidGtin('1234567')).toBe(false)
    expect(isValidGtin('12345678901')).toBe(false)
    expect(isValidGtin('abc')).toBe(false)
  })
})

describe('expandUpcE', () => {
  it('expands each UPC-E compression pattern to its UPC-A', () => {
    expect(expandUpcE('04252614')).toBe('042100005264') // last digit 0–2
    expect(expandUpcE('01234531')).toBe('012300000451') // last digit 3
    expect(expandUpcE('01234532')).toBeNull() // bad check digit
    expect(expandUpcE('06543273')).toBe('065432000073') // last digit 5–9
  })

  it('refuses codes outside number systems 0 and 1', () => {
    expect(expandUpcE('96385074')).toBeNull()
  })
})

describe('barcodeCandidates', () => {
  it('pairs a UPC-A with its EAN-13 spelling, literal first', () => {
    expect(barcodeCandidates('036000291452')).toEqual(['036000291452', '0036000291452'])
  })

  it('pairs a leading-zero EAN-13 with its UPC-A spelling', () => {
    expect(barcodeCandidates('0036000291452')).toEqual(['0036000291452', '036000291452'])
  })

  it('adds the expanded forms of a UPC-E', () => {
    expect(barcodeCandidates('04252614')).toEqual(['04252614', '042100005264', '0042100005264'])
  })

  it('leaves an ordinary EAN-13 alone and strips non-digits', () => {
    expect(barcodeCandidates(' 5449000000996 ')).toEqual(['5449000000996'])
    expect(barcodeCandidates('')).toEqual([])
  })

  it('unwraps a zero-padded GTIN-14', () => {
    expect(barcodeCandidates('00036000291452')).toEqual([
      '00036000291452',
      '0036000291452',
      '036000291452'
    ])
  })
})
