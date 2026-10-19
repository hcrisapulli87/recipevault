# RecipeVault: competitive analysis and where to improve

Written 2026-10-19. Compares RecipeVault with the apps people actually pick for this job,
and says where we win, where we lose, and what to build next. Competitor details come from
2026 review roundups, App Store listings and vendor pages (sources at the end). A lot of
those roundups are written by competing apps, so treat feature claims as "probably true"
and prices as approximate.

---

## 1. The short version

**RecipeVault's real advantage is the joined-up loop**: import a recipe → plan the week with
leftovers → one merged grocery list → log it to a macro tracker that knows Australian food.
Nobody in the market does all four well. Recipe managers (Paprika, Mela, Crouton, Pestle,
ReciMe) don't do serious macro tracking. Macro trackers (MacroFactor, MyFitnessPal) are weak
at recipes and planning. Planners (Mealime, Samsung Food, Ollie) don't do leftovers properly
or AU nutrition data.

**Why it still doesn't *feel* much better:** you spend most of your time in the basic
screens (library, recipe page, cook mode, grocery list), and those are where we're behind.
Competitors have years of polish there. Our advantage only shows up when you use the whole
loop, and the basics are rough enough to hide it.

**So the plan is:** (1) catch up on the basics people touch every day, (2) make the joined-up
loop obvious and quick, and (3) only after that, add the AI-era features (photo or video
import, AI-assisted planning).

---

## 2. Who we're up against

| App | What it is | Platforms | Price (approx.) |
|---|---|---|---|
| **Paprika 3** | Long-standing, full-featured recipe manager | iOS, Android, Mac, Windows (each bought separately) | ~US$5 mobile, ~US$30 desktop, one-off |
| **Mela** | Clean Apple-only recipe manager, privacy-first | iOS / Mac | One-off |
| **Crouton** | Polished Apple recipe manager, strong cook mode | iOS / Mac / Watch | Free tier + Plus |
| **Pestle** | Recipe manager built around social-video import and cooking | iOS | ~US$25/yr or ~US$40 lifetime; free tier capped at 15 recipes |
| **ReciMe** | Social-first organiser (TikTok/IG/YouTube/Pinterest/photo) | iOS, web, Chrome ext. (Android rolling out) | Freemium, import caps |
| **Samsung Food** (ex-Whisk) | Free recipe saver + planner + shopping, AI scan | iOS, Android, web | Free; Food+ ~US$60/yr |
| **Mealime** | Generates plans for you from its own recipes | iOS, Android | Free + Pro |
| **Plan to Eat** | Bring-your-own-recipes planner | Web, iOS, Android | ~US$5–6/mo |
| **Ollie** | AI family meal planner (fridge photo → meals, auto-order) | iOS | Subscription |
| **Mealie** | Self-hosted open-source manager + planner | Web (self-hosted) | Free |
| **MacroFactor** | Adaptive macro coach; has recipe importer + AI photo logging | iOS, Android | ~US$72/yr |
| **MyFitnessPal** | Mass-market calorie tracker; meal planner on top tier | iOS, Android, web | Premium / Premium+ |
| **Woolworths Olive / taste.com.au** | Retailer AI meal plans (Woolies) and shoppable recipes (Coles) | AU apps | Free, locked to one retailer |

---

## 3. Feature-by-feature

Legend: ✅ strong · 🟡 partial or basic · ❌ missing

