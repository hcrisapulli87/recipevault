import { supabase } from './supabase'
import { myId } from './users'
import { parseEnergyUnit } from '../../shared/energy'
import type { EnergyUnit } from '../../shared/energy'

/** My kJ/kcal display preference — on the profile so phone and desktop agree. */
export async function getEnergyUnit(): Promise<EnergyUnit> {
  const id = await myId()
  const { data, error } = await supabase
    .from('profiles')
    .select('energy_unit')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return parseEnergyUnit(data?.energy_unit)
}

export async function saveEnergyUnit(unit: EnergyUnit): Promise<void> {
  const id = await myId()
  const { error } = await supabase.from('profiles').upsert({ id, energy_unit: unit })
  if (error) throw new Error(error.message)
}
