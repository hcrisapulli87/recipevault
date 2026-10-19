// Energy display: kilocalories or kilojoules. Australian labels lead with kJ, so the
// tracker can speak either. Everything is STORED in kcal (food_log, goals, estimates);
// the unit is a display preference converted at the edge, in exactly one place.

export type EnergyUnit = 'kcal' | 'kj'

/** Thermochemical kilojoules per kilocalorie — the factor FSANZ labelling uses. */
export const KJ_PER_KCAL = 4.184

export const ENERGY_LABEL: Record<EnergyUnit, string> = { kcal: 'kcal', kj: 'kJ' }

/** A stored kcal figure in the display unit, rounded to a whole number. */
export function energyValue(kcal: number, unit: EnergyUnit): number {
  return Math.round(unit === 'kj' ? kcal * KJ_PER_KCAL : kcal)
}

/** "2,150 kcal" / "8,996 kJ". */
export function formatEnergy(kcal: number, unit: EnergyUnit): string {
  return `${energyValue(kcal, unit).toLocaleString('en-AU')} ${ENERGY_LABEL[unit]}`
}

/** A figure typed in the display unit, back to kcal for storage. */
export function toKcal(value: number, unit: EnergyUnit): number {
  return unit === 'kj' ? value / KJ_PER_KCAL : value
}

export function parseEnergyUnit(raw: unknown): EnergyUnit {
  return raw === 'kj' ? 'kj' : 'kcal'
}
