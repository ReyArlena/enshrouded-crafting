import Alpine from 'alpinejs'
import './style.css'

const IMAGE_BASE = 'https://enshrouded.wiki.gg/images/'
const ALL = 'All'

Alpine.data('crafting', () => ({
  items: [],
  index: new Map(),
  consumers: new Map(),
  error: '',
  query: '',
  crafter: ALL,
  crafters: [ALL],
  station: '',
  stations: [],
  includeRaw: false,
  limit: 150,
  selected: null,
  recipeIndex: 0,
  tab: 'Recipe',
  amount: 1,

  async init() {
    try {
      const { default: items } = await import('../data/recipes.json')
      this.index = new Map(items.map((i) => [i.name, i]))
      for (const item of items) {
        for (const r of item.recipes) {
          for (const ing of r.ingredients) {
            if (!this.consumers.has(ing.name)) this.consumers.set(ing.name, new Set())
            this.consumers.get(ing.name).add(item.name)
          }
        }
      }
      const recipes = items.flatMap((i) => i.recipes)
      this.crafters = [ALL, ...new Set(recipes.map((r) => r.crafter).filter(Boolean).sort())]
      this.stations = [...new Set(recipes.flatMap((r) => r.stations))].sort()
      this.items = items
      this.readSearch()
      this.readHash()
      this.$watch('query', () => this.writeSearch())
      window.addEventListener('hashchange', () => this.readHash())
      window.addEventListener('popstate', () => this.readSearch())
    } catch (e) {
      this.error = 'Could not load recipes. Please refresh the page.'
      console.error(e)
    }
  },

  readSearch() {
    const search = new URLSearchParams(location.search).get('search') ?? ''
    // Keeps in-progress typing, such as a trailing space, when the term is unchanged.
    if (search !== this.query.trim()) this.query = search
  },

  writeSearch() {
    const url = new URL(location.href)
    const search = this.query.trim()
    if (search) url.searchParams.set('search', search)
    else url.searchParams.delete('search')
    // Replaces rather than pushes, so each keystroke is not a Back step.
    history.replaceState(history.state, '', url)
  },

  readHash() {
    const name = decodeURIComponent(location.hash.slice(1))
    if (name && this.index.has(name)) this.show(name)
  },

  select(name) {
    location.hash = encodeURIComponent(name)
    this.show(name) // Also covers reselecting the current hash after closing.
  },

  show(name) {
    if (this.selected?.name !== name) {
      this.recipeIndex = 0
      this.amount = 1
    }
    this.selected = this.index.get(name)
  },

  get results() {
    const terms = this.query.toLowerCase().split(/\s+/).filter(Boolean)
    const q = terms.join(' ')
    const matches = this.items.filter((item) => {
      if (!this.includeRaw && !item.recipes.length && !terms.length) return false
      if (this.crafter !== ALL && !item.recipes.some((r) => r.crafter === this.crafter)) return false
      if (this.station && !item.recipes.some((r) => r.stations.includes(this.station))) return false
      const name = item.name.toLowerCase()
      return terms.every((t) => name.includes(t))
    })
    if (!q) return matches
    const rank = (item) => {
      const name = item.name.toLowerCase()
      return name === q ? 0 : name.startsWith(q) ? 1 : 2
    }
    return matches.sort((a, b) => rank(a) - rank(b))
  },

  get groups() {
    // Search results stay ranked in one list, which can be cut anywhere.
    if (this.query.trim()) {
      const items = this.results.slice(0, this.limit)
      return items.length ? [{ name: 'Results', items }] : []
    }
    const groups = new Map()
    for (const item of this.results) {
      const key = item.type || 'Other'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    // Browsing reveals whole groups, so a type is never shown part-filled.
    const shown = []
    let count = 0
    for (const [name, items] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      if (shown.length && count + items.length > this.limit) break
      shown.push({ name, items })
      count += items.length
    }
    return shown
  },

  get shownCount() {
    return this.groups.reduce((sum, group) => sum + group.items.length, 0)
  },

  get recipe() {
    return this.selected?.recipes[this.recipeIndex] ?? null
  },

  get safeAmount() {
    return Math.max(1, Math.floor(Number(this.amount)) || 1)
  },

  get ingredients() {
    if (!this.recipe) return []
    const crafts = Math.ceil(this.safeAmount / this.recipe.quantity)
    return this.recipe.ingredients.map((i) => ({ name: i.name, total: i.quantity * crafts }))
  },

  /** Flattens the recipe tree to rows, stopping at raw materials and recipe loops. */
  get tree() {
    if (!this.recipe) return []
    const rows = []
    const walk = (recipe, needed, depth, path) => {
      const crafts = Math.ceil(needed / recipe.quantity)
      for (const ing of recipe.ingredients) {
        const total = ing.quantity * crafts
        const next = this.index.get(ing.name)?.recipes[0]
        const raw = !next || !next.ingredients.length || path.has(ing.name)
        rows.push({ name: ing.name, total, depth, raw })
        if (!raw) walk(next, total, depth + 1, new Set(path).add(ing.name))
      }
    }
    walk(this.recipe, this.safeAmount, 0, new Set([this.selected.name]))
    return rows
  },

  get rawTotals() {
    const totals = new Map()
    for (const row of this.tree) if (row.raw) totals.set(row.name, (totals.get(row.name) ?? 0) + row.total)
    return [...totals].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total)
  },

  get usedIn() {
    return [...(this.consumers.get(this.selected?.name) ?? [])].sort()
  },

  imageUrl(item) {
    return item?.image ? IMAGE_BASE + item.image : ''
  },

  iconFor(name) {
    return this.imageUrl(this.index.get(name))
  },

  sourceOf(name) {
    const item = this.index.get(name)
    const recipe = item?.recipes[0]
    if (recipe) return recipe.stations[0] || recipe.crafter || 'Crafted'
    return item?.biomes || ''
  },

  rarityClass(item) {
    return `rarity-${(item.rarity || 'common').toLowerCase()}`
  },

  wikiUrl(name) {
    return `https://enshrouded.wiki.gg/wiki/${encodeURIComponent(name.replaceAll(' ', '_'))}`
  },
}))

Alpine.start()
