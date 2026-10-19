import { describe, it, expect } from 'vitest'
import { energyValue, formatEnergy, parseEnergyUnit, toKcal } from '../src/shared/energy'

describe('energy units', () => {
  it('shows kcal as stored and kJ converted at 4.184', () => {
    expect(formatEnergy(2150, 'kcal')).toBe('2,150 kcal')
    expect(formatEnergy(2150, 'kj')).toBe('8,996 kJ')
    expect(energyValue(100, 'kj')).toBe(418)
  })

  it('round-trips a typed kJ figure back to kcal', () => {
    expect(toKcal(8996, 'kj')).toBeCloseTo(2150, 0)
    expect(toKcal(500, 'kcal')).toBe(500)
  })

  it('defaults anything unrecognised to kcal', () => {
    expect(parseEnergyUnit('kj')).toBe('kj')
    expect(parseEnergyUnit(null)).toBe('kcal')
    expect(parseEnergyUnit('calories')).toBe('kcal')
  })
})
