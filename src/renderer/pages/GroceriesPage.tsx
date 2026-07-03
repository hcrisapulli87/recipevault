import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { GroceryItem } from '../../shared/types'
import {
  listGroceries,
  addGroceries,
  toggleGrocery,
  deleteGrocery,
  clearChecked
} from '../data/groceries'
import { onTableChange } from '../data/realtime'

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

  const hasChecked = items.some((it) => it.checked)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-header__title">Groceries</h2>
        <button className="btn" onClick={clear} disabled={!hasChecked}>
          Clear checked
        </button>
      </div>

      <div className="search-row">
        <input
          className="text-input"
          placeholder="Add an item…"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn btn--primary" onClick={add} disabled={!newItem.trim()}>
          Add
        </button>
      </div>

      {items.length === 0 ? (
        <p className="empty-note">
          Your grocery list is empty. Add items above, or send a recipe&apos;s ingredients from its
          page.
        </p>
      ) : (
        <ul className="grocery-list grocery-page__list">
          {items.map((it) => (
            <li key={it.id} className="grocery-page__row">
              <label className="grocery-list__item">
                <input type="checkbox" checked={it.checked} onChange={() => toggle(it)} />
                <span className={it.checked ? 'grocery-page__done' : ''}>{it.name}</span>
              </label>
              <button className="icon-btn" title="Remove" onClick={() => remove(it.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
