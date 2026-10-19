import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { ENERGY_LABEL, energyValue, formatEnergy, toKcal } from '../../shared/energy'
import type { EnergyUnit } from '../../shared/energy'
import { getEnergyUnit, saveEnergyUnit } from '../data/energyUnit'

interface EnergyApi {
  unit: EnergyUnit
  /** "kcal" / "kJ" */
  label: string
  /** a stored kcal figure as display text: "2,150 kcal" / "8,996 kJ" */
  fmt: (kcal: number) => string
  /** a stored kcal figure as a bare display number */
  value: (kcal: number) => number
  /** a typed display-unit figure back to kcal for storage */
  toKcal: (value: number) => number
  setUnit: (unit: EnergyUnit) => void
}

function apiFor(unit: EnergyUnit, setUnit: (u: EnergyUnit) => void): EnergyApi {
  return {
    unit,
    label: ENERGY_LABEL[unit],
    fmt: (kcal) => formatEnergy(kcal, unit),
    value: (kcal) => energyValue(kcal, unit),
    toKcal: (v) => toKcal(v, unit),
    setUnit
  }
}

// Without a provider (isolated renders, tests) everything reads in kcal.
const EnergyContext = createContext<EnergyApi>(apiFor('kcal', () => undefined))

/** How every energy figure in the app is shown. Use this rather than writing "kcal". */
// eslint-disable-next-line react-refresh/only-export-components -- tiny hook that belongs with its provider
export function useEnergy(): EnergyApi {
  return useContext(EnergyContext)
}

/** Holds my kJ/kcal preference for the whole app; a change is shown at once and saved. */
export function EnergyUnitProvider(props: { children: ReactNode }): JSX.Element {
  const [unit, setUnitState] = useState<EnergyUnit>('kcal')

  useEffect(() => {
    getEnergyUnit().then(setUnitState, () => undefined) // offline / not migrated: stay kcal
  }, [])

  const setUnit = useCallback((next: EnergyUnit) => {
    setUnitState(next)
    void saveEnergyUnit(next).catch(() => undefined)
  }, [])

  const api = useMemo(() => apiFor(unit, setUnit), [unit, setUnit])
  return <EnergyContext.Provider value={api}>{props.children}</EnergyContext.Provider>
}
