import { useEffect, useState } from 'react'
import { listProfiles } from '../data/users'
import type { HouseholdUser } from '../data/users'
import { onTableChange } from '../data/realtime'

/**
 * Both household profiles, me first (see listProfiles). Refreshes on profile
 * changes so the partner appears in switchers as soon as they first sign in.
 */
export function useHousehold(): HouseholdUser[] {
  const [users, setUsers] = useState<HouseholdUser[]>([])

  useEffect(() => {
    const load = (): void => {
      listProfiles().then(setUsers)
    }
    load()
    return onTableChange(['profiles'], load)
  }, [])

  return users
}