| Capability | RecipeVault | Best in class | Notes |
|---|---|---|---|
| Import from recipe URL | ✅ JSON-LD + heuristic + review screen | Paprika, Mela, Crouton ✅ | On par. Everyone has this now. |
| Import from Instagram | 🟡 Desktop must be open (yt-dlp), caption only, no image | Pestle, ReciMe ✅ share-sheet, AI reads the video | **Big gap.** Ours is slow, fragile and uses the phone only as a queue. |
| Import from TikTok / YouTube / Pinterest | ❌ | ReciMe, Pestle, Samsung Food ✅ | Where people find recipes in 2026. |
| Photo / cookbook / screenshot import (OCR/AI) | ❌ | Crouton, ReciMe, Samsung Food ✅ | Family recipes and cookbooks can't get in at all. |
| Share-sheet "Share to RecipeVault" | ❌ (no PWA `share_target`) | All native apps ✅ | Copy-paste-switch-app is the slowest step in importing. |
| Edit a saved recipe | ❌ review form only appears at import | Everyone ✅ | **Table stakes.** Can't fix a bad parse or add your own tweak afterwards. |
| Personal notes, ratings, favourites | ❌ | Paprika, Mela, Crouton ✅ | "Made it, add more garlic" has nowhere to go. |
| Tags / collections for your own recipes | 🟡 cuisine/diet tags on catalog only | Paprika categories, Mealie collections ✅ | The library is one flat list. |
| Library search | 🟡 title only | Paprika, Mealie ✅ ingredient + tag search | Roadmap #6, still not built. |
| Serving scaler + metric conversion | ✅ | Paprika ✅ | On par. Our metric convert is a nice touch for AU. |
| Cook mode | 🟡 one step per screen, nothing else | Crouton, Pestle, Paprika ✅ timers from step text, ingredients alongside, screen stays on, hands-free/voice, lock-screen timers | **Big gap**, and you hit it every time you cook. |
| Screen stays awake while cooking | ❌ (no Wake Lock) | Paprika, Crouton ✅ | Tiny job, big annoyance fix. |
| Offline recipes | 🟡 app shell caches; recipe data needs network | Paprika, Mela ✅ fully offline | A bad kitchen signal or the shop with no reception breaks it. |
| Weekly meal plan | ✅ 7×3 grid, per person | Plan to Eat, Mealie ✅ dated calendar | We're un-dated: no history, no next week, no "copy last week". |
| Auto-generate a week | ✅ diet/cuisine/cook nights, deterministic | Mealime, Ollie ✅ (Ollie: AI + family schedules) | **Strong for us.** |
| Leftover-aware planning | ✅ batches chain forward, groceries count once | Mostly ❌ elsewhere | **Unique advantage.** Hardly anyone models this. |
| Grocery list from plan, merged | ✅ unit-aware merge | Everyone ✅ | On par. |
| Grocery list grouped by aisle | ❌ flat list | Paprika, ReciMe, Samsung Food, Mealie ✅ | Can be **automatic** (ingredient → category dictionary), so it fits the "no manual upkeep" rule. The roadmap only ruled out *manual* aisle ordering. |
| Shared household grocery list | 🟡 each person's own list; partner's is read-only | Paprika, Mela (Reminders), Samsung Food ✅ shared and editable | Couples usually shop off one list. |
| Online ordering / store prices | ❌ | Samsung Food, Mealime (US), Woolies Olive, taste.com.au (Coles) | No public Woolies/Coles API. Lower priority, but price awareness is a real AU need. |
| Macro estimate per recipe | ✅ AFCD-based, labelled as an estimate | MacroFactor, MFP 🟡 manual recipe builders | **Strong for us.** Recipe apps mostly have no nutrition. |
| Plan → tracker one-tap log | ✅ | ❌ elsewhere, mostly | **Unique advantage.** |
| Food tracker (search, barcode, AU-first) | ✅ AFCD + OFF, AU-ranked, per-user barcode cache | MacroFactor, MFP ✅ bigger databases, adaptive goals | Good for AU. Weaker on database size and coaching. |
| AI photo / voice food logging | ❌ | MacroFactor, MFP, Cal AI ✅ | Now expected by tracker users. |
| Trends | 🟡 7/30-day averages vs goals | MacroFactor ✅ adaptive targets, weight trend | No weight or body tracking to close the loop. |
| Household sharing | ✅ shared library, separate plans, partner view, enforced by RLS | Mealie ✅, Paprika 🟡 (sync only) | Strong. Ours is more principled than most. |
| Price / ads / paywall | ✅ none | Most have subscriptions, caps or ads | Real advantage for the household. Not a market advantage unless it's ever released. |
| Platforms | ✅ PWA (any phone) + Windows desktop | Paprika ✅ everywhere, separate purchases | Good. The PWA misses native extras (share sheet on iOS, Live Activities, widgets). |

---

## 4. Where we're better

1. **The joined-up loop: recipe → plan → groceries → macros.** Our core differentiator.
   MacroFactor has a recipe importer but no planner or grocery list. Paprika has the planner
   and groceries but no macros. Our pieces share one data model, so a planned dinner logs
   with one tap.
2. **Leftovers modelled properly.** Cook-night batches chaining into leftover slots, with
   groceries counting each batch once, is close to unique. Generators like Mealime and Ollie
   plan meal by meal.
3. **Australian food data.** AFCD-based estimates plus OpenFoodFacts ranked Australia-first.
   US-centric apps are poor at Australian brands and products.
4. **Honest estimates.** Macros labelled as estimates, no made-up calorie figures
   (`fix(food): never show a calorie figure the data doesn't have`). Most apps hide their
   uncertainty.
5. **Household model.** One shared library, a private week and tracker for each person, and
   a partner view, all enforced in the database. Most consumer apps either share everything
   or nothing.
