# Fluxus

A low-code platform monorepo. Fluxus provides tools for building, running, and extending workflow automation — WQL (Workflow Query Language) is the first package, with more to come.

## Packages

| Package | Description |
|---|---|
| `@wql/types` | Shared TypeScript interfaces for domain objects, workflows, and execution |
| `@wql/runtime` | WQL execution engine, mock context builder, and Monaco language definition |
| `@wql/builder` | React/Vite workflow builder application |

## Documentation

- [Conventions](docs/conventions.md) — tree shaking, module authoring rules, review checklist

## Getting started

### Prerequisites
- Node.js 18+
- npm 8+ (workspaces support)

### Install

```bash
npm install
```

### Run the builder app

```bash
npm run dev
```

Then open http://localhost:5173

### Build for production

```bash
npm run build
```

## Project structure

```
fluxus/
├── package.json                  # Root workspace config
└── packages/
    └── wql/                      # WQL — Workflow Query Language
        ├── wql-types/            # @wql/types
        │   └── src/index.ts      # All shared TypeScript types
        ├── wql-runtime/          # @wql/runtime
        │   └── src/
        │       ├── executor.ts       # WQL execution engine
        │       ├── mockContext.ts    # Mock wo/wf context builder
        │       ├── wqlLanguage.ts    # Monaco language + autocomplete
        │       └── index.ts
        └── wql-builder/          # @wql/builder — React app
            └── src/
                ├── components/
                │   ├── layout/       # TopBar
                │   ├── editor/       # WQLEditor, EditorArea, StatusBar
                │   ├── sidebar/      # WorkflowList, ObjectModelTree, Sidebar
                │   └── output/       # ContextPanel, ExecutionLog, TriggerConfig, OutputPanel
                ├── pages/
                │   └── BuilderPage.tsx
                ├── store/
                │   └── workflowStore.ts   # Zustand store
                ├── App.tsx
                └── main.tsx
```

## WQL — Workflow Query Language

WQL is a sandboxed JavaScript DSL for authoring field-service workflows. Each workflow receives two injected context objects:

### `wo` — the work order that triggered the workflow

```js
wo.woId           // string
wo.status         // string
wo.dueDate        // Date
wo.activityType   // string
wo.assignedTo     // User | null
wo.asset          // Asset | null
wo.attributes     // Attribute[] with .find() and .filter()
wo.job            // Job — parent job
wo.job.jobNo      // string
wo.job.attributes // mutable key-value map
wo.job.workOrders // WO[]
wo.job.project    // Project with .users[]
```

### `wf` — workflow context and built-in functions

```js
wf.now            // Date — current execution time
wf.trigger        // string — event that fired this workflow
wf.owner          // User — workflow owner
wf.log(msg)       // write to execution log
wf.error(msg)     // log an error
wf.notify(user)   // send notification to user
```

### Attribute value helpers

```js
attribute.value.toInt()   // parse as integer
attribute.value.toDate()  // parse as Date
attribute.value.toBool()  // parse as boolean
```

### Example

```js
if (wo.dueDate < (wf.now - 3)) {
  wo.job.attributes["KPI missed"] = true;
  wf.log("KPI missed on job " + wo.job.jobNo);
  wf.notify(wf.owner);
}
```
