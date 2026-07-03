import { supabase } from './supabase'

export interface HouseholdUser {
  id: string
  name: string
  isMe: boolean
}

/**
 * Both household profiles, me first. Powers the Me/partner switcher and the
 * "added by" chips. Until the partner has signed in once (their profiles row is
 * created on first sign-in), this returns just one entry and the switcher hides.
 */
export async function listProfiles(): Promise<HouseholdUser[]> {
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const { data, error } = await supabase.from('profiles').select('id, display_name')
  if (error) throw new Error(error.message)

  return (data ?? [])
    .map((p) => ({
      id: p.id as string,
      name: (p.display_name as string | null) ?? 'Partner',
      isMe: p.id === user.id
    }))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe))
}
