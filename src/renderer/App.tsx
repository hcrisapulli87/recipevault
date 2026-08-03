import { useCallback, useState } from 'react'
import type { JSX } from 'react'
import { ChevronLeft } from 'lucide-react'
import { GlassDock } from './components/GlassDock'
import { ToastProvider } from './components/Toast'
import { AddFoodModal } from './components/AddFoodModal'
import { LibraryPage } from './pages/LibraryPage'
import { ImportPage } from './pages/ImportPage'
import { RecipeDetailPage } from './pages/RecipeDetailPage'
import { MealPlanPage } from './pages/MealPlanPage'
import { SettingsPage } from './pages/SettingsPage'
import { MacroTrackerPage } from './pages/MacroTrackerPage'
import { TrendsPage } from './pages/TrendsPage'
import { GroceriesPage } from './pages/GroceriesPage'
import { useRecipes } from './hooks/useRecipes'
import { useHousehold } from './hooks/useHousehold'
import { useImportQueueWorker } from './hooks/useImportQueueWorker'
import type { HouseholdUser } from './data/users'
import type { FoodItem, MealType } from '../shared/types'

export type Page = 'tracker' | 'trends' | 'library' | 'plan' | 'groceries' | 'import' | 'settings'

const TOP_TABS: readonly Page[] = ['tracker', 'trends', 'library']

/** Time-of-day default for the FAB: <10h breakfast, <15h lunch, <20h dinner, else snack. */
function defaultMeal(): MealType {
  const h = new Date().getHours()
  return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 20 ? 'dinner' : 'snack'
}

/** Local (not UTC) YYYY-MM-DD — food always logs to the user's own today. */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

function AppInner(): JSX.Element {
  useImportQueueWorker() // desktop: serve phone-queued Instagram fetches (no-op on web)
  const [page, setPage] = useState<Page>('tracker')
  const [lastTab, setLastTab] = useState<Page>('tracker')
  const [selectedRecipeId, setSelectedRecipeId] = useState<number | null>(null)
  const recipes = useRecipes()

  // Household viewer (H/K) lives here so the Tracker and Trends share it and the
  // FAB can hide itself in the partner's read-only view.
  const users = useHousehold()
  const [viewer, setViewer] = useState<HouseholdUser | null>(null)
  const current = viewer ?? users[0] ?? null
  const readOnly = current !== null && !current.isMe

  // Add Food is app-wide (FAB anywhere, quick-add from a meal card).
  const [addFood, setAddFood] = useState<{ meal: MealType; planned: FoodItem | null } | null>(null)
  const openAddFood = useCallback((meal?: MealType, planned?: FoodItem | null) => {
    setAddFood({ meal: meal ?? defaultMeal(), planned: planned ?? null })
  }, [])

  const openRecipe = useCallback((id: number) => {
    setSelectedRecipeId(id)
    setPage('library')
  }, [])

  const closeRecipe = useCallback(() => setSelectedRecipeId(null), [])

  const navigate = (p: Page): void => {
    setSelectedRecipeId(null)
    if (TOP_TABS.includes(p)) setLastTab(p)
    setPage(p)
  }

  const isSubPage = !TOP_TABS.includes(page)
  const subPageTitle: Partial<Record<Page, string>> = {
    plan: 'Meal plan',
    groceries: 'Groceries',
    import: 'Import recipe',
    settings: 'Settings'
  }

  return (
    <div className="app">
      <div className="app__body">
        <main className="app__main">
          {isSubPage && (
            <div className="subpage-head">
              <button
                className="round-btn glass-pill"
                aria-label="Back"
                onClick={() => navigate(lastTab)}
              >
                <ChevronLeft size={20} />
              </button>
              <span className="subpage-head__title">{subPageTitle[page]}</span>
            </div>
          )}
          {page === 'library' && selectedRecipeId !== null ? (
            <RecipeDetailPage
              recipeId={selectedRecipeId}
              onBack={closeRecipe}
              onDeleted={() => {
                closeRecipe()
                recipes.reload()
              }}
              onCopied={(newId) => {
                recipes.reload()
                openRecipe(newId)
              }}
            />
          ) : page === 'library' ? (
            <LibraryPage
              recipes={recipes.recipes}
              onOpen={openRecipe}
              onImport={() => navigate('import')}
            />
          ) : page === 'import' ? (
            <ImportPage
              onSaved={(id) => {
                recipes.reload()
                openRecipe(id)
              }}
            />
          ) : page === 'plan' ? (
            <MealPlanPage recipes={recipes.recipes} onOpenRecipe={openRecipe} />
          ) : page === 'tracker' ? (
            <MacroTrackerPage
              recipes={recipes.recipes}
              users={users}
              current={current}
              readOnly={readOnly}
              onSelectViewer={setViewer}
              onAddFood={openAddFood}
            />
          ) : page === 'trends' ? (
            <TrendsPage current={current} />
          ) : page === 'groceries' ? (
            <GroceriesPage />
          ) : (
            <SettingsPage />
          )}
        </main>
      </div>

      <GlassDock
        page={page}
        showFab={!readOnly}
        onNavigate={navigate}
        onAddFood={() => openAddFood()}
      />

      {addFood && (
        <AddFoodModal
          mealType={addFood.meal}
          date={localToday()}
          planned={addFood.planned}
          onClose={() => setAddFood(null)}
          onLogged={() => {}}
        />
      )}
    </div>
  )
}

export default function App(): JSX.Element {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  )
}
