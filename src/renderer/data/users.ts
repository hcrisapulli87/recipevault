import { supabase } from './supabase'

export interface HouseholdUser {
  id: string
  name: string
  isMe: boolean
}

/**
 * The signed-in user's id. Owner-scoped tables need it on every write (the column
 * default only covers inserts, not the conflict target of an upsert), so it lives here
 * once rather than as a repeated `supabase.auth.getUser()` in each data module.
 */
export async function myId(): Promise<string> {
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  return user.id
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

  // is_bot excludes service accounts (the Discord bot) — only real household
  // members belong in the Me/partner switchers and "added by" chips.
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('is_bot', false)
  if (error) throw new Error(error.message)

  return (data ?? [])
    .map((p) => ({
      id: p.id as string,
      name: (p.display_name as string | null) ?? 'Partner',
      isMe: p.id === user.id
    }))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe))
}
