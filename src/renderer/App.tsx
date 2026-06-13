import { useState, useCallback } from 'react'
import type { JSX } from 'react'
import { Sidebar } from './components/Sidebar'
import { LibraryPage } from './pages/LibraryPage'
import { ImportPage } from './pages/ImportPage'
import { RecipeDetailPage } from './pages/RecipeDetailPage'
import { MealPlanPage } from './pages/MealPlanPage'
import { SettingsPage } from './pages/SettingsPage'
import { useRecipes } from './hooks/useRecipes'

export type Page = 'library' | 'plan' | 'import' | 'settings'

export default function App(): JSX.Element {
  const [page, setPage] = useState<Page>('library')
  const [selectedRecipeId, setSelectedRecipeId] = useState<number | null>(null)
  const recipes = useRecipes()

  const openRecipe = useCallback((id: number) => {
    setSelectedRecipeId(id)
    setPage('library')
  }, [])

  const closeRecipe = useCallback(() => setSelectedRecipeId(null), [])

  const navigate = (p: Page): void => {
    setSelectedRecipeId(null)
    setPage(p)
  }

  return (
    <div className="app">
      <div className="app__body">
        <Sidebar page={page} selectedRecipe={selectedRecipeId !== null} onNavigate={navigate} />
        <main className="app__main">
          {page === 'library' && selectedRecipeId !== null ? (
            <RecipeDetailPage
              recipeId={selectedRecipeId}
              onBack={closeRecipe}
              onDeleted={() => {
                closeRecipe()
                recipes.reload()
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
          ) : (
            <SettingsPage />
          )}
        </main>
      </div>
    </div>
  )
}
