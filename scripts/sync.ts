// Pulls crafting recipes from the Enshrouded Wiki API into data/recipes.json.
// Output is sorted and has no timestamp, so it only changes when the data does.
const API = 'https://enshrouded.wiki.gg/api.php'
const HEADERS = { 'User-Agent': 'enshrouded-crafting-sync/0.1 (https://github.com/ReyArlena/enshrouded-crafting)' }
const OUT = new URL('../data/recipes.json', import.meta.url).pathname
const OVERRIDES = new URL('../data/overrides.json', import.meta.url).pathname
const MIN_ITEMS = 1000 // Refuse to overwrite good data with a broken fetch.

const NPCS = new Set([
  'Alchemist', 'Ancient Researcher', 'Bard', 'Barber', 'Blacksmith', 'Carpenter',
  'Collector', 'Farmer', 'Fisher', 'Hunter', 'Lunar New Year Trader',
])

// The wiki spells some item types several ways. Keys are lower case; null drops junk values.
const TYPE_ALIASES: Record<string, string | null> = {
  arrow: 'Bow Ammo',
  'bow ammo': 'Bow Ammo',
  'bow ammunition': 'Bow Ammo',
  consumable: 'Consumables',
  material: 'Materials',
  spells: 'Spell',
  tool: 'Tools',
  'two-handed greatsword': 'Two-handed Greatsword',
  x: null,
}

function normalizeType(type: string | null): string | null {
  if (!type) return null
  const key = type.toLowerCase()
  return key in TYPE_ALIASES ? TYPE_ALIASES[key] : type
}

type Params = Record<string, string>
type Recipe = {
  crafter: string | null
  stations: string[]
  time: string | null
  quantity: number
  ingredients: { name: string; quantity: number }[]
  requires?: string[]
}
type Item = {
  name: string
  type: string | null
  rarity: string | null
  level: number | null
  biomes: string | null
  description: string | null
  image: string | null
  recipes: Recipe[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function api(params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({ format: 'json', formatversion: '2', ...params })
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API, { method: 'POST', body, headers: HEADERS })
    if (res.ok) {
      await sleep(500)
      return res.json()
    }
    if (attempt >= 4) throw new Error(`API returned ${res.status}`)
    await sleep(2000 * attempt)
  }
}

const chunks = <T>(list: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

/** Finds {{Name|...}} calls, balancing nested braces so {{Get|x}} values survive. */
function findTemplates(text: string, names: string[]): string[] {
  const wanted = new RegExp(`\\{\\{\\s*(?:${names.join('|')})\\s*(?=[|}])`, 'gi')
  const found: string[] = []
  for (const match of text.matchAll(wanted)) {
    let depth = 0
    for (let i = match.index; i < text.length - 1; i++) {
      const pair = text.slice(i, i + 2)
      if (pair === '{{') { depth++; i++ }
      else if (pair === '}}') {
        depth--; i++
        if (depth === 0) { found.push(text.slice(match.index + 2, i - 1)); break }
      }
    }
  }
  return found
}

function parseParams(template: string): Params {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (let i = 0; i < template.length; i++) {
    const pair = template.slice(i, i + 2)
    if (pair === '{{' || pair === '[[') { depth++; current += pair; i++; continue }
    if (pair === '}}' || pair === ']]') { depth--; current += pair; i++; continue }
    if (template[i] === '|' && depth === 0) { parts.push(current); current = ''; continue }
    current += template[i]
  }
  parts.push(current)
  const params: Params = {}
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=')
    if (eq > 0) params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim()
  }
  return params
}

