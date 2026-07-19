import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Check } from 'lucide-react'
import type { GroceryItem } from '../../shared/types'
import {
  listGroceries,
  addGroceries,
  toggleGrocery,
  deleteGrocery,
  clearChecked
} from '../data/groceries'
import { onTableChange } from '../data/realtime'

/** Shared household checklist: pill input + Add, glass island of check-circle rows. */
export function GroceriesPage(): JSX.Element {
  const [items, setItems] = useState<GroceryItem[]>([])
  const [newItem, setNewItem] = useState('')

  const reload = useCallback(() => {
    listGroceries().then(setItems)
  }, [])

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
  const clear = async (): Promise<void> => {
    await clearChecked()
    reload()
  }

  const toGet = items.filter((it) => !it.checked).length
  const hasChecked = items.some((it) => it.checked)

  return (
    <div className="groceries">
      <div className="groceries__meta-row">
        <span className="groceries__meta">Shared list · {toGet} to get</span>
        {hasChecked && (
          <button className="btn-ghost" onClick={clear}>
            Clear checked
          </button>
        )}
      </div>

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

      {items.length === 0 ? (
        <p className="library__empty">
          The shared list is empty. Add items above, or send a recipe&apos;s ingredients from its
          page.
        </p>
      ) : (
        <div className="groceries__list glass-island">
          {items.map((it) => (
            <div key={it.id} className="grocery-row grocery-row--static">
              <button
                className={`grocery-row__circle ${it.checked ? 'grocery-row__circle--on' : ''}`}
                aria-label={it.checked ? 'Mark as to get' : 'Mark as got'}
                onClick={() => toggle(it)}
              >
                {it.checked && <Check size={13} strokeWidth={3} />}
              </button>
              <span
                className={`grocery-row__label ${it.checked ? 'grocery-row__label--done' : ''}`}
              >
                {it.name}
              </span>
              <button className="grocery-row__remove" onClick={() => remove(it.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
