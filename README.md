# enshrouded-crafting

Search Enshrouded items to see the recipe, crafter and workstation, plus the full crafting tree and raw material totals. Static site built with Vite, Alpine and Tailwind.

## Development

```
bun install
bun run dev
```

## Updating recipes

```
bun run sync
git diff data/
```

`bun run sync` rebuilds `data/recipes.json` from the wiki API. A GitHub Action also runs it every Monday and opens a PR when data changes. Merging to `main` deploys the site.

The wiki can differ from the game. Put corrections in `data/overrides.json`, which is reapplied on every sync:

```json
{ "Item Name": { "addIngredients": { "Water": 10 }, "requires": ["Sheltered Bed"] } }
```

## GitHub setup

- Settings > Pages > Source: GitHub Actions
- Settings > Actions > General: allow GitHub Actions to create pull requests

## Credits

Recipe data and item images come from the [Enshrouded Wiki](https://enshrouded.wiki.gg/) and its contributors. Wiki text and `data/recipes.json` are licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0). Code is MIT, see `LICENSE`. Not affiliated with Keen Games or wiki.gg.
