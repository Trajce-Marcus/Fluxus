---
name: verify
description: How to launch and drive the Fluxus packages for end-to-end verification (sdm workbench via Playwright + system Chrome).
---

# Verifying Fluxus changes end-to-end

## sdm workbench (Vite React app)

Launch (background, pick a free port):

```bash
cd packages/sdm && npx vite --port 5199 --strictPort
```

Drive with Playwright using **system Chrome** (`channel: 'chrome'`) — no Playwright
browsers are installed on this machine, but `npx playwright` resolves (npx cache) and
Chrome lives in /Applications. From a scratch dir, symlink the npx cache so ESM
`import 'playwright'` resolves:

```bash
mkdir -p <scratch>/node_modules
ln -sf ~/.npm/_npx/e41f203b7505f1fb/node_modules/playwright \
       ~/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core <scratch>/node_modules/
```

(If that npx hash is gone, `npx playwright --version` once to re-populate, then
`find ~/.npm/_npx -maxdepth 3 -name playwright -type d`.)

```js
const browser = await chromium.launch({ channel: 'chrome', headless: true });
```

## Test data

Records persist in localStorage key `fluxus:sdm:records` as `[[id, RecordInstance], …]`
(`RecordInstance` = `{ id, typeRef: 'rt_…', customFields, activityHistory }`). Seed
before app boot with `page.addInitScript` — the adapter reads localStorage at
construction. Cities/suburbs self-seed; other types start empty (creating e.g. a work
order via UI needs FK targets that may not exist).

## Useful observation points

- Config-save-time validation logs to console on app start: look for
  `[SDM config]` lines (`page.on('console', …)`).
- Availability/show_condition failures warn with `failing closed` in the console.
- Flows worth driving: record type list → grid → record view activity strip →
  activity modal form (submit button text: "Submit"); warn soft-stops show a
  Continue-anyway button.
