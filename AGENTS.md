# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## What This Project Is

**customUIBuilder** is an Angular 19 SPA that lets ZuperPro users visually compose and generate `index.js` SDK extension files. Users log in with their ZuperPro credentials, select pre-built features from a catalog, fill in webhook URLs and other config, then either download the generated JS or deploy it directly to their ZuperPro account via the API.

The generated output runs **inside ZuperPro** (not in this app) as a Custom UI extension injected into an iframe, using `window.ZClient` / `window.zclient`.

## Commands

```bash
# Install dependencies
npm install

# Development server (http://localhost:4200)
npm start          # or: ng serve

# Production build → dist/custom-ui-builder/
npm run build

# Run all unit tests (Karma/Jasmine, requires Chrome)
npm test           # or: ng test

# Run a single test file
ng test --include='**/code-generator.service.spec.ts'

# Watch mode build (development)
npm run watch
```

## Architecture

### Routes & Auth

- `/` — `HomeComponent` (public landing page)
- `/login` — `LoginComponent` (blocked if already logged in via `guestGuard`)
- `/builder` — `UiBuilderComponent` (requires `auth_token` in localStorage via `authGuard`)
- `/features` — `FeaturesComponent` (public feature catalog browser)

Guards (`src/app/auth.guard.ts`) use `localStorage.getItem('auth_token')` as the sole auth check.

### Login Flow

`LoginComponent` first calls `https://accounts.zuperpro.com/api/config` (with company name) to resolve the region-specific `dc_api_url`, then calls `{dc_api_url}/api/user/login`. On success it stores `auth_token`, `api_url`, and `user` JSON in `localStorage`.

### Feature Catalog → Code Generator Pipeline

This is the heart of the app:

1. **`src/app/data/features-catalog.ts`** — The single source of truth for all available features. Each `Feature` object defines:
   - `id` (e.g. `'F-01'`), `label`, `description`
   - `pages`: ZuperPro page IDs where the feature's stateChange function is invoked (empty array for global/init-only features)
   - `fnName`: function name called inside the `stateChange` handler (empty string for global-only)
   - `initFnName?`: if present, also called once inside `app.registered`
   - `requiredConfig`: array of `ConfigField` objects (`key`, `label`, `type: 'text'|'url'|'textarea'`, optional `default`/`hint`/`placeholder`)
   - `codeBlock(cfg)`: function that returns the raw JS string for that feature, interpolating config values

2. **`src/app/services/code-generator.service.ts`** — Assembles selected features into a complete `index.js`. Output structure:
   ```
   window.zclient = window.ZClient.init();
   const API_CONFIG = { live: { <url fields> }, staging: {} };
   window.zclient.on("app.registered", async function () {
     // initFnName calls
     window.zclient.on("stateChange", async function ({ page, id }) {
       if (page === "X") { await featureX(stateChangeData); }
       else if (page === "Y") { ... }
     });
   });
   // Feature function definitions (from codeBlock())
   // Shared helpers: createButton, createModal, createToast, createDialog,
   //                 getUserTeams, getJobDetails, createLog, genUUID, wait
   ```
   The shared helpers are hardcoded at the bottom of every generated file and are always available to all feature functions.

3. **`UiBuilderComponent`** (`src/app/ui-builder/`) — The `/builder` page UI. Maintains a `Map<featureId, SelectedFeature>` as state. Calls `CodeGeneratorService.generate()` on every toggle or config change. The "Deploy" button POSTs to `{api_url}/api/misc/custom_code` with headers `x-zuper-client: WEB_APP` and `x-zuper-client-version: 3.0`.

4. **`SyntaxHighlightPipe`** (`src/app/pipes/`) — A custom, zero-dependency JS syntax tokenizer/highlighter used to display the generated code in the output panel.

### Adding a New Feature

Add a new entry to the `FEATURES` array in `src/app/data/features-catalog.ts`. Follow the `Feature` interface. The feature will automatically appear in both the `/features` browser and the `/builder` selector. No other files need changes unless you are adding a genuinely new shared helper.

### ZuperPro SDK Context (for generated code)

The output JS targets `window.ZClient` / `window.zclient`. Key patterns used across all generated features:
- **Deduplication**: `isExist(id)` → `instance(uid).invoke("ui.remove")` → recreate, because `stateChange` fires on every navigation
- **Component creation**: `window.zclient.invoke("ui.create", config)` for BUTTON, MODAL (FORM/HTML/IFRAME), TOAST, DIALOG
- **Global-init features** (e.g. F-08, F-10, F-14, F-20): registered via `initFnName` inside `app.registered`, not per-page in `stateChange`
- **Auth/data**: `localStorage.getItem("auth_token")`, `localStorage.getItem("dc_api_url")`, `localStorage.getItem("user")`
- Comprehensive SDK reference is in `SDK_FEATURE_DOCUMENTATION.md`

### Angular Patterns

All components are standalone (no NgModules). Angular Material with the `azure-blue` prebuilt theme is the UI library. `HttpClient` is provided globally via `provideHttpClient()` in `app.config.ts`. The app uses zone-based change detection with `eventCoalescing: true`.
