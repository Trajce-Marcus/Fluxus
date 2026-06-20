# Fluxus — conventions

## Tree shaking

All packages must be authored to support tree shaking so that the platform bundle only includes code that is actually imported.

### Requirements for every package

1. **Use ES module syntax** — `export const` / `import { x } from`, never `module.exports` or `require`.
2. **Declare `"sideEffects": false`** in `package.json` unless the package genuinely has side effects (e.g. global CSS, polyfills).
3. **Avoid barrel re-exports of everything** — do not do `export * from './ComponentA'` across an entire directory in an index file. Export only what external consumers actually need, or have consumers import directly from the source file.

### How to check

When adding a new package or reviewing a PR, verify:

- [ ] `package.json` contains `"sideEffects": false` (or a justified exception is noted)
- [ ] No top-level `index.ts` that re-exports every module in the package unconditionally
- [ ] No `require()` / `module.exports` in source files

### What prevents tree shaking (and must be flagged in review)

| Pattern | Why it breaks tree shaking |
|---|---|
| `export * from './everything'` barrel files | Bundler cannot prove exports are side-effect free |
| `require()` / `module.exports` (CommonJS) | Bundler cannot statically analyse imports |
| Missing `"sideEffects": false` in `package.json` | Bundler assumes the worst and retains everything |
| Importing from a package's barrel when a direct path is available | Forces the barrel's full export graph to be evaluated |

### Exceptions

If a package genuinely needs side effects (e.g. it registers a global, injects CSS, patches a prototype), set `"sideEffects"` to an array of the specific files rather than `true`:

```json
{
  "sideEffects": ["./src/globalStyles.css", "./src/polyfill.ts"]
}
```

Document the reason in a comment in that file.