6. **No paywall, no import caps, no ads.** Pestle caps free users at 15 recipes and ReciMe
   caps imports.

## 5. Where we're worse

1. **Recipes are frozen after import.** No editing, notes, ratings or favourites. This is
   the most basic thing a recipe manager does.
2. **Cook mode is bare.** No timers, no ingredient list on screen, and the screen sleeps.
   Every competitor in the "cooking" category beats us here, and this is the moment that
   makes or breaks how the app feels.
3. **Social import is behind.** Ours only works with the desktop on, reads captions only and
   brings no image. Competitors take a share from TikTok/IG/YouTube on the phone and
   AI-extract the recipe from the video in seconds.
4. **No photo or cookbook import.** Family recipes and cookbooks are locked out.
5. **The grocery list is flat and split by person.** No aisle grouping and no shared
   editable list. At the shop this feels worse than Apple Reminders.
6. **The library doesn't scale.** Title-only search, no collections or tags for your own
   recipes, no "most cooked" or "haven't made in a while".
7. **No dates or history in the planner.** You can't plan next week ahead or look back at
   last month.
8. **Not offline.** Recipes and the grocery list need a connection.

---

## 6. What to improve: a prioritised backlog

Same house rule as `docs/ROADMAP.md`: features run on data the app already captures, with
no optional manual upkeep. Sizes: S ≈ an evening, M ≈ a day or two, L ≈ several days.

### Tier 1: catch up on the basics (biggest gain in how it feels, lowest effort)

