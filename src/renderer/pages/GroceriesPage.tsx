import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Check, X } from 'lucide-react'
import type { GroceryItem } from '../../shared/types'
import {
  listGroceries,
  addGroceries,
  toggleGrocery,
  deleteGrocery,
  clearChecked,
  clearAll
} from '../data/groceries'
import { onTableChange } from '../data/realtime'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { PersonSwitcher } from '../components/PersonSwitcher'
import type { HouseholdUser } from '../data/users'

/** Your own shopping list: pill input + Add, glass island of check-circle rows. The
 *  partner's list is visible read-only behind the Me/partner switcher, the same way the
 *  tracker shows their day. */
export function GroceriesPage(props: {
  users: HouseholdUser[]
  current: HouseholdUser | null
  readOnly: boolean
  onSelectViewer: (user: HouseholdUser) => void
}): JSX.Element {
  const { users, current, readOnly } = props
  const [items, setItems] = useState<GroceryItem[]>([])
  const [newItem, setNewItem] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  const reload = useCallback(() => {
    if (!current) return
    listGroceries(current.id).then(setItems)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  useEffect(() => {
    reload()
    return onTableChange(['grocery_items'], reload)
  }, [reload])

  const add = async (): Promise<void> => {
    if (!newItem.trim()) return
    await addGroceries([newItem.trim()])
    setNewItem('')
    reload()
  }
  const toggle = async (item: GroceryItem): Promise<void> => {
    await toggleGrocery(item.id, !item.checked)
    reload()
  }
  const remove = async (id: string): Promise<void> => {
    await deleteGrocery(id)
    reload()
  }
  const clearTicked = async (): Promise<void> => {
    await clearChecked()
    reload()
  }
  const clearEverything = async (): Promise<void> => {
    await clearAll()
    reload()
  }

  const toGet = items.filter((it) => !it.checked).length
  const hasChecked = items.some((it) => it.checked)

  return (
    <div className="groceries">
      <div className="groceries__top">
        <span className="groceries__meta">
          {readOnly && current ? `${current.name}'s list` : 'Your list'} · {toGet} to get
        </span>
        <PersonSwitcher
          users={users}
          selectedId={current?.id ?? ''}
          onSelect={props.onSelectViewer}
        />
      </div>

      {readOnly && current && (
        <div className="partner-banner">{current.name}&rsquo;s list — read-only</div>
      )}

      {!readOnly && (
        <>
          <div className="groceries__add-row">
            <input
              className="input-pill"
              placeholder="Add an item"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <button className="btn-primary" onClick={add} disabled={!newItem.trim()}>
              Add
            </button>
          </div>

          {items.length > 0 && (
            <div className="groceries__actions">
              {hasChecked && (
                <button className="btn-ghost" onClick={clearTicked}>
                  Clear checked
                </button>
              )}
              <button
                className="btn-ghost btn-ghost--destructive"
                onClick={() => setConfirmClear(true)}
              >
                Clear all
              </button>
            </div>
          )}
        </>
      )}

      {items.length === 0 ? (
        <p className="library__empty">
          {readOnly
            ? 'Nothing on their list right now.'
            : 'Your list is empty. Add items above, or send a recipe’s ingredients from its page.'}
        </p>
      ) : (
        <div className="groceries__list glass-island">
          {items.map((it) => (
            <div key={it.id} className="grocery-row grocery-row--static">
              <button
                className={`grocery-row__circle ${it.checked ? 'grocery-row__circle--on' : ''}`}
                aria-label={it.checked ? 'Mark as to get' : 'Mark as got'}
                disabled={readOnly}
                onClick={() => toggle(it)}
              >
                {it.checked && <Check size={13} strokeWidth={3} />}
              </button>
              <span
                className={`grocery-row__label ${it.checked ? 'grocery-row__label--done' : ''}`}
              >
                {it.name}
              </span>
              {!readOnly && (
                <button
                  className="grocery-row__remove"
                  aria-label={`Remove ${it.name}`}
                  onClick={() => remove(it.id)}
                >
                  <X size={16} strokeWidth={2.4} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {confirmClear && (
        <ConfirmSheet
          title="Clear the whole list?"
          body={
            items.length === 1
              ? "The one item on your list is removed, ticked or not. Your partner's list is untouched."
              : `All ${items.length} items are removed, ticked or not. Your partner's list is untouched.`
          }
          confirmLabel="Clear all"
          onConfirm={clearEverything}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </div>
  )
}