/** Reduces wiki markup to plain text. */
function clean(value: string | undefined): string | null {
  if (!value) return null
  const text = value
    .replace(/<!--.*?-->/gs, '')
    .replace(/<ref[^>]*>.*?<\/ref>/gs, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

const warnings: string[] = []

function parseIngredients(value: string | null, page: string) {
  if (!value) return []
  const list: Recipe['ingredients'] = []
  for (const raw of value.split(',')) {
    if (!raw.trim()) continue
    const match = raw.match(/^[\s:]*(.+?)\s*:\s*(\d+)\s*$/)
    if (match) list.push({ name: match[1], quantity: Number(match[2]) })
    else warnings.push(`${page}: could not parse ingredient "${raw.trim()}"`)
  }
  return list
}

function parseRecipe(params: Params, page: string): Recipe {
  const rawCrafter = clean(params['crafter'])
  const named = [rawCrafter, clean(params['workshop']), clean(params['workshop2'])].filter(Boolean) as string[]
  // The wiki sometimes swaps these fields, so sort values by what they are.
  const crafter = named.find((n) => NPCS.has(n)) ?? null
  const stations = [...new Set(named.filter((n) => !NPCS.has(n)))]
  return {
    crafter,
    stations,
    time: clean(params['crafting time']),
    quantity: Number(clean(params['crafted quantity'])) || 1,
    ingredients: parseIngredients(clean(params['ingredients']), page),
  }
}

function parseInfobox(wikitext: string, page: string) {
  const [box] = findTemplates(wikitext, ['[\\w ]*Infobox'])
  const p = box ? parseParams(box) : {}
  const image = clean((p['images'] ?? p['image'] ?? '').replace(/\{\{\s*(SUB)?PAGENAME\s*\}\}/g, page))
  return {
    type: normalizeType(clean(p['type'])),
    rarity: clean(p['rarity']),
    level: Number(clean(p['level'])) || null,
    biomes: clean(p['biomes']),
    description: clean(p['description']),
    imageFile: image?.split(/[,;]/)[0].trim() || `${page}.png`,
  }
}

/** Resolves {{Get|...}} values, which only the wiki itself can compute. */
async function expand(wikitext: string, page: string): Promise<string> {
  if (!/\{\{\s*Get\s*\|/i.test(wikitext)) return wikitext
  let result = wikitext
  for (const call of new Set(wikitext.match(/\{\{\s*Get\s*\|[^{}]*\}\}/gi) ?? [])) {
    const value = await api({ action: 'expandtemplates', title: page, prop: 'wikitext', text: call })
    result = result.replaceAll(call, value.expandtemplates.wikitext)
  }
  return result
}

async function fetchRecipePages(): Promise<Map<string, string>> {
  const pages = new Map<string, string>()
  let cont: Record<string, string> = {}
  while (true) {
    const data = await api({
      action: 'query', generator: 'embeddedin', geititle: 'Template:CraftingRecipe', geinamespace: '0',
      geilimit: '50', prop: 'revisions', rvprop: 'content', rvslots: 'main', ...cont,
    })
    for (const page of data.query?.pages ?? []) {
      const content = page.revisions?.[0]?.slots?.main?.content
      if (content) pages.set(page.title, content)
    }
    console.log(`Fetched ${pages.size} recipe pages`)
    if (!data.continue) return pages
    cont = data.continue
  }
}

/** Fetches ingredient pages that have no recipe, and maps redirected names to their target. */
async function fetchPages(titles: string[]) {
  const pages = new Map<string, string>()
  const aliases = new Map<string, string>()
  for (const batch of chunks(titles, 50)) {
    const data = await api({
      action: 'query', titles: batch.join('|'), redirects: '1',
      prop: 'revisions', rvprop: 'content', rvslots: 'main',
    })
    for (const r of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) aliases.set(r.from, r.to)
    for (const page of data.query?.pages ?? []) {
      const content = page.revisions?.[0]?.slots?.main?.content
      if (content) pages.set(page.title, content)
    }
  }
  return { pages, aliases }
}

/** Returns file name to thumbnail path, relative to the wiki's /images/ directory. */
async function fetchImages(files: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  for (const batch of chunks([...new Set(files)], 50)) {
    const data = await api({
      action: 'query', titles: batch.map((f) => `File:${f}`).join('|'),
      prop: 'imageinfo', iiprop: 'url', iiurlwidth: '128',
    })
    const from = new Map<string, string>((data.query?.normalized ?? []).map((n: any) => [n.to, n.from]))
    for (const page of data.query?.pages ?? []) {
      const info = page.imageinfo?.[0]
      if (!info) continue
      const original = (from.get(page.title) ?? page.title).replace(/^File:/, '')
      const url: string = info.thumburl ?? info.url
      urls.set(original, url.split('/images/')[1] ?? url)
    }
  }
  return urls
}

const recipePages = await fetchRecipePages()
const infos = new Map<string, ReturnType<typeof parseInfobox>>()
const items = new Map<string, Item>()

const addItem = (name: string): Item => {
  let item = items.get(name)
  if (!item) {
    const info = infos.get(name)
    item = {
      name, type: info?.type ?? null, rarity: info?.rarity ?? null, level: info?.level ?? null,
      biomes: info?.biomes ?? null, description: info?.description ?? null, image: null, recipes: [],
    }
    items.set(name, item)
  }
  return item
}

for (const [title, raw] of recipePages) {
  const wikitext = await expand(raw, title)
  infos.set(title, parseInfobox(wikitext, title))
  const item = addItem(title)
  for (const template of findTemplates(wikitext, ['Crafting', 'CraftingRecipe'])) {
    const params = parseParams(template)
    const target = clean(params['crafteditem'])
    const owner = target && target !== title ? addItem(target) : item
    owner.recipes.push(parseRecipe(params, title))
  }
}

// Bring in raw materials, which appear only as ingredients.
const missing = new Set<string>()
for (const item of items.values()) {
  for (const recipe of item.recipes) for (const i of recipe.ingredients) if (!items.has(i.name)) missing.add(i.name)
}
const { pages: ingredientPages, aliases } = await fetchPages([...missing])
for (const [title, wikitext] of ingredientPages) infos.set(title, parseInfobox(wikitext, title))
const resolve = (name: string): string => {
  const seen = new Set<string>()
  while (aliases.has(name) && !seen.has(name)) { seen.add(name); name = aliases.get(name)! }
  return name
}
for (const item of [...items.values()]) {
  for (const recipe of item.recipes) {
    for (const i of recipe.ingredients) { i.name = resolve(i.name); addItem(i.name) }
  }
}

// Hand corrections for things the wiki omits.
const overrides = await Bun.file(OVERRIDES).json()
for (const [name, fix] of Object.entries<any>(overrides)) {
  const item = items.get(name)
  if (!item) { warnings.push(`Override target not found: ${name}`); continue }
  for (const recipe of item.recipes) {
    for (const [ingredient, quantity] of Object.entries<number>(fix.addIngredients ?? {})) {
      if (!recipe.ingredients.some((i) => i.name === ingredient)) {
        recipe.ingredients.unshift({ name: ingredient, quantity })
        addItem(ingredient)
      }
    }
    if (fix.requires) recipe.requires = fix.requires
  }
}

const files = new Map([...items.keys()].map((n) => [n, infos.get(n)?.imageFile ?? `${n}.png`]))
const images = await fetchImages([...files.values()])
for (const item of items.values()) item.image = images.get(files.get(item.name)!) ?? null

const sorted = [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'))
if (sorted.length < MIN_ITEMS) throw new Error(`Only ${sorted.length} items parsed, keeping existing data`)
await Bun.write(OUT, JSON.stringify(sorted, null, 1) + '\n')

const recipes = sorted.flatMap((i) => i.recipes)
console.log(`Items: ${sorted.length}, recipes: ${recipes.length}`)
console.log(`No crafter or station: ${recipes.filter((r) => !r.crafter && !r.stations.length).length}`)
console.log(`No ingredients: ${recipes.filter((r) => !r.ingredients.length).length}`)
console.log(`No image: ${sorted.filter((i) => !i.image).length}`)
console.log(`Stations: ${[...new Set(recipes.flatMap((r) => r.stations))].sort().join(', ')}`)
if (warnings.length) console.warn(`Warnings:\n  ${warnings.join('\n  ')}`)