| # | Item | Size | Why |
|---|---|---|---|
| 1 | **Edit saved recipes.** Reuse `RecipeReviewForm` from the detail page. Add a personal **notes** field and a ❤️ **favourite**. | M | Table stakes. Also fixes bad parses, which hurts trust in the importer. |
| 2 | **Cook mode v2.** Tap-to-start **timers** parsed from step text (roadmap #5); an **ingredients drawer/side panel** with the ingredients each step uses highlighted; **Screen Wake Lock**; swipe between steps; big tap targets. | M | You hit this every time you cook. The visible gap against Crouton, Pestle and Paprika. |
| 3 | **Aisle-grouped groceries, automatically.** Map ingredient names to categories (produce, meat, dairy, pantry, frozen…) with a bundled dictionary, falling back to "Other". No manual ordering. | S–M | The way to tell a good list from a bad one at the shop. Fits the house rule. |
| 4 | **Ingredient + tag search in the library** (roadmap #6) plus filters for your own recipes (favourites, quick, cuisine). | S | "What can I make with this chicken?" |
| 5 | **Offline cache** of recipes, today's plan and the grocery list (Workbox runtime caching or a small IndexedDB mirror, with queued writes for ticking groceries). | M | The shop and the kitchen are exactly where signal drops. |

### Tier 2: make the joined-up loop obvious

| # | Item | Size | Why |
|---|---|---|---|
| 6 | **"Tonight" home screen.** What's for dinner, start cooking, log it, plus remaining macros and what's still left on the grocery list. | M | Puts the unique loop in front of you. Today you have to visit four tabs to see it. |
| 7 | **"Fit my macros" in the generator and suggestions.** Rank catalog/library recipes by how well they fill today's or this week's remaining protein/calories. | M | Uses the macro estimates no competitor's planner has. A planner that hits targets is a strong pitch. |
| 8 | **Dated weeks + history + copy last week** (rest of roadmap #4). Plan next week ahead, review last month, build "most cooked" and "not made in a while" automatically from plan history. | M–L | Unblocks smart suggestions with zero data entry. Plan history is captured automatically. |
| 9 | **Optional shared household grocery list.** One list both people can tick off live, alongside personal lists. | S–M | How couples actually shop. Realtime already exists. |
| 10 | **Discord bot sync** (roadmap #3). | S–M | Already promised in the UI. |

### Tier 3: AI-era import and logging (bigger bets)

| # | Item | Size | Why |
|---|---|---|---|
| 11 | **Server-side social import with an LLM.** A Vercel function takes a reel/TikTok/YouTube link and extracts a structured recipe from the caption, description and transcript, with an image. Removes the desktop dependency. Fallback: the current yt-dlp path. Note: Instagram blocks datacenter IPs, so this needs a fetch provider or the caption-only route. Prototype before committing. | L | Closes the biggest import gap with Pestle and ReciMe. |
| 12 | **Photo / screenshot / cookbook import.** Camera → vision model → the same review form. | M | Easier than #11 (no fetching problem), and opens up family recipes. |
| 13 | **PWA Share Target** (Android) so "Share → RecipeVault" works. On iOS, document an iOS Shortcut that opens `/import?url=…`. | S | Removes copy-paste from every import. |
| 14 | **Photo / text food logging** in the tracker ("chicken burrito bowl from Guzman"), matched against our AU database and shown as an estimate. | M–L | Brings us level with MacroFactor and MFP. |

### Deliberately still not doing

- **Pantry inventory:** still fails the house rule. Ollie's fridge photo is the only
  low-effort version worth revisiting later, as a one-off "what can I make tonight" rather
  than a tracked inventory.
- **Supermarket ordering:** there's no public Woolworths/Coles API. Revisit if a partner
  API appears. A cheaper step is a "copy list" export that pastes into the retailer apps.

---

## 7. Recommended next three

1. **Edit + notes + favourites** (fixes the most basic gap).
2. **Cook mode v2** (timers, ingredients on screen, wake lock).
3. **Aisle-grouped groceries.**

Together they're about a week of work and remove the friction you notice every day. After
them, **"Tonight" home screen + fit-my-macros suggestions** is the step that makes
RecipeVault clearly *better* than the alternatives rather than just comparable, because it's
the one thing they can't copy without also building a tracker and a leftover planner.

---

## Sources

- [Best Recipe Manager Apps in 2026: Paprika vs ReciMe vs Crouton vs Pestle vs Swoodie](https://swoodie.app/blog/best-recipe-manager-apps-2026)
- [Best Paprika Alternatives in 2026](https://swoodie.app/blog/best-paprika-alternatives-2026)
- [9 Best Recipe Apps in 2026 (Honeydew)](https://honeydewcook.com/guides/best-recipe-apps)
- [13 Best Recipe Apps in 2026 (Drizzle Lemons)](https://www.drizzlelemons.com/blog/best-recipe-apps-2026)
- [Best recipe organizer apps for iPhone in 2026 (My Sous Chef)](https://mysouschef.app/blog/best-recipe-organizer-apps-iphone/)
- [The Best Recipe Management Apps in 2026 (InnerBuddies)](https://www.innerbuddies.com/blogs/gut-health/best-recipe-management-app)
- [Paprika Recipe Manager 3, App Store](https://apps.apple.com/th/app/id1303222868)
- [Crouton: Recipe Manager, App Store](https://apps.apple.com/app/id1461650987)
- [Pestle 1.2: The MacStories Review](https://www.macstories.net/reviews/pestle-1-2-the-macstories-review/)
- [What Makes The New Pestle Cooking App So Unique (Tasting Table)](https://www.tastingtable.com/747033/what-makes-the-new-pestle-cooking-app-so-unique)
- [ReciMe blog](https://www.recime.app/blog/?p=4195) · [WhistleOut: best recipe apps](https://www.whistleout.com/CellPhones/Apps/best-recipe-apps)
- [Best Meal Planning Apps in 2026 (Macaron)](https://macaron.im/en/blog/best-meal-planning-apps) · [Whisk / Samsung Food (Stork)](https://www.stork.ai/en/whisk-samsung-food) · [Plan to Eat](https://www.plantoeat.com/?p=9210)
- [Ollie AI: Family Meal Planner, App Store](https://apps.apple.com/us/app/ollie-ai-family-meal-planner/id6480014476) · [AI apps for meal planning (Inquirer)](https://www.inquirer.com/food/ai-apps-meal-planning-shopping-20250828.html)
- [Mealie (LinuxLinks)](https://www.linuxlinks.com/mealie-self-hosted-recipe-manager-meal-planner/) · [Mealie (ElfHosted docs)](https://docs.elfhosted.com/app/mealie/)
- [MacroFactor vs MyFitnessPal](https://macrofactor.com/macrofactor-vs-myfitnesspal-2025/) · [MacroFactor 5.0.0 release notes](https://macrofactor.com/version-5-0-0/) · [Best MyFitnessPal alternatives 2026](https://www.welling.ai/articles/best-myfitnesspal-alternatives-2026)
- [Woolworths Olive meal planning (June 2026)](https://woolworthsgroup.com.au/au/en/our-newsroom/media-releases/latest-news/2026/woolworths-takes-the-hassle-out-of-the-weekly-shop-with-new-digi.html) · [taste.com.au + Coles integration (Mediaweek)](https://www.mediaweek.com.au/taste-com-au-unveils-major-overhaul-with-expanded-coles-integration) · [AU grocery list integrations (Home Assistant forum)](https://community.home-assistant.io/t/australian-grocery-lists/407594)
