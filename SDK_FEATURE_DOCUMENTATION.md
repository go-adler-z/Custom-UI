# ZuperPro Custom UI SDK — Complete Feature Documentation

> **Source:** Analyzed from `/home/gokulkrishnavs/C/ps-custom-ui/v3` (34 client implementations, 37 files)
> **Purpose:** Exhaustive reference for any developer or AI model to understand, reproduce, and extend the entire feature set without additional input.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture & Design Patterns](#2-architecture--design-patterns)
3. [SDK Core API Reference](#3-sdk-core-api-reference)
4. [Feature Library — Exhaustive Index](#4-feature-library--exhaustive-index)
5. [UI Component System](#5-ui-component-system)
6. [Event System](#6-event-system)
7. [Data Access & Mutation](#7-data-access--mutation)
8. [API Request System](#8-api-request-system)
9. [Page & Navigation System](#9-page--navigation-system)
10. [Feature Deep Dives](#10-feature-deep-dives)
11. [Configuration & Environment Management](#11-configuration--environment-management)
12. [Utility Functions](#12-utility-functions)
13. [Cross-Cutting Concerns](#13-cross-cutting-concerns)
14. [Client Implementation Reference](#14-client-implementation-reference)
15. [End-to-End Workflow Examples](#15-end-to-end-workflow-examples)
16. [Booking Widget (Standalone)](#16-booking-widget-standalone)
17. [Known Patterns & Anti-Patterns](#17-known-patterns--anti-patterns)

---

## 1. System Overview

The ZuperPro Custom UI SDK enables third-party JavaScript extensions that run inside the ZuperPro field-service SaaS platform. Each extension is a single JavaScript file (`index.js`) injected into the platform's web application. Extensions react to page navigation events, create UI components (buttons, modals, toasts, dialogs), read and write platform data, and call external webhooks or internal REST APIs.

### 1.1 Execution Context

- The extension runs inside an **iframe** hosted inside the ZuperPro SPA.
- `window.ZClient` is the globally available SDK factory provided by the host application.
- All SDK operations are **asynchronous** (Promise-based).
- The extension has access to `localStorage` for reading the authenticated user's token, region, and profile.

### 1.2 Initialization Sequence

```
1. window.zclient = window.ZClient.init()          // Obtain SDK client instance
2. window.zclient.on("app.registered", handler)    // Wait for host to register the app
3. Inside handler: register stateChange listener   // React to page navigation
4. Inside stateChange: call page-specific logic    // Render components per page
```

### 1.3 Repository Structure

```
/v3/
├── Template/index.js          ← Canonical starter template (153 lines)
├── Amway/index.js             ← Most complex enterprise impl (4,109 lines)
├── Interior Care/index.js     ← Material allocation system (~2,711 lines)
├── Interior Care/v2_index.js  ← v2 of above (~2,730 lines)
├── awrs/index.js              ← Service task assignment (1,432 lines)
├── MLS/index.js               ← Smart scanning & PO (1,176 lines)
├── Weifield/index.js          ← Timesheet punch tracking (807 lines)
├── Alveole/index.js           ← IFRAME-based service tasks (516 lines)
├── Bullfrog_Spas/bullfrog_v3.js ← Contract lifecycle (416 lines)
├── Exo/index.js               ← Timelog IFRAME embed (380 lines)
├── Central Home Systems/booking_widget.html ← Standalone widget (563 lines)
└── [24 other client folders]
```

---

## 2. Architecture & Design Patterns

### 2.1 Standard (Flat Function) Pattern

Used by the majority of implementations. All logic lives in top-level async functions. Suitable for small to medium complexity.

```javascript
// FILE STRUCTURE:
window.zclient = window.ZClient.init();

// 1. Global configuration
const API_CONFIG = { live: { webhookUrl: "..." }, staging: { webhookUrl: "..." } };
const env = "live";
const ENV_VARS = API_CONFIG[env];

// 2. App registered (one-time init)
window.zclient.on("app.registered", async function (data) {
  await GlobalComponents(); // create persistent UI elements
  window.zclient.on("stateChange", async function ({ page, id }) {
    if (page === "job_details")    await JobDetails({ page, id });
    else if (page === "job_list")  await JobList();
    // ... other pages
  });
});

// 3. Page handler functions
async function JobDetails(stateChangeData) { ... }
async function JobList() { ... }

// 4. Helper / UI factory functions (see Section 5)
async function createButton(config) { ... }
async function createModal(config) { ... }
async function createToast(config) { ... }
async function createDialog(config) { ... }
```

### 2.2 Factory / Module Pattern

Used by the most sophisticated implementation (`Bullfrog_Spas/bullfrog_v3.js`). Functions that create closures over shared state. Enables unit testing and separation of concerns.

```javascript
// Factory pattern: each factory takes dependencies and returns an object of methods
const createAppInitializer = (zclient) => {
  const initZc       = async () => { ... };
  const initPackages = async (zc) => { ... };
  const main = async () => {
    const zc = await initZc();
    const elemUtils    = createElemUtils(zc);
    const zuperUtils   = createZuperUtils(zc);
    const restrictions = createDateRestrictionsManager(zc, moment, elemUtils);
    const initBtns     = createInitBtns(elemUtils, zuperUtils, zc);
    const btnVisibMng  = createBtnVisibMng(elemUtils, zc);
    await regInitEvents(zc, restrictions, initBtns, btnVisibMng);
  };
  return { main };
};

// Entry point
createAppInitializer(window.ZClient).main().catch(console.error);
```

**Factories in Bullfrog_Spas implementation:**

| Factory | Responsibility |
|---|---|
| `createAppInitializer` | Top-level orchestration, init sequence |
| `createElemUtils` | All UI element creation (button, toast, modal, loader) |
| `createZuperUtils` | Zuper-specific API helpers (team fetch, etc.) |
| `createDateRestrictionsManager` | Date validation for dispatch board and rescheduling |
| `createInitBtns` | Button registration + event handlers |
| `createBtnVisibMng` | Dynamic button show/hide based on job state |

### 2.3 Nested stateChange Registration

Some implementations register the `stateChange` handler **inside** `app.registered`:

```javascript
window.zclient.on("app.registered", async function (data) {
  // global init here
  window.zclient.on("stateChange", async function (stateChangeData) { ... });
});
```

Others register `stateChange` at the top level (outside `app.registered`):

```javascript
window.zclient.on("app.registered", async function (data) { ... });
window.zclient.on("stateChange", async (data) => { ... });
```

Both approaches work. The nested approach is preferred when global state from `app.registered` (e.g., current user, config fetched at startup) must be available inside `stateChange` handlers.

### 2.4 Component Lifecycle (Deduplication Pattern)

Every page component follows a three-step lifecycle to prevent duplicate DOM elements:

```javascript
// Step 1: Check if component already exists
let existingBtn = await window.zclient.isExist("my-button-id");

// Step 2: If it exists, remove it
if (existingBtn?.uid) {
  let instance = window.zclient.instance(existingBtn.uid);
  instance.invoke("ui.remove");
}

// Step 3: Create fresh component
const { success, data: btnInstance } = await createButton(config);
```

This is required because `stateChange` fires on every navigation. Without deduplication, buttons accumulate on repeated visits to the same page.

---

## 3. SDK Core API Reference

### 3.1 `window.ZClient.init()`

Initializes and returns the SDK client instance.

```javascript
window.zclient = window.ZClient.init();
// Returns: zclient instance
```

In the factory pattern, `zclient` is the factory class and `init()` is called on it:

```javascript
const zc = await zclient.init();   // inside createAppInitializer(window.ZClient)
window.zclient = zc;
```

### 3.2 `window.zclient.on(eventName, handler)`

Registers an event listener. Events are described in full in [Section 6](#6-event-system).

```javascript
window.zclient.on("app.registered", async function(data) { ... });
window.zclient.on("stateChange", async function({ page, id }) { ... });
window.zclient.on("job.status_update", async function(data) { ... });
window.zclient.on("invoice_new.organization", async function(data) { ... });
window.zclient.on("pre_event.dispatch_board.job_schedule_change", async function({ data }) { ... });
```

### 3.3 `window.zclient.invoke(action, config)`

Creates UI components or triggers platform actions.

```javascript
// Create a UI component
const result = await window.zclient.invoke("ui.create", componentConfig);
// result.uid — unique ID of the created component
// result.error — error string if creation failed

// Navigate to a page
await window.zclient.invoke("page.navigate", { page: "invoice_list", module: "invoice" });

// Refresh current page
await window.zclient.invoke("page.refresh");
await window.zclient.invoke("page.refresh", "invoice_details"); // specific page

// Reject a pre_event (block the default action)
await zc.handle("pre_event.reject", { field: "dispatch_board.job_schedule_change" });
```

### 3.4 `window.zclient.instance(uid)`

Retrieves a component instance by its UID. Instances expose `.on()`, `.invoke()`, `.prop()`, `.get()`, `.dispatch()` methods.

```javascript
let instance = window.zclient.instance(uid);

// Instance methods:
instance.on("click", handler);         // button click
instance.on("confirm", handler);       // modal confirm
instance.on("changes", handler);       // form field change
instance.on("listen", handler);        // IFRAME postMessage listener
instance.on("open", handler);          // reschedule panel open

instance.invoke("ui.open");            // open modal/dialog
instance.invoke("ui.close");           // close modal/dialog
instance.invoke("ui.remove");          // destroy component
instance.invoke("ui.show");            // make visible
instance.invoke("ui.hide");            // hide component

instance.prop("start_date", { min: "2025-01-01" });  // set property constraints
instance.get("field-id");             // get form field value
instance.dispatch({ type, content }); // send message to embedded IFRAME
```

### 3.5 `window.zclient.isExist(componentId)`

Checks if a component with the given string ID exists.

```javascript
const result = await window.zclient.isExist("my-button-id");
// result.uid — UID if exists
// result.error — truthy if does not exist
if (result?.uid) { /* exists */ }
if (!result.error) { /* exists (alternative check) */ }
```

### 3.6 `window.zclient.get(key)`

Reads platform data for the current page context.

```javascript
// Current-page data getters
const job      = await window.zclient.get("job");           // job_details page
const invoice  = await window.zclient.get("invoice");       // invoice_details page
const user     = await window.zclient.get("user");          // logged-in user
const project  = await window.zclient.get("project");       // project_details page

// Form data getters (for *_new pages)
const formData = await window.zclient.get("job_new.form");   // job creation form
const formData = await window.zclient.get("invoice_new.form"); // invoice creation form

// Entity by UID
const orgData  = await window.zclient.get({ key: "organization", uid: org_uid });
const jobData  = await window.zclient.get({ key: "job", uid: job_uid });

// Return structure:
// { success: true, response: { ...entityData } }
// { success: false, error: "..." }
```

### 3.7 `window.zclient.set(key, value)`

Writes a value to a form field on the current page.

```javascript
// Set form field value
await window.zclient.set("invoice_new.prefix", "RM10");
await window.zclient.set("job_new.prefix", "TX10");
await window.zclient.set("job_new.startDate", utcDate);
await window.zclient.set("job_new.endDate", utcDate);
```

### 3.8 `window.zclient.request(config)`

Makes an HTTP request, either to the internal ZuperPro API or an external URL.

```javascript
const response = await window.zclient.request({
  url: "/jobs/abc-123",            // relative = internal API; absolute = external
  type: "GET",                     // "GET" | "POST" | "PUT" | "DELETE"
  contentType: "application/json", // content type header
  cors: false,                     // false for internal; true may be needed for external
  externalRequest: false,          // false = proxy through Zuper; true = direct call
  data: { key: "value" },          // request body (for POST/PUT)
});

// Return structure for internal requests:
// { body: { data: {...}, message: "...", status: 200 }, ok: true }

// Return structure for external webhook requests:
// { body: { ...webhookResponse } }
```

### 3.9 `window.zclient.handle(eventName, config)`

Used exclusively to reject pre-events (block default platform actions).

```javascript
await zc.handle("pre_event.reject", {
  field: "dispatch_board.job_schedule_change",
});
```

### 3.10 `window.zclient.packages`

Access to bundled third-party libraries.

```javascript
const moment = window.zclient.packages.moment;   // Moment.js
```

---

## 4. Feature Library — Exhaustive Index

| # | Feature | Pages | Source |
|---|---|---|---|
| F-01 | [Invoice Approval Workflow](#f-01-invoice-approval-workflow) | invoice_details | Weifield |
| F-02 | [Sage/NetSuite Invoice Resync](#f-02-sagentsuite-invoice-resync) | invoice_details | Weifield, Amway, MLS |
| F-03 | [Invoice Prefix Auto-Set by State](#f-03-invoice-prefix-auto-set-by-state) | invoice_new | Weifield |
| F-04 | [Job Prefix Auto-Set by State](#f-04-job-prefix-auto-set-by-state) | job_new | Weifield |
| F-05 | [Job Start/End Time Auto-Set from Business Hours](#f-05-job-startend-time-auto-set-from-business-hours) | job_new | Weifield |
| F-06 | [Discount Details Modal](#f-06-discount-details-modal) | job_details | Weifield |
| F-07 | [Organization Sage ID Validation on Invoice Creation](#f-07-organization-sage-id-validation-on-invoice-creation) | invoice_new | Weifield |
| F-08 | [Delivery Date Restriction on Dispatch Board](#f-08-delivery-date-restriction-on-dispatch-board) | dispatch_board | Bullfrog_Spas (Exo) |
| F-09 | [Assign Job To Me (Single)](#f-09-assign-job-to-me-single) | job_details | Bullfrog_Spas |
| F-10 | [Assign Job To Me (Bulk)](#f-10-assign-job-to-me-bulk) | job_list | Bullfrog_Spas |
| F-11 | [Go To Dispatch Board Button](#f-11-go-to-dispatch-board-button) | job_details | Bullfrog_Spas |
| F-12 | [Timelog IFRAME Modal (Job)](#f-12-timelog-iframe-modal-job) | job_details | Exo |
| F-13 | [Timelog IFRAME Modal (Project)](#f-13-timelog-iframe-modal-project) | project_details | Exo |
| F-14 | [Bulk Service Task Assignment via IFRAME](#f-14-bulk-service-task-assignment-via-iframe) | job_list | Alveole |
| F-15 | [Inspection Form Data Report](#f-15-inspection-form-data-report) | report_list | Alveole |
| F-16 | [Smart Document Scan (Product List)](#f-16-smart-document-scan-product-list) | product_list | MLS |
| F-17 | [Purchase Order Creation (from Products)](#f-17-purchase-order-creation-from-products) | product_list, product_details, job_details | MLS |
| F-18 | [Job Profitability View](#f-18-job-profitability-view) | job_details | MLS |
| F-19 | [Budget vs Actual (Project)](#f-19-budget-vs-actual-project) | project_details | MLS |
| F-20 | [Timesheet Punch In / Out / Break / Resume](#f-20-timesheet-punch-in--out--break--resume) | job_details, timesheet_list | MLS, Weifield |
| F-21 | [Timesheet Button Visibility State Machine](#f-21-timesheet-button-visibility-state-machine) | job_details | MLS |
| F-22 | [Clock-Shop Times Report (with Date Range & Filters)](#f-22-clock-shop-times-report-with-date-range--filters) | report_list, timesheet_list | MLS, Alveole |
| F-23 | [Standalone Booking Widget](#f-23-standalone-booking-widget) | — (standalone HTML) | Central Home Systems |
| F-24 | [Color Information Lookup via Hollander #](#f-24-color-information-lookup-via-hollander-) | job_details | Amway/awrs |
| F-25 | [Print Label Consolidation & Email](#f-25-print-label-consolidation--email) | job_details | Amway |
| F-26 | [Budget vs Actual Report (Invoice Batch Sync)](#f-26-budget-vs-actual-report-invoice-batch-sync) | invoice_details | Amway |
| F-27 | [Service Task Dashboard with Image Gallery](#f-27-service-task-dashboard-with-image-gallery) | job_details | Amway |
| F-28 | [Dynamic Pricing Display Modal](#f-28-dynamic-pricing-display-modal) | job_details | Amway |
| F-29 | [NetSuite Sync Retry (with Status Tracking)](#f-29-netsuite-sync-retry-with-status-tracking) | invoice_details | Amway |
| F-30 | [Timesheet Report Button (Breadcrumb)](#f-30-timesheet-report-button-breadcrumb) | timesheet_list | Template |
| F-31 | [Component Deduplication Pattern](#f-31-component-deduplication-pattern) | all | Template |
| F-32 | [Structured Logging Utility](#f-32-structured-logging-utility) | all | Template, Exo |
| F-33 | [Business Hours Time Enforcement](#f-33-business-hours-time-enforcement) | job_new | Weifield |
| F-34 | [Navigator URL Redirect (Dispatch Board Deep Link)](#f-34-navigator-url-redirect-dispatch-board-deep-link) | job_details | Bullfrog_Spas |
| F-35 | [Commission Report Generator](#f-35-commission-report-generator) | job_list | A-1 Concrete |
| F-36 | [Pool Chemistry Field Auto-Clear (LSI)](#f-36-pool-chemistry-field-auto-clear-lsi) | job_new | AJ Pools |
| F-37 | [Multi-Account Switcher](#f-37-multi-account-switcher) | dashboard | Brothergutters |
| F-38 | [Cancel & Clone Quote](#f-38-cancel--clone-quote) | estimate_details | Clean Made |
| F-39 | [Job Pictures Manager (Download & Review)](#f-39-job-pictures-manager-download--review) | job_details | Del Mar |
| F-40 | [Assisted Scheduling via IFRAME](#f-40-assisted-scheduling-via-iframe) | job_details | ESI |
| F-41 | [Job Status Count Dashboard](#f-41-job-status-count-dashboard) | job_list | Evereve |
| F-42 | [Asset Report Download (XLSX)](#f-48-asset-report-download-xlsx) | asset_details | Gillette Pepsi |
| F-43 | [QBD Accounting Report Generation](#f-43-qbd-accounting-report-generation) | report_list | JWC |
| F-44 | [Job Profitability Chart (Webhook HTML)](#f-44-job-profitability-chart-webhook-html) | job_details | JWC |
| F-45 | [Job Template Manager](#f-45-job-template-manager) | job_details | Maven |
| F-46 | [Timesheet Report with Date Range Validation](#f-46-timesheet-report-with-date-range-validation) | timesheet_list | Netfor |
| F-47 | [Products Report Download (XLSX)](#f-47-products-report-download-xlsx) | product_list | New England Waterproofing |
| F-48 | [Asset Report Download (XLSX)](#f-48-asset-report-download-xlsx) | asset_details | Gillette Pepsi, SPTech Helical Piers, Wesgroup |

---

## 5. UI Component System

All UI components are created via `window.zclient.invoke("ui.create", config)`. The config object always contains `id`, `type`, and type-specific options.

### 5.1 BUTTON

Renders a clickable button in a specified page location.

#### Configuration Schema

```javascript
{
  id: "string",           // Required. Unique identifier. Used for deduplication.
  type: "BUTTON",         // Required.
  title: "string",        // Button label text
  icon: "string",         // Icon name (Tabler icon set, e.g., "clock-check", "sync", "robot")
  page: "string",         // Page where button appears (see Page Identifiers in Section 9)
  location: "string",     // "BREADCRUMB" | "BULK_ACTION" | "INLINE"
  position: "string",     // "left" | "right" (optional)
  className: "string",    // CSS class (e.g., "hidden" to start hidden)
}
```

#### Locations

| Location | Description | Applicable Pages |
|---|---|---|
| `BREADCRUMB` | Top-right area of page header | Any detail or list page |
| `BULK_ACTION` | Toolbar that appears when rows are selected | `job_list`, `product_list`, etc. |
| `INLINE` | Inline within page content | Context-dependent |

#### Events

```javascript
btnInstance.on("click", async (eventData) => {
  // For BULK_ACTION buttons, eventData contains:
  // {
  //   uid: ["job_uid_1", "job_uid_2"],           // selected record UIDs
  //   isTotalRecordSelected: false,               // true if "select all" was used
  //   filter_rules: [...]                         // active filter rules
  // }
});
```

#### Actions on Instance

```javascript
btnInstance.invoke("ui.show");    // make button visible
btnInstance.invoke("ui.hide");    // hide button
btnInstance.invoke("ui.remove");  // destroy button
```

#### createButton Helper (Canonical Implementation)

```javascript
async function createButton(btn_config) {
  try {
    let btn = await window.zclient.invoke("ui.create", btn_config);
    if (btn.error) throw btn.error;
    let button = window.zclient.instance(btn.uid);
    return { success: true, data: button };
  } catch (error) {
    return { success: false, data: error };
  }
}
```

---

### 5.2 MODAL

Overlay dialog. Supports three content modes: `FORM`, `HTML`, and `IFRAME`.

#### FORM Modal

Renders a form with typed fields. Triggers `confirm` event with field values.

```javascript
{
  id: "modal-id",
  type: "MODAL",
  options: {
    title: "Modal Title",
    position: "center",       // "center" | "right" | "left"
    dataType: "FORM",
    size: "string",           // "sm" | "md" | "lg" | "xl"
    label: "Subtitle text",   // optional description below title
    auto_close: false,        // prevent close on backdrop click
    height: "340px",          // optional explicit height
    width: "740px",           // optional explicit width
    fields: [                 // array of field definitions
      {
        label: "Field Label",
        description: "",
        type: "DATE",         // see Field Types below
        id: "field-id",       // unique within modal; used as key in confirm event data
        default: "",          // pre-filled value
        values: [],           // for SINGLE_ITEM / MULTI_ITEM: array of option strings
        field_options: {
          is_required: true,   // validation
          hidden: false,       // conditional visibility
          width: "col-span-2", // Tailwind grid span
        }
      }
    ],
    actions: {
      confirm: {
        label: "Submit",       // button label
        hide: false,           // hide confirm button
        color: "primary",
        confirmDisplayKey: "ActionKey",
      },
      cancel: {
        label: "Close",        // button label
        hide: false,
      },
    },
  },
}
```

**FORM Field Types:**

| type | Description |
|---|---|
| `DATE` | Date picker |
| `SINGLE_ITEM` | Dropdown / radio — pick one from `values` array |
| `MULTI_ITEM` | Multi-select from `values` array |
| `TEXT` | Single-line text input |
| `TEXTAREA` | Multi-line text input |
| `NUMBER` | Numeric input |

**FORM Modal Events:**

```javascript
// Fires when user clicks confirm
modalInstance.on("confirm", async (formData) => {
  // formData: { "field-id": value, ... }
  const fromDate = formData["from_date"];
  const selected = formData["approve-reject"];
});

// Fires on any field change
modalInstance.on("changes", async (data) => {
  // Get current field values
  const val = await modalInstance.get("field-id");
  // Returns { "field-id": currentValue }
});
```

#### HTML Modal

Renders arbitrary HTML content.

```javascript
{
  id: "html-modal-id",
  type: "MODAL",
  options: {
    title: "My HTML Modal",
    position: "center",
    dataType: "HTML",
    size: "lg",
    html: "<div>Any HTML string here</div>",
    actions: {
      cancel: { label: "Close" },
      confirm: { hide: true },
    },
  },
}
```

#### IFRAME Modal

Embeds an external web page. Communicates via `postMessage` through `dispatch` and `listen`.

```javascript
{
  id: "iframe-modal-id",
  type: "MODAL",
  options: {
    title: null,              // null hides title bar
    dataType: "IFRAME",
    position: "center",
    url: "https://example.com/page",
    height: "47rem",
    width: "65rem",
    hide_header: true,        // hides modal chrome header
    hide_footer: true,        // hides modal chrome footer
    full_screen: false,       // expand to full viewport
    auto_close: false,        // prevent auto-dismiss
    actions: {
      confirm: { hide: true },
      cancel: { label: "Close", hide: false },
    },
  },
}
```

**IFRAME Communication:**

```javascript
// SDK → IFRAME (push data into IFRAME)
await modalInstance.dispatch({
  type: "getData",         // custom event type; IFRAME reads via window.addEventListener("message")
  content: JSON.stringify({ key: "value" }),
});

// IFRAME → SDK (receive events from IFRAME)
modalInstance.on("listen", async ({ type, content }) => {
  if (type === "initiate") {
    // IFRAME signals it is ready; send init data
    await modalInstance.dispatch({
      type: "init_data",
      content: JSON.stringify({ jobDetails, token, baseUrl }),
    });
  }
  if (type === "success") {
    window.zclient.invoke("page.refresh");
    modalInstance.invoke("ui.remove");
  }
  if (type === "cancel" || type === "close") {
    modalInstance.invoke("ui.remove");
  }
});
```

#### Modal Instance Actions

```javascript
modalInstance.invoke("ui.open");    // open/show the modal
modalInstance.invoke("ui.close");   // close without destroy
modalInstance.invoke("ui.remove");  // destroy modal
```

#### createModal Helper (Canonical)

```javascript
async function createModal(modalConfig) {
  try {
    let modal = await window.zclient.invoke("ui.create", modalConfig);
    let modalInstance = window.zclient.instance(modal.uid);
    return { success: true, data: modalInstance };
  } catch (error) {
    return { success: false, data: error };
  }
}
```

---

### 5.3 TOAST

Non-blocking notification banner.

#### Configuration Schema

```javascript
{
  id: "toast-unique-id",
  type: "TOAST",
  message: "Message text to display",
  options: {
    autoClose: true,           // auto-dismiss after delay
    position: "top-center",    // "top-center" | "top-right" | "bottom-right" | "bottom-center"
    type: "success",           // "success" | "error" | "warning" | "info" | "loading"
    dismissible: true,         // show X button
    icon: "😊",               // optional custom icon (emoji or string)
  },
}
```

**Toast Types & Use Cases:**

| type | Color | Use case |
|---|---|---|
| `success` | Green | Operation completed successfully |
| `error` | Red | Operation failed, validation error |
| `warning` | Yellow/Orange | Advisory, partial success |
| `info` | Blue | Neutral information |
| `loading` | Spinner | Async operation in progress (set `autoClose: false`) |

**Loading Toast Pattern:**

```javascript
// Show loading spinner
const { success, data: loaderInstance } = await createToast({
  id: "loader-toast",
  type: "TOAST",
  message: "Fetching data...",
  options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
});

// ... do async work ...

// Dismiss loader
if (success) loaderInstance.invoke("ui.close");
```

#### createToast Helper (Canonical)

```javascript
async function createToast(toastConfig) {
  try {
    let toast = await window.zclient.invoke("ui.create", toastConfig);
    let toastInstance = await window.zclient.instance(toast.uid);
    return { success: true, data: toastInstance };
  } catch (error) {
    return { success: false, data: error };
  }
}
```

---

### 5.4 DIALOG

Blocking confirmation dialog. Used for destructive or high-stakes actions.

#### Configuration Schema

```javascript
{
  id: "dialog-unique-id",
  type: "DIALOG",
  options: {
    title: "Confirmation Title",
    type: "error",              // "error" | "warning" | "info" | "success"
    message: "Are you sure?",
    actions: {
      confirm: {
        show: true,
        label: "Yes, Proceed",
        color: "primary",
        confirmDisplayKey: "ProceedAction",
      },
      cancel: {
        show: true,
        label: "Cancel",
      },
    },
    dismissible: false,         // prevent backdrop dismiss
  },
}
```

**Dialog Events:**

```javascript
dialogInstance.on("confirm", async (response) => {
  // User confirmed — perform action
  await window.zclient.invoke("page.navigate", { page: "invoice_list", module: "invoice" });
});
dialogInstance.invoke("ui.open");
```

#### createDialog Helper (Canonical)

```javascript
async function createDialog(dialogConfig) {
  try {
    let dialog = await window.zclient.invoke("ui.create", dialogConfig);
    let dialogInstance = await window.zclient.instance(dialog.uid);
    return { success: true, data: dialogInstance };
  } catch (error) {
    return { success: false, data: error };
  }
}
```

---

## 6. Event System

### 6.1 Lifecycle Events

| Event | When | Data |
|---|---|---|
| `app.registered` | Once, when the SDK extension is registered by the host | `{}` |
| `stateChange` | Every page navigation | `{ page: string, id: string }` |

### 6.2 Form Field Change Events

Field change events fire when a user modifies a field on a creation form. Pattern: `{page}.{fieldName}`.

| Event | Page | When | Data |
|---|---|---|---|
| `invoice_new.organization` | invoice_new | Organization field changes | `{ data: { newValue: { organization_uid }, oldValue } }` |
| `invoice_new.service_address` | invoice_new | Service address changes | `{ data: { newValue: { state, city, ... }, oldValue } }` |
| `job_new.organization` | job_new | Organization field changes | `{ data: { newValue: {...} } }` |
| `job_new.service_address` | job_new | Service address changes | `{ data: { newValue: { state, ... } } }` |
| `job_new.startDate` | job_new | Start date changes | `{ data: { newValue: { startDate: Date }, oldValue: { startDate: Date } } }` |
| `job_new.endDate` | job_new | End date changes | `{ data: { newValue: { endDate: Date }, oldValue: { endDate: Date } } }` |
| `job_new.customer` | job_new | Customer changes | `{ data: { newValue: {...} } }` |
| `job_new.category` | job_new | Category changes | `{ data: { newValue: {...} } }` |
| `organization_new.organization_email` | organization_new | Email field changes | `{ data: { newValue: string } }` |
| `estimate_new.line_items` | estimate_new | Line items modified | `{ data: { newValue: [...] } }` |
| `estimate_new.price_list` | estimate_new | Price list changes | `{ data: { newValue: {...} } }` |

### 6.3 Status Update Events

| Event | When | Data |
|---|---|---|
| `job.status_update` | Job status changes | `{ data: { newStatus, oldStatus, job_uid } }` |
| `estimate.status_update` | Estimate status changes | `{ data: { newStatus, oldStatus } }` |
| `pre_event.job_details.job_status` | Before job status changes (blockable) | `{ data: { newStatus, jobDetails } }` |

### 6.4 Dispatch Board Events

| Event | When | Data |
|---|---|---|
| `dispatch_board.job_reschedule` on instance | Reschedule panel opens | `{ data: { job_details: { job_uid, ... } } }` |
| `job_details.job_reschedule` on instance | Reschedule from job details | Same as above |
| `pre_event.dispatch_board.job_schedule_change` | Before schedule changes (blockable) | `{ data: { newValue: { startDate }, jobDetails: {...} } }` |

**Usage for date restriction:**

```javascript
// Listen on the reschedule UI element instance
window.zclient.instance("dispatch_board.job_reschedule")
  .on("open", (eventData) => {
    const jobUid = eventData?.data?.job_details?.job_uid;
    // set min date on the date picker
    instance.prop("start_date", { min: "2025-06-01" });
  });

// Pre-event to block schedule change
window.zclient.on("pre_event.dispatch_board.job_schedule_change", async ({ data }) => {
  if (/* validation fails */) {
    await zc.handle("pre_event.reject", { field: "dispatch_board.job_schedule_change" });
  }
});
```

### 6.5 Page Identifiers (stateChange.page)

| Page ID | Description |
|---|---|
| `job_details` | Individual job detail view |
| `job_list` | Job listing with filters |
| `job_new` | New job creation form |
| `invoice_details` | Individual invoice detail view |
| `invoice_list` | Invoice listing |
| `invoice_new` | New invoice creation form |
| `estimate_details` | Estimate detail view |
| `estimate_new` | New estimate creation form |
| `project_details` | Project detail view |
| `product_list` | Product / parts listing |
| `product_details` | Individual product detail |
| `timesheet_list` | Timesheet listing |
| `report_list` | Reports page |
| `dispatch_board` | Dispatch / scheduling board |
| `organization_new` | New organization creation form |
| `contract_details` | Contract detail view |

---

## 7. Data Access & Mutation

### 7.1 Reading Current Page Entity

```javascript
// On job_details page
const { success, response: jobData } = await window.zclient.get("job");
const { job_uid, job_title, job_category, custom_fields, products, assigned_to } = jobData;

// On invoice_details page
const { success, response: invoiceData } = await window.zclient.get("invoice");
const { invoice_uid, custom_fields } = invoiceData;

// On project_details page
const { success, response: projectData } = await window.zclient.get("project");

// Logged-in user
const { success, response: userData } = await window.zclient.get("user");
const { user_uid, email, first_name, last_name } = userData;
```

### 7.2 Reading Entity by UID

```javascript
// Fetch specific organization
const result = await window.zclient.get({ key: "organization", uid: org_uid });
const orgData = result.response;

// Fetch specific job
const result = await window.zclient.get({ key: "job", uid: job_uid });
```

### 7.3 Reading Form Data (Creation Pages)

```javascript
// Read the current state of the job creation form
const formResult = await window.zclient.get("job_new.form");
const state = formResult?.response?.serviceAddress?.state;

// Read invoice creation form
const formResult = await window.zclient.get("invoice_new.form");
const orgId = formResult?.response?.organization;
```

### 7.4 Setting Form Field Values

```javascript
// Set invoice number prefix based on state
await window.zclient.set("invoice_new.prefix", "RM10");

// Set job number prefix
await window.zclient.set("job_new.prefix", "TX10");

// Set start/end date
await window.zclient.set("job_new.startDate", utcDateObject);
await window.zclient.set("job_new.endDate", utcDateObject);
```

### 7.5 Reading Custom Fields

Custom fields are arrays on the entity. Use `.find()` to locate by label:

```javascript
const customFields = jobData.custom_fields; // Array of { label, value, type, ... }

const sageStatus = customFields.find(cf => cf.label === "Sage Invoice Sync Status")?.value || "";
const sageCustId = customFields.find(cf => cf.label === "Sage Customer ID")?.value;
const deliveryDate = customFields.find(f => f.label === "1st Available Delivery Date")?.value;
const awaitingFor = customFields.find(x => x.label === "Awaiting response for")?.value ?? "";
```

### 7.6 LocalStorage Keys

| Key | Content | Usage |
|---|---|---|
| `auth_token` | JWT Bearer token | Passed to external services or IFRAME URLs |
| `dc_api_url` | Base API URL for the data center | Passed to IFRAME for API calls |
| `dc_region` | Region identifier | Passed to webhooks for routing |
| `user` | JSON string: `{ user_uid, email, first_name, last_name }` | User identification without API call |

```javascript
const authToken = localStorage.getItem("auth_token");
const baseUrl   = localStorage.getItem("dc_api_url");
const region    = localStorage.getItem("dc_region");
const user      = JSON.parse(localStorage.getItem("user") || "{}");
const { user_uid, email } = user;
```

---

## 8. API Request System

### 8.1 Internal API Calls

Set `externalRequest: false`. The URL is relative to the ZuperPro API base. The SDK proxies the request and injects auth headers automatically.

```javascript
const response = await window.zclient.request({
  url: `/jobs/${jobUid}`,
  type: "GET",
  cors: false,
  contentType: "application/json",
  externalRequest: false,
});
const jobData = response?.body?.data;
```

**Common Internal Endpoints:**

| Endpoint | Method | Description |
|---|---|---|
| `/jobs/{job_uid}` | GET | Fetch job details |
| `/jobs/{job_uid}/update?job_uid={uid}&notify_users=true&update_all_jobs=false` | PUT | Update/assign job |
| `/jobs/filter` | POST | Filter jobs by criteria |
| `/invoices/{invoice_uid}` | GET | Fetch invoice details |
| `/projects/{project_uid}` | GET | Fetch project details |
| `/user/{user_uid}/teams` | GET | Get user's team memberships |
| `/timesheets/{user_uid}` | GET | Get user timesheets |
| `/timesheets/bulk_update` | POST | Bulk update timesheets |
| `/service_tasks` | GET | Get service task definitions |
| `/assets/inspection_form/{submissionId}` | GET | Get inspection form data |
| `/organization/{org_uid}` | GET | Fetch organization details |
| `/activities` | POST | Create activity log entry |
| `/misc/email_template` | GET | Get email template |
| `/misc/template_preview` | POST | Preview email template |
| `/customers/{customer_id}/send` | POST | Send communication to customer |
| `/products/location` | GET | Get product location data |
| `/notes` | POST/PUT | Create or update notes |
| `/api/company/config` | GET | Get company configuration (business hours, etc.) |

### 8.2 External API / Webhook Calls

Set `externalRequest: true`. The URL must be absolute. CORS headers apply.

```javascript
const response = await window.zclient.request({
  url: "https://internalwf.zuper.co/webhook/abc-123",
  type: "POST",
  cors: false,
  contentType: "application/json",
  externalRequest: true,
  data: JSON.stringify({ invoice_uid: "...", triggered_by: "..." }),
});
```

**Note:** `data` for POST requests can be a plain object or a JSON-stringified string.

### 8.3 Job Assignment API (Pattern)

```javascript
await window.zclient.request({
  url: `/jobs/${job_uid}/update?job_uid=${job_uid}&notify_users=true&update_all_jobs=false`,
  type: "PUT",
  contentType: "application/json",
  data: {
    job: [{ type: "ASSIGN", user_uid, team_uid, is_primary: false }],
  },
  externalRequest: false,
});
```

---

## 9. Page & Navigation System

### 9.1 Reading Current Page State

```javascript
window.zclient.on("stateChange", async ({ page, id }) => {
  // page — string identifier (see Section 6.5)
  // id   — UID of the current entity (job_uid for job_details, invoice_uid for invoice_details, etc.)
});
```

### 9.2 Navigating to a Page

```javascript
// Navigate to a listing page
await window.zclient.invoke("page.navigate", {
  page: "invoice_list",
  module: "invoice",
});

// Navigate with params
await window.zclient.invoke("page.navigate", {
  page: "invoice_list",
  module: "invoice",
  params: { action: "new" },
});
```

### 9.3 Refreshing the Current Page

```javascript
await window.zclient.invoke("page.refresh");
await window.zclient.invoke("page.refresh", "invoice_details"); // explicit page name
```

### 9.4 Deep-Linking to Dispatch Board

The dispatch board supports URL-based deep linking via work order number:

```javascript
const job = await zc.get("job");
const { work_order_number } = job.response;
window.parent.location.href = `${window.parent.origin}/dispatch_board?work-order-number=${work_order_number}`;
```

---

## 10. Feature Deep Dives

### F-01: Invoice Approval Workflow

**File:** `Weifield/index.js` — `InvoiceApproval()` inside `InvoiceDetails()`
**Page:** `invoice_details`

**Behavior:**
1. Reads the logged-in user from `localStorage`.
2. Fetches user's team memberships via `/user/{uid}/teams`.
3. Reads the `"Awaiting response for"` custom field from the invoice.
4. If the custom field value matches the user's team name, renders an "Approve / Reject" button in the breadcrumb.
5. Button click opens a FORM modal with a `SINGLE_ITEM` field (`["Approve", "Reject"]`).
6. On confirm, POSTs `{ invoice_uid, user_uid, type: "approve"|"reject" }` to the approval webhook.
7. Shows success/error toast. Does NOT auto-refresh.

**Key Code Pattern:**
```javascript
const awaitingResponseFor = invoiceDetails?.custom_fields?.find(
  (x) => x.label == "Awaiting response for"
)?.value ?? "";

const teamMatches = userTeams.some((team) =>
  team.team_name.includes(awaitingResponseFor)
);
if (teamMatches) approveOrRejectInvoice();
```

---

### F-02: Sage/NetSuite Invoice Resync

**File:** `Weifield/index.js` — `InvoiceDetails()`
**Page:** `invoice_details`

**Behavior:**
1. Reads the `"Sage Invoice Sync Status"` custom field from the invoice.
2. If the value exists and is not `"success"`, renders a "Resync invoice with sage" button.
3. On button click, re-fetches invoice to confirm status hasn't changed to `"success"` or `"In Progress"`.
4. POSTs `{ invoice_uid, triggered_by: user_uid }` to the resync webhook.
5. Shows toast: "Sage invoice resync initiated" and refreshes the page.
6. If status is `"In Progress"`, shows "already in progress" toast.
7. If status is `"success"`, shows "Invoice pushed to sage" toast.

**Guard Pattern (double-check before API call):**
```javascript
btnInstance.on("click", async () => {
  // Re-fetch inside click handler to avoid stale state
  let invoiceDetails = await window.zclient.get("invoice");
  let syncStatus = invoiceDetails.response.custom_fields.find(cf => cf.label === fieldLabel)?.value;
  if (syncStatus && syncStatus != "success" && syncStatus != "In Progress") {
    await window.zclient.request(requestConfig);
  }
});
```

---

### F-03: Invoice Prefix Auto-Set by State

**File:** `Weifield/index.js` — `InvoiceNew()`
**Page:** `invoice_new`

**Behavior:**
1. Listens to `invoice_new.service_address` field changes.
2. Maps state names to prefixes: `{ colorado → "RM10", texas → "TX10", tennesse → "TN10" }`.
3. If the new state matches a config key, calls `zclient.set("invoice_new.prefix", prefix)`.
4. Also reads form data on page load in case state is pre-populated (after 1s delay).

```javascript
const config = { "colorado": "RM10", "texas": "TX10", "tennesse": "TN10" };
await window.zclient.on("invoice_new.service_address", async (data) => {
  const state = data.data.newValue.state?.trim();
  if (state && config.hasOwnProperty(state.toLowerCase())) {
    await window.zclient.set("invoice_new.prefix", config[state.toLowerCase()]);
  }
});
```

---

### F-04: Job Prefix Auto-Set by State

**File:** `Weifield/index.js` — `NewJob()`
**Page:** `job_new`

**Behavior:** Identical to F-03 but for `job_new.service_address` → `job_new.prefix`.

---

### F-05: Job Start/End Time Auto-Set from Business Hours

**File:** `Weifield/index.js` — `NewJob()`
**Page:** `job_new`

**Behavior:**
1. GETs company configuration from `/api/company/config`.
2. Extracts `business_hours.start_time` and `business_hours.end_time`.
3. Listens to `job_new.startDate` and `job_new.endDate` changes.
4. When the **date** changes (day/month/year differs from old value), auto-sets the time component to business hours start/end time respectively.
5. Uses UTC date construction to avoid timezone issues.

**Time override logic (`setTime` helper):**
```javascript
function setTime(oldDate, newDate, timeString) {
  const [hours, minutes, seconds] = timeString.split(":").map(Number);
  // Only update time if the date (day) has actually changed
  if (!oldDate || oldDate.getUTCDate() !== newDate.getUTCDate() || ...) {
    return new Date(Date.UTC(newDate.getUTCFullYear(), newDate.getUTCMonth(),
      newDate.getUTCDate(), hours, minutes, seconds));
  }
  return null; // no change needed
}
```

---

### F-06: Discount Details Modal

**File:** `Weifield/index.js` — `ViewDiscount()` inside `JobDetails()`
**Page:** `job_details`

**Behavior:**
1. Fetches job products via `/jobs/{jobUid}`.
2. Creates a "Discount Details" button.
3. On click, renders an HTML modal with a `<table>` showing all line items with columns: `#`, `Product/Service`, `Location`, `Qty`, `Price`, `Discount`, `Total`.
4. Shows subtotal, total discount, and grand total in a summary row.
5. If no products, shows empty-state placeholder.

**HTML generation pattern:**
```javascript
const element = jobProducts.length > 0
  ? `<div>...<table>...${lineItems.map(li => `<tr>...</tr>`).join("")}...</table>...</div>`
  : `<div class="p-6 flex flex-col..."><img .../><h5>No Parts / Services</h5></div>`;
```

---

### F-07: Organization Sage ID Validation on Invoice Creation

**File:** `Weifield/index.js` — `navigateInvoiceNoSageID()`
**Page:** `invoice_new`

**Behavior:**
1. Triggered when the organization field changes on the invoice creation form.
2. Fetches the selected organization's data.
3. Checks if `"Sage Customer ID"` custom field is empty.
4. If empty, shows an error toast and force-navigates to the invoice list page.

```javascript
async function navigateInvoiceNoSageID(orgId) {
  const orgDetails = await window.zclient.get({ key: "organization", uid: orgId });
  const sageId = orgDetails.response.custom_fields.find(f => f.label === "Sage Customer ID");
  if (!sageId || sageId.value === "") {
    await createToast({ ...errorConfig });
    window.zclient.invoke("page.navigate", { page: "invoice_list", module: "invoice" });
  }
}
```

---

### F-08: Delivery Date Restriction on Dispatch Board

**File:** `Bullfrog_Spas/bullfrog_v3.js` — `createDateRestrictionsManager()`
**Pages:** dispatch_board, job_details (reschedule panel)

**Behavior:**
1. On `app.registered`, attaches `open` event listeners to `dispatch_board.job_reschedule` and `job_details.job_reschedule` instances.
2. When the reschedule panel opens, fetches job details.
3. Only applies restriction if `job_category.category_name === "delivery"` (case-insensitive).
4. Reads `"1st Available Delivery Date"` custom field.
5. Sets `instance.prop("start_date", { min: cfDate })` — disables dates before the minimum.
6. Also listens to `pre_event.dispatch_board.job_schedule_change`:
   - If new start date is before `"1st Available Delivery Date"`, shows error toast and calls `handle("pre_event.reject", ...)` to block the drag.

```javascript
["dispatch_board.job_reschedule", "job_details.job_reschedule"]
  .map(id => elemUtils.getInst(id))
  .forEach(inst => inst.on("open", (event) => handleInstOpen(inst, event)));

zc.on("pre_event.dispatch_board.job_schedule_change", ({ data }) => handleExtendTime(data));
```

---

### F-09: Assign Job To Me (Single)

**File:** `Bullfrog_Spas/bullfrog_v3.js` — `createBtnVisibMng` + `createInitBtns`
**Page:** `job_details`

**Behavior:**
1. Creates `"Assign To Me"` button on `job_details` with `className: "hidden"` (starts hidden).
2. On `stateChange` to `job_details`, checks `job.assigned_to` array.
3. If the logged-in `user_uid` is **not** in `assigned_to`, shows the button.
4. Button click: fetches user's first team, calls `PUT /jobs/{uid}/update` with `ASSIGN` action.
5. Shows success toast, hides button, refreshes page.

---

### F-10: Assign Job To Me (Bulk)

**File:** `Bullfrog_Spas/bullfrog_v3.js`
**Page:** `job_list`

**Behavior:**
1. Creates `"Assign To Me"` button in `BULK_ACTION` location on `job_list`.
2. Click event receives `{ uid: [array_of_job_uids] }`.
3. Fetches user's first team.
4. Calls `PUT /jobs/{uid}/update` for **each selected job** using `Promise.all()`.
5. Shows success toast and refreshes.

---

### F-11: Go To Dispatch Board Button

**File:** `Bullfrog_Spas/bullfrog_v3.js`
**Page:** `job_details`

**Behavior:**
1. Creates "Open Dispatch Board" button in breadcrumb.
2. On click, fetches job's `work_order_number`.
3. Navigates parent window: `window.parent.location.href = "${origin}/dispatch_board?work-order-number=${wn}"`.

---

### F-12: Timelog IFRAME Modal (Job)

**File:** `Exo/index.js` — `TimelogBtnEvents()`
**Page:** `job_details`

**Behavior:**
1. Creates "Add Timelog" button.
2. On click, opens an IFRAME modal pointing to `https://exo-timelog-summary.web.app`.
3. `hide_header: true`, `hide_footer: true` — frameless display.
4. Listens for `"initiate"` message from IFRAME → dispatches `init_data` with `{ jobDetails, token, baseUrl }`.
5. Listens for `"cancel"` → removes modal.
6. Listens for `"success"` → refreshes page and removes modal.

**Two-way IFRAME communication:**
```javascript
modalInstance.on("listen", async ({ type }) => {
  if (type === "initiate") {
    await modalInstance.dispatch({
      type: "init_data",
      content: JSON.stringify({ jobDetails, token: getToken(), baseUrl: getBaseURL() }),
    });
  } else if (type === "success") {
    refreshPage();
    modalInstance.invoke("ui.remove");
  }
});
```

---

### F-13: Timelog IFRAME Modal (Project)

**File:** `Exo/index.js` — `TimelogProjectBtnEvents()`
**Page:** `project_details`

**Behavior:** Same as F-12 but sends `projectDetails` instead of `jobDetails`. Listens for `"project-success"` instead of `"success"`.

---

### F-14: Bulk Service Task Assignment via IFRAME

**File:** `Alveole/index.js` — `JobListingPage()`
**Page:** `job_list` (BULK_ACTION)

**Behavior:**
1. Creates "Assign Service Tasks" button in BULK_ACTION on `job_list`.
2. On click, opens a full-screen IFRAME modal (`full_screen: true`) loading `https://static.zuperpro.com/Alveole_service_tasks.html`.
3. Passes `bearer` and `region` as URL query parameters.
4. After 1s delay, dispatches API credentials via `dispatch({ type: "API", content: JSON.stringify({ bearer, region }) })`.
5. When IFRAME sends `"success"`, dispatches `{ type: "getData", content: JSON.stringify({ job_uids, isBulkSelect, filter_rules }) }`.
6. When IFRAME sends `"close"`, removes modal and shows toast.
7. When IFRAME sends `"cancel"`, removes modal silently.

---

### F-15: Inspection Form Data Report

**File:** `Alveole/index.js` — `showClockShopTimesButton()`
**Page:** `report_list`

**Behavior:**
1. Creates "Inspection Form Data Report" button in breadcrumb.
2. On click, shows loading toast while fetching customers and users from a webhook.
3. Opens FORM modal with: `From Date` (DATE), `To Date` (DATE), `Pick a Customer` (SINGLE_ITEM), `Pick a User` (SINGLE_ITEM).
4. Listens to `changes` event to track selected customer/user.
5. On confirm: validates `from_date <= to_date`, then POSTs to report webhook with `{ from_date, to_date, customer_uid, user_uid, userEmail }`.
6. Shows "Report generated and sent to email" success toast.

---

### F-16: Smart Document Scan (Product List)

**File:** `MLS/index.js` — `ProductListing()`
**Page:** `product_list`

**Behavior:**
1. Creates "Smart Scan" button (icon: `robot`) in breadcrumb.
2. On click, opens XL IFRAME modal pointing to `https://mls-inventory.web.app/upload`.
3. No two-way communication — purely embeds the scan UI.

---

### F-17: Purchase Order Creation (from Products)

**File:** `MLS/index.js` — `createPOButton()`
**Pages:** `product_list` (BULK_ACTION), `product_details` (BREADCRUMB), `job_details` (BREADCRUMB)

**Behavior:**
1. Creates "Create PO" button at appropriate location per page.
2. Button hidden or conditionally shown based on job category (hidden for "purchase order" jobs).
3. On click, triggers PO creation workflow via webhook.

---

### F-18: Job Profitability View

**File:** `MLS/index.js` — `JobDetails()`
**Page:** `job_details`

**Behavior:**
1. Creates "View Profitability" button.
2. On click, opens a new browser tab at `https://static.zuperpro.com/Morris_Leving_&_Son_Job_Profitability.html?job={uid}&name={title}`.
3. Hidden for "purchase order" category jobs.

```javascript
profButtInst.on("click", () => {
  const redirectUrl = `https://static.zuperpro.com/...?job=${jobDetails.job_uid}&name=${jobDetails.job_title}`;
  window.open(redirectUrl, "_blank");
});
```

---

### F-19: Budget vs Actual (Project)

**File:** `MLS/index.js` — `ProjectDetails()`
**Page:** `project_details`

**Behavior:**
1. Fetches all associated jobs for the project.
2. Filters out "purchase order" category jobs.
3. Collects all `products` from remaining jobs.
4. Creates "Budget V/s Actuals" button.
5. Generates budget-vs-actual report from product line items tagged with `budget`, `labor`, `equipment`, `material`, `shop time` in their descriptions.
6. Renders comparison table in an HTML modal.

---

### F-20: Timesheet Punch In / Out / Break / Resume

**File:** `MLS/index.js` — entry_type_config
**Page:** `job_details`, `timesheet_list`

**Entry Types and Configuration:**

```javascript
const entry_type_config = {
  PUNCH_IN:    { id: "punch-in-btn",  icon: "clock-check", title: "Punch IN",    type_of_check: "CHECK_IN" },
  BREAK:       { id: "break-btn",     icon: "clock-pause", title: "Take Break",  type_of_check: "BREAK" },
  RESUME_WORK: { id: "resume-btn",    icon: "clock-play",  title: "Resume",      type_of_check: "RESUME_WORK" },
  PUNCH_OUT:   { id: "punch-out-btn", icon: "clock-up",    title: "Punch OUT",   type_of_check: "CHECK_OUT" },
}
```

Each button is registered once at `app.registered` for `job_details`. The `constructTimeSheetConfig` function builds button configs with the logged-in user's UID embedded.

---

### F-21: Timesheet Button Visibility State Machine

**File:** `MLS/index.js` — `buttonVisibilityMap`
**Page:** `job_details`

The visibility of timesheet buttons is controlled by the **last timesheet check type** for the current user. This is a state machine:

| Current State (`type_of_check`) | Punch IN | Punch OUT | Break | Resume |
|---|---|---|---|---|
| `CHECK_OUT` (clocked out) | **show** | hide | hide | hide |
| `CHECK_IN` (clocked in) | hide | **show** | **show** | hide |
| `RESUME_WORK` | hide | **show** | **show** | hide |
| `BREAK` (on break) | hide | hide | hide | **show** |

**Implementation:**
```javascript
const buttonVisibilityMap = {
  CHECK_OUT:   { "punch-in-btn": "show", "punch-out-btn": "hide", "resume-btn": "hide", "break-btn": "hide" },
  CHECK_IN:    { "punch-in-btn": "hide", "punch-out-btn": "show", "resume-btn": "hide", "break-btn": "show" },
  RESUME_WORK: { "punch-in-btn": "hide", "punch-out-btn": "show", "resume-btn": "hide", "break-btn": "show" },
  BREAK:       { "punch-in-btn": "hide", "punch-out-btn": "hide", "resume-btn": "show", "break-btn": "hide" },
};

// Apply visibility map
async function applyButtonVisibility(lastCheckType) {
  const visibilityConfig = buttonVisibilityMap[lastCheckType];
  for (const [btnId, action] of Object.entries(visibilityConfig)) {
    const existing = await window.zclient.isExist(btnId);
    if (existing?.uid) {
      const instance = window.zclient.instance(existing.uid);
      instance.invoke(action === "show" ? "ui.show" : "ui.hide");
    }
  }
}
```

---

### F-22: Clock-Shop Times Report (with Date Range & Filters)

**Files:** `MLS/index.js`, `Alveole/index.js`
**Pages:** `report_list`, `timesheet_list`

**Behavior:**
1. Creates download button in breadcrumb.
2. On click, fetches available customers and users from an options endpoint (webhook).
3. Shows loading toast during fetch.
4. Opens FORM modal with 4 fields: `From Date`, `To Date`, `Pick a Customer` (optional), `Pick a User` (optional).
5. Tracks selected values via modal `changes` event.
6. On confirm: validates date range (from ≤ to).
7. Maps selected customer/user names back to UIDs.
8. POSTs to report webhook with `{ from_date, to_date, customer_uid, user_uid, userEmail }`.
9. Shows success toast: "Report has been generated and sent to your mail".

---

### F-23: Standalone Booking Widget

**File:** `Central Home Systems/booking_widget.html`
**Technology:** Standalone HTML/CSS/JS (no SDK dependency)

**Features:**
- Service type selection: Installation | Repair Service | Planned Maintenance | Site Survey
- Datepicker (Bootstrap) for date selection
- Slot availability grid
- Customer info form: first_name, last_name, email, phone, description
- Address form: street, landmark, city, state, zipcode
- Job creation submission

**N8N Webhook Flows:**
1. `type=category_duration` — Fetch job duration for category
2. `type=assisted_schedule` — Fetch available time slots for selected date
3. `type=create_job` — Submit job creation with all form data

**State Management (jQuery):**
- `currentPage`: tracks wizard step (home → date-picker → time-slots → customer-form → success)
- `selectedCategory`: chosen service type
- `selectedDate`: Moment.js date string

---

### F-24: Color Information Lookup via Hollander #

**Files:** `Amway/index.js`, `awrs/index.js`
**Page:** `job_details`

**Behavior:**
1. Reads `"Hollander #"` custom field from the job.
2. POSTs to the color database webhook with the Hollander number.
3. Opens an HTML modal displaying color information (finish, code, description).

---

### F-25: Print Label Consolidation & Email

**File:** `Amway/index.js`
**Page:** `job_details`

**Behavior:**
1. Creates "Print Label" button.
2. Consolidates label data from job products.
3. POSTs to print label webhook.
4. Emails the label to the configured recipient.
5. Shows success/error toast.

---

### F-26: Budget vs Actual Report (Invoice Batch Sync)

**File:** `Amway/index.js`
**Page:** `invoice_details`

**Behavior:**
Batch synchronizes invoice data and generates a budget-vs-actual financial report. Calls internal Amway integration endpoint at `https://staging.zuperpro.com/service/integrations/app/amway_poc/run`.

---

### F-27: Service Task Dashboard with Image Gallery

**File:** `Amway/index.js`
**Page:** `job_details`

**Behavior:**
1. Fetches service tasks from `/service_tasks`.
2. For each task, fetches inspection form data from `/assets/inspection_form/{submissionId}`.
3. Renders dashboard in an HTML modal with image galleries and task status indicators.

---

### F-28: Dynamic Pricing Display Modal

**File:** `Amway/index.js`
**Page:** `job_details`, `estimate_details`

**Behavior:**
1. Listens to `estimate_new.line_items` or `estimate_new.price_list` changes.
2. Fetches current pricing data for the selected SKUs.
3. Opens an HTML modal displaying pricing breakdown, availability, and warehouse info.

---

### F-29: NetSuite Sync Retry (with Status Tracking)

**File:** `Amway/index.js`
**Page:** `invoice_details`

**Behavior:** Identical pattern to F-02 (Sage Resync) but uses `"NetSuite Invoice ID"` and `"Integration Error Message"` custom fields. Calls the NetSuite sync webhook with retry logic.

---

### F-30: Timesheet Report Button (Breadcrumb)

**File:** `Template/index.js`
**Page:** `timesheet_list`

**Behavior:**
1. On `app.registered`, creates "Timesheet Report" button in breadcrumb.
2. Uses deduplication pattern.
3. Button click handler is empty — to be implemented.
4. Serves as the canonical implementation template.

---

### F-31: Component Deduplication Pattern

**All files**

Used universally before creating any component on a page that re-renders on navigation:

```javascript
async function ensureFreshComponent(id, createFn) {
  const existing = await window.zclient.isExist(id);
  if (existing?.uid) {
    window.zclient.instance(existing.uid).invoke("ui.remove");
  }
  return await createFn();
}
```

---

### F-32: Structured Logging Utility

**File:** `Template/index.js`, `Exo/index.js`

```javascript
function createLog(functionName, message, page = "", level = "default", metadata = {}) {
  const logEntry = {
    level,
    message: `SDK: fn: ${functionName} : ${page ? "page: " + page : ""} - ${message}`,
    metadata,
  };
  switch (level.toLowerCase()) {
    case "info":  console.info(JSON.stringify(logEntry, null, 2)); break;
    case "warn":  console.warn(JSON.stringify(logEntry, null, 2)); break;
    case "error": console.error(JSON.stringify(logEntry, null, 2)); break;
    default:      console.log(JSON.stringify(logEntry, null, 2)); break;
  }
}

// Usage:
createLog("FunctionName", "Description of event", "page_name", "error", { extra: "data" });
```

---

### F-33: Business Hours Time Enforcement

See [F-05](#f-05-job-startend-time-auto-set-from-business-hours).

---

### F-34: Navigator URL Redirect (Dispatch Board Deep Link)

See [F-11](#f-11-go-to-dispatch-board-button).

---

### F-35: Commission Report Generator

**File:** `A-1 Concrete/index.js`
**Page:** `job_list`

**Behavior:**
1. Renders a "Commissioning Report" button (BREADCRUMB, left) on the `job_list` page.
2. On click, opens a FORM modal with two date fields: `from_date` and `to_date`.
3. Validates that `from_date` ≤ `to_date`; shows error toast if not.
4. On valid submission: closes modal, POSTs `{ from_date, to_date, userEmail, userName }` to the webhook.
5. Shows success toast: "Report has been generated and sent to your mail".
6. User email and name are read from `localStorage`.

**Config fields:** `webhookUrl`

```javascript
// Payload
{ from_date: "YYYY-MM-DD", to_date: "YYYY-MM-DD", userEmail, userName }
```

---

### F-36: Pool Chemistry Field Auto-Clear (LSI)

**File:** `AJ Pools/index.js`
**Page:** `job_new`

**Behavior:**
1. On `job_new` page load, waits 5 seconds for the form to fully initialize.
2. Clears 26 LSI (Langelier Saturation Index) custom fields to empty strings: Pool Volume, temperatures, pH, alkalinity, calcium, CYA, TDS, borate, chlorine, phosphate measurements (start/end), and related dosage calculation fields.
3. Also clears the "DEFAULT_LSI Calculator Link" field.
4. No buttons or modals — runs silently on page entry.

**Config fields:** None (field names are hardcoded)

---

### F-37: Multi-Account Switcher

**File:** `Brothergutters/index.js`
**Page:** `dashboard`

**Behavior:**
1. On the `dashboard` page, checks whether the current user's company is a parent or child company.
2. **Parent account:** Renders "Switch account" button. On click, opens a FORM modal (SINGLE_ITEM dropdown) listing all child companies. On selection, invokes `user.switch` SDK method.
3. **Child account:** Renders "Switch to Parent" button. On click, directly switches to the parent company via `user.switch`.
4. The current company is excluded from the dropdown list.

**Company config structure:**
```javascript
[
  { company_uid: "...", company_name: "...", parent: true },
  { company_uid: "...", company_name: "...", parent: false },
]
```

**Config fields:** `company_config` array (UIDs and names), credentials for `user.switch`

---

### F-38: Cancel & Clone Quote

**File:** `Clean Made/v3_index.js`
**Page:** `estimate_details`

**Behavior:**
1. Renders a "Cancel and Clone" button (BREADCRUMB, left) on `estimate_details`.
2. Button is hidden if estimate status is `CANCELED`.
3. On click, opens a confirmation DIALOG: "Are you sure you want to cancel and clone the quote?".
4. On confirm: shows a loading toast, POSTs `{ uid: estimate_id }` to the webhook.
5. On success: closes loading toast, shows success toast for 2 seconds, refreshes page, removes button.

**Config fields:** `webhookUrl`

```javascript
// Payload
{ uid: estimate_uid }
```

---

### F-39: Job Pictures Manager (Download & Review)

**File:** `Del Mar/v3_index.js`
**Page:** `job_details`

**Behavior — Download Button:**
1. "Download Job Pictures" button (BREADCRUMB). On click:
2. Fetches S3 image URLs from webhook with `{ job_uid }`.
3. Dynamically loads JSZip from CDN.
4. Downloads all images in parallel (`Promise.all`), adds to ZIP.
5. Triggers browser download as `{work_order_number}_{job_title}_images.zip`.

**Behavior — Review Button:**
1. "Review Job Pictures" button (BREADCRUMB). On click:
2. Opens IFRAME modal pointing to `https://static.zuperpro.com/delmar_add_note.html?job_uid={job_uid}`.
3. Allows inline picture review and note-taking.

**Config fields:** `webhookUrl` (for fetching image URLs), `iframeReviewUrl`

```javascript
// Download webhook payload
{ job_uid: "..." }
// Response: { imageUrls: ["https://s3.../img1.jpg", ...] }
```

---

### F-40: Assisted Scheduling via IFRAME

**File:** `ESI/index.js`
**Page:** `job_details`

**Behavior:**
1. Renders an "Assisted Schedule" button (BREADCRUMB) on `job_details`.
2. On click, opens an IFRAME modal pointing to an external scheduling app URL with `job_uid` as a query parameter.
3. The IFRAME allows the user to interactively assign and schedule jobs.
4. Uses `postMessage` / `instance.on("listen")` to receive confirmation from the IFRAME when scheduling is complete.

**Config fields:** `iframeUrl`

---

### F-41: Job Status Count Dashboard

**File:** `Evereve/index.js`
**Page:** `job_list`

**Behavior:**
1. Renders a button (BREADCRUMB) on `job_list` page.
2. On click, calls a webhook or internal API to fetch job counts grouped by status.
3. Displays counts for statuses: Open, Vendor Rejected, Vendor Scheduled, Completed, Started, Closed.
4. Shows results in an HTML modal as a summary dashboard table.

**Config fields:** `webhookUrl`

---

### F-42: Asset Report Download — Gillette Pepsi

**File:** `Gillette Pepsi/index.js`
**Page:** `asset_details`

See [F-48](#f-48-asset-report-download-xlsx) — identical implementation with a different webhook URL.

---

### F-43: QBD Accounting Report Generation

**File:** `JWC/index.js` (report feature) / `Interior Care/index.js`
**Page:** `report_list`

**Behavior:**
1. Renders a "Generate QBD report (csv)" button (BREADCRUMB) on `report_list`.
2. On click, opens a FORM modal with:
   - `from_date` (DATE, required)
   - `to_date` (DATE, required)
   - `search_type` (SINGLE_ITEM: "Schedule Date" | "Created At")
3. Validates `from_date` ≤ `to_date`. Shows error toast if invalid.
4. On valid submit: Makes GET request to webhook with query params `from_date`, `to_date`, `search_type`, `userEmail`.
5. If response status is 200: downloads an `.iif` file (`QBD Report {from_date} to {to_date}.iif`).
6. If non-200: shows success toast indicating report will be emailed.

**Search type mapping:**
```javascript
{ "Schedule Date": "scheduled_date_range", "Created At": "created_at" }
```

**Config fields:** `webhookUrl`

---

### F-44: Job Profitability Chart (Webhook HTML)

**File:** `JWC/index.js`
**Page:** `job_details`

**Behavior:**
1. Renders a "Show Job Profitability" button (BREADCRUMB) on `job_details`.
2. On click, makes a GET request to a webhook with `jobUid` as a query parameter.
3. Extracts `response.body.html` from the response.
4. Opens an XL HTML modal and injects the returned HTML (chart/dashboard content) into it.

**Config fields:** `webhookUrl` (GET `?jobUid={uid}`)

---

### F-45: Job Template Manager

**File:** `Maven/index.js`
**Page:** `job_details`

**Behavior:**
1. Renders a "Template" button (BREADCRUMB) on `job_details`.
2. On click:
   - Validates the job has an organization; shows warning toast if not.
   - Shows "Fetching Templates" loading toast.
   - POSTs `{ organization, job_category }` to webhook; receives array of `{ templateName, typeOfWork }`.
3. **Smart matching:**
   - 0 templates → error toast.
   - 1 template → auto-applies without modal.
   - Multiple templates → opens FORM modal (SINGLE_ITEM dropdown) for user to select.
   - If "Type of Work" custom field is already set → auto-matches and updates without modal.
4. On selection: PUTs to internal API updating the job's `Template` and `Type of Work` custom fields while preserving all other custom fields.
5. Shows success toast, refreshes page.

**Config fields:** `fetchTemplatesWebhookUrl`, `internalApiUrl`, `apiKey`

---

### F-46: Timesheet Report with Date Range Validation

**File:** `Netfor/index.js`
**Page:** `timesheet_list`

**Behavior:**
1. Renders a "Timesheet Report" button (BREADCRUMB, left) on `timesheet_list`.
2. On click, opens a FORM modal with `start_date` and `end_date` (both DATE, required).
3. Validates:
   - `start_date` ≤ `end_date` — error toast if violated.
   - Date range ≤ 7 days — error toast if exceeded.
4. On valid submit: closes modal, makes GET request to webhook with `{ start_date, end_date, email }`.
5. Shows success toast: "Report generation initiated and will be sent to mail: {email}".
6. User email is read from `localStorage`.

**Config fields:** `webhookUrl`

---

### F-47: Products Report Download (XLSX)

**File:** `New England Waterproofing/v3_index.js`
**Page:** `product_list`

**Behavior:**
1. Renders a "Download Products Report" button (BREADCRUMB, left) on `product_list`.
2. On click, makes a GET request to a webhook.
3. Receives an XLSX blob response.
4. Triggers browser download as `Products_transaction_report.xlsx`.
5. No modal — direct download on button click.

**Config fields:** `webhookUrl`, `downloadFilename`

---

### F-48: Asset Report Download (XLSX)

**File:** `SPTech Helical Piers/index.js`, `Wesgroup/index.js`
**Page:** `asset_details`

**Behavior:**
1. Renders a "Save Asset Report" button (BREADCRUMB, left) on `asset_details`.
2. On page load, fetches asset details via internal API (`/assets/{assetUid}`) to get `asset_name`, `asset_uid`, `asset_code`.
3. On button click: POSTs `{ asset_uid }` to webhook.
4. Receives XLSX blob response.
5. Triggers browser download as `Asset_{asset_code}_{asset_name}_report.xlsx`.
6. Removes existing button instance before creating a new one on each page visit.

**Config fields:** `webhookUrl`

---

## 11. Configuration & Environment Management

### 11.1 Dual Environment Config Pattern

All implementations with external API calls use an environment configuration object:

```javascript
const API_CONFIG = {
  staging: {
    webhookUrl: "https://internalwf.zuper.co/webhook/STAGING-UUID",
    otherUrl: "...",
  },
  live: {
    webhookUrl: "https://internalwf.zuper.co/webhook/LIVE-UUID",
    otherUrl: "...",
  },
};

const env = "live"; // Switch between "staging" and "live"
const ENV_VARS = API_CONFIG[env];
```

**Note:** Some implementations (e.g., Weifield) use the same webhook URLs for both staging and live environments.

### 11.2 GLOBAL_VARS Pattern (Template/Exo)

```javascript
const GLOBAL_VARS = {
  live: {
    WEBHOOKS: {
      timesheet_report: { url: "", method: "GET" },
    },
  },
  staging: {},
  // Non-environment keys at top level:
  timelog_summary_page_url: "https://exo-timelog-summary.web.app",
};

const env = "live";
const ENV_VARS = GLOBAL_VARS[env];
```

### 11.3 Webhook URL Patterns

| Pattern | Usage |
|---|---|
| `https://internalwf.zuper.co/webhook/{UUID}` | Zuper internal n8n webhook flows |
| `https://staging.zuperpro.com/service/integrations/app/{appName}/run` | Zuper staging integration endpoint |
| `https://static.zuperpro.com/{filename}.html` | Statically hosted IFRAME UIs |
| `https://{appname}.web.app/{path}` | Firebase-hosted IFRAME apps |

---

## 12. Utility Functions

### 12.1 `genUUID()` — Timestamp-Based Unique ID

Used to ensure unique component IDs when creating multiple instances of the same component type:

```javascript
function genUUID() {
  const timestamp = Date.now().toString();
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  return (timestamp + randomSuffix).substring(0, 15);
}

// Usage:
const modalConfig = { id: "modal-" + genUUID(), ... };
```

### 12.2 `wait(ms)` / `delay(ms)` — Promise Delay

```javascript
async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Usage: wait before reading form data (to let form initialize)
await wait(1000);
const formData = await zclient.get("job_new.form");
```

### 12.3 `setTime(oldDate, newDate, timeString)` — UTC Date Time Setter

Sets the time portion of a date only if the **date part** has changed:

```javascript
function setTime(oldDate, newDate, timeString) {
  const [hours, minutes, seconds] = timeString.split(":").map(Number);
  if (!oldDate ||
      oldDate.getUTCFullYear() !== newDate.getUTCFullYear() ||
      oldDate.getUTCMonth()    !== newDate.getUTCMonth()    ||
      oldDate.getUTCDate()     !== newDate.getUTCDate()) {
    return new Date(Date.UTC(
      newDate.getUTCFullYear(), newDate.getUTCMonth(), newDate.getUTCDate(),
      hours, minutes, seconds
    ));
  }
  return null;
}
```

### 12.4 `getToken()` — Bearer Token from LocalStorage

```javascript
function getToken() {
  const authToken = localStorage.getItem("auth_token");
  return `Bearer ${authToken}`;
}
```

### 12.5 `getBaseURL()` — API Base URL from LocalStorage

```javascript
function getBaseURL() {
  return localStorage.getItem("dc_api_url");
}
```

### 12.6 `getUserTeams(userUid)` — Fetch User Teams

```javascript
async function getUserTeams(userUid) {
  const response = await window.zclient.request({
    url: `/user/${userUid}/teams`,
    type: "GET",
    cors: false,
    contentType: "application/json",
    externalRequest: false,
  });
  return response?.body?.data ?? [];
}
```

### 12.7 `getJobDetails(jobUid)` — Fetch Job by UID

```javascript
async function getJobDetails(jobUid) {
  const response = await window.zclient.request({
    url: `/jobs/${jobUid}`,
    type: "GET",
    cors: false,
    contentType: "application/json",
    externalRequest: false,
  });
  return response?.body?.data;
}
```

---

## 13. Cross-Cutting Concerns

### 13.1 Error Handling

All async operations are wrapped in try/catch. Errors surface via:
1. Toast notifications for user-visible errors.
2. `console.error()`/`createLog(..., "error")` for debugging.
3. Early returns (`if (!success) return;`) to prevent cascading failures.

**Pattern:**
```javascript
async function SomeFeature() {
  try {
    const { success, data } = await createButton(config);
    if (!success) return;
    data.on("click", async () => {
      try {
        // async operation
        await createToast({ ...successConfig });
      } catch (err) {
        await createToast({ ...errorConfig });
      }
    });
  } catch (error) {
    createLog("SomeFeature", "SDK Failed", "page_name", "error");
  }
}
```

### 13.2 Authentication

Extensions do not perform their own authentication. They rely on:
- The SDK's automatic auth injection for internal API calls (`externalRequest: false`).
- `localStorage.getItem("auth_token")` for passing tokens to external services and IFRAME UIs.

### 13.3 Multi-Instance Safety

When the same page is visited multiple times in a session, `stateChange` fires each time. Without deduplication, components accumulate. The `isExist` → `remove` → `create` pattern (Section 2.4) prevents this.

### 13.4 Async Race Conditions

Some implementations use `await wait(1000)` before reading form data on creation pages. This is required because the platform's form initialization is asynchronous and the form fields may not be populated immediately after `stateChange`.

### 13.5 Concurrent API Calls

For fetching multiple independent entities, use `Promise.all()`:

```javascript
const jobDetailsResults = await Promise.all(
  associated_job_uids.map(uid => getJobDetails(uid))
);
```

---

## 14. Client Implementation Reference

| Client | File | Lines | Key Features |
|---|---|---|---|
| **Template** | `Template/index.js` | 153 | Canonical template, structured logging, deduplication, timesheet report button skeleton |
| **Weifield** | `Weifield/index.js` | 807 | Invoice approval, Sage resync, prefix auto-set, business hours, discount details, Org validation |
| **Bullfrog_Spas** | `Bullfrog_Spas/bullfrog_v3.js` | 416 | Factory pattern, delivery date restrictions, assign-to-me (single + bulk), dispatch board navigation |
| **Exo** | `Exo/index.js` | 380 | IFRAME timelog modal (job + project), two-way postMessage communication |
| **Alveole** | `Alveole/index.js` | 516 | Bulk service task IFRAME, inspection form report, date-range modal with customer/user filters |
| **MLS** | `MLS/index.js` | 1,177 | Smart document scan, PO creation, profitability view, budget vs actual, timesheet state machine |
| **awrs** | `awrs/index.js` | 1,432 | Color information lookup, bulk service task distribution, report generation with filters |
| **Amway** | `Amway/index.js` | 4,109 | Enterprise: color DB, print labels, pricing modal, service task gallery, budget reporting, NetSuite sync, timesheet |
| **Interior Care** | `Interior Care/index.js` | 2,711 | Material allocation, service intervals, PO creation, clock-shop times, timesheet management |
| **Central Home Systems** | `Central Home Systems/booking_widget.html` | 563 | Standalone booking wizard (no SDK), n8n webhook integration, slot picker, job creation form |

---

## 15. End-to-End Workflow Examples

### 15.1 Basic Button-to-Modal-to-API Workflow

```javascript
window.zclient = window.ZClient.init();

window.zclient.on("app.registered", async function() {
  window.zclient.on("stateChange", async ({ page, id }) => {
    if (page === "job_details") await JobDetails(id);
  });
});

async function JobDetails(jobUid) {
  // 1. Deduplication
  const existing = await window.zclient.isExist("my-action-btn");
  if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");

  // 2. Create button
  const { success, data: btn } = await createButton({
    id: "my-action-btn",
    type: "BUTTON",
    title: "Do Action",
    page: "job_details",
    location: "BREADCRUMB",
  });
  if (!success) return;

  // 3. Button click: open FORM modal
  btn.on("click", async () => {
    const { success, data: modal } = await createModal({
      id: "my-action-modal",
      type: "MODAL",
      options: {
        title: "Confirm Action",
        dataType: "FORM",
        size: "md",
        fields: [{ label: "Reason", type: "TEXT", id: "reason", field_options: { is_required: true } }],
        actions: { confirm: { label: "Submit" }, cancel: {} },
      },
    });
    if (!success) return;
    modal.invoke("ui.open");

    // 4. Modal confirm: show loader, call API, show result
    modal.on("confirm", async (formData) => {
      const loader = await createToast({
        id: "action-loader",
        type: "TOAST",
        message: "Processing...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      });

      try {
        await window.zclient.request({
          url: "https://internalwf.zuper.co/webhook/YOUR-UUID",
          type: "POST",
          contentType: "application/json",
          externalRequest: true,
          data: { job_uid: jobUid, reason: formData.reason },
        });
        loader.data?.invoke("ui.close");
        await createToast({
          id: "action-success",
          type: "TOAST",
          message: "Action completed!",
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true },
        });
        await window.zclient.invoke("page.refresh");
      } catch (err) {
        loader.data?.invoke("ui.close");
        await createToast({
          id: "action-error",
          type: "TOAST",
          message: "Action failed: " + err.message,
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true },
        });
      }
    });
  });
}
```

### 15.2 Delivery Date Restriction — Full Flow

```
User opens reschedule panel on dispatch board
  → dispatch_board.job_reschedule.open fires
  → Fetch job details by job_uid
  → Check job_category === "delivery"
  → Read "1st Available Delivery Date" custom field
  → Call instance.prop("start_date", { min: cfDate })
  → Date picker now blocks dates before min

User drags job to before min date on dispatch board
  → pre_event.dispatch_board.job_schedule_change fires
  → newValue.startDate < firstAvailableDate?
      YES → showToast("error", "First available date is MM/DD/YYYY")
          → zclient.handle("pre_event.reject", { field: "dispatch_board.job_schedule_change" })
          → Drag is cancelled
      NO  → Allow default behavior (no action needed)
```

### 15.3 IFRAME Two-Way Communication Flow

```
SDK creates IFRAME modal → ui.open
  → IFRAME loads in modal
  → IFRAME sends postMessage: { type: "initiate" }
  → SDK receives via modalInstance.on("listen", { type: "initiate" })
  → SDK sends: modalInstance.dispatch({ type: "init_data", content: JSON.stringify(data) })
  → IFRAME receives, renders UI

User completes action in IFRAME
  → IFRAME sends postMessage: { type: "success" }
  → SDK receives via modalInstance.on("listen", { type: "success" })
  → SDK: zclient.invoke("page.refresh")
  → SDK: modalInstance.invoke("ui.remove")
```

### 15.4 Org Validation on Invoice Creation — Full Flow

```
User opens invoice_new page
  → InvoiceNew() called on stateChange
  → Register invoice_new.organization listener
  → Wait 1000ms (form init delay)
  → Read current organization from form: zclient.get("invoice_new.form")
  → If orgId exists, call navigateInvoiceNoSageID(orgId)

User selects/changes organization
  → invoice_new.organization event fires
  → navigateInvoiceNoSageID(newValue.organization_uid)
      → zclient.get({ key: "organization", uid: orgId })
      → Find "Sage Customer ID" custom field
      → If empty:
          → showToast("error", "Invalid Organization, Kindly check Sage Customer ID")
          → zclient.invoke("page.navigate", { page: "invoice_list", module: "invoice" })
      → If present: allow form to continue
```

---

## 16. Booking Widget (Standalone)

**File:** `Central Home Systems/booking_widget.html`

This is a self-contained HTML file that does **not** use the ZuperPro SDK. It is embedded as an external web page.

### 16.1 Technology Stack

- **jQuery** — DOM manipulation
- **Axios** — HTTP requests
- **Moment.js** — Date formatting
- **Bootstrap Datepicker** — Calendar widget
- **Tailwind CSS** (CDN) — Utility styling

### 16.2 State Machine

| State (page) | Description |
|---|---|
| `home` | Service type selection (4 options) |
| `date-picker` | Calendar for date selection + datepicker init |
| `time-slots` | Available time slots grid |
| `customer-form` | Customer and address info form |
| `success` | Confirmation screen |

### 16.3 Webhook Endpoints (all POST to same URL)

```javascript
const N8N_WEBHOOK_URL = "https://internalwf.zuper.co/webhook/2463094c-f5a5-426c-b5de-413afa199a83";

// Request 1: Get duration for category
{ type: "category_duration", category_uid: "..." }

// Request 2: Get available slots
{ type: "assisted_schedule", category_uid: "...", date: "YYYY-MM-DD", duration: N }

// Request 3: Create job
{
  type: "create_job",
  category_uid: "...",
  slot_start: "...", slot_end: "...",
  first_name, last_name, email, phone, description,
  street, landmark, city, state, zipcode
}
```

### 16.4 Category to UID Mapping

```javascript
const CATEGORY_UIDS = {
  "Installation":        "uid-1",
  "Repair Service":      "uid-2",
  "Planned Maintenance": "uid-3",
  "Site Survey":         "uid-4",
};
```

---

## 17. Known Patterns & Anti-Patterns

### 17.1 Best Practices (from production code)

| Practice | Description | Example |
|---|---|---|
| Deduplication | Always `isExist` + `remove` before creating page-scoped components | All files |
| Double-check guard | Re-fetch data inside button click handlers to prevent stale state | Weifield `resync-button` |
| Loading toast | Show spinner before async ops, dismiss after | MLS, Alveole |
| Factory pattern | Encapsulate related functions in factory closures for testability | Bullfrog_Spas |
| Error boundary | Wrap every async function in try/catch | All files |
| Environment config | Separate staging/live URLs in one config object | All files |
| Structured logging | Use `createLog` with function name, page, level | Template, Exo |
| Concurrent fetch | Use `Promise.all` for independent async requests | MLS `fetchJobDetailsConcurrent` |

### 17.2 Common Pitfalls

| Pitfall | Problem | Solution |
|---|---|---|
| Missing `await wait(1000)` on `*_new` pages | Form not initialized when `get("job_new.form")` is called | Add 1s delay before reading form state |
| Not deduplicating components | Buttons multiply on repeated page visits | Always check `isExist` before creating |
| Stale click handler state | Handler closes over old data from page load | Re-fetch inside handler |
| Forgetting `externalRequest: true` | Internal proxy tries to route absolute URLs as relative | Set `externalRequest: true` for all absolute URLs |
| IFRAME communication without ready event | `dispatch` before IFRAME is ready | Wait for `"initiate"` message type from IFRAME |
| Using `uid` from stateChange vs `get()` | `stateChange.id` is the entity UID; `zclient.get("job")` is more reliable for full data | Use `stateChange.id` for quick UID, `get("job")` for full data |

---

*Document generated from analysis of 37 files across 32 client implementations in `/home/gokulkrishnavs/C/ps-custom-ui/v3`. Total features documented: 48 (F-01 – F-48).*
*Last analyzed: 2026-03-19*
