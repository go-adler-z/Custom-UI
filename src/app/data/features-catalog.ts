export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'url' | 'textarea';
  placeholder?: string;
  default?: string;
  hint?: string;
}

export interface Feature {
  id: string;
  label: string;
  description: string;
  /** stateChange page IDs where this feature's main fn is called */
  pages: string[];
  /** function name called inside stateChange handler */
  fnName: string;
  /** if set, this fn is also called once inside app.registered */
  initFnName?: string;
  requiredConfig: ConfigField[];
  codeBlock: (cfg: Record<string, string>) => string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: indent a multi-line string by N spaces
// ─────────────────────────────────────────────────────────────────────────────
type Cfg = Record<string, string>;
const val = (cfg: Cfg, key: string, fallback = '') => cfg[key]?.trim() || fallback;

// ─────────────────────────────────────────────────────────────────────────────
export const FEATURES: Feature[] = [

  // ── INVOICE FEATURES ───────────────────────────────────────────────────────

  {
    id: 'F-01',
    label: 'Invoice Approval Workflow',
    description:
      'Adds an Approve / Reject button on the invoice details page. '
      + 'Visible only when the logged-in user belongs to the team named in a '
      + 'configurable custom field.',
    pages: ['invoice_details'],
    fnName: 'featureInvoiceApproval',
    requiredConfig: [
      {
        key: 'invoiceApprovalWebhook',
        label: 'Approval Webhook URL',
        type: 'url',
        placeholder: 'https://internalwf.zuper.co/webhook/...',
        hint: 'POST receives { invoice_uid, user_uid, type: "approve"|"reject" }',
      },
      {
        key: 'awaitingFieldLabel',
        label: 'Custom Field Label — Awaiting Response',
        type: 'text',
        default: 'Awaiting response for',
        placeholder: 'Awaiting response for',
      },
    ],
    codeBlock: (cfg) => `
async function featureInvoiceApproval(stateChangeData) {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    if (!user.user_uid) return;
    const userTeams = await getUserTeams(user.user_uid);
    const invoiceResp = await window.zclient.get("invoice");
    if (!invoiceResp.success) return;
    const invoice = invoiceResp.response;
    const awaitingFor =
      invoice.custom_fields?.find(x => x.label === "${val(cfg, 'awaitingFieldLabel', 'Awaiting response for')}")
        ?.value ?? "";
    if (!awaitingFor || awaitingFor === "None") return;
    if (!userTeams.some(t => t.team_name.includes(awaitingFor))) return;

    const { success, data: btn } = await createButton({
      id: "btn-invoice-approve",
      type: "BUTTON",
      title: "Approve / Reject",
      page: "invoice_details",
      location: "BREADCRUMB",
    });
    if (!success) return;

    btn.on("click", async () => {
      const { success: ms, data: modal } = await createModal({
        id: "modal-invoice-approve-" + genUUID(),
        type: "MODAL",
        options: {
          title: "Approve or Reject Invoice",
          position: "center",
          dataType: "FORM",
          size: "md",
          fields: [{
            label: "Decision",
            type: "SINGLE_ITEM",
            id: "decision",
            default: "",
            values: ["Approve", "Reject"],
            field_options: { is_required: true },
          }],
          actions: { confirm: { label: "Confirm" }, cancel: {} },
        },
      });
      if (!ms) return;
      modal.invoke("ui.open");
      modal.on("confirm", async (data) => {
        const type = data.decision === "Approve" ? "approve" : "reject";
        try {
          await window.zclient.request({
            url: "${val(cfg, 'invoiceApprovalWebhook')}",
            type: "POST",
            contentType: "application/json",
            cors: false,
            externalRequest: true,
            data: { invoice_uid: invoice.invoice_uid, user_uid: user.user_uid, type },
          });
          await createToast({ id: "toast-approval-" + genUUID(), type: "TOAST",
            message: "Invoice " + (type === "approve" ? "approved" : "rejected") + " successfully",
            options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
          window.zclient.invoke("page.refresh");
        } catch (e) {
          await createToast({ id: "toast-approval-err", type: "TOAST",
            message: "Error processing approval",
            options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
        }
      });
    });
  } catch (e) {
    createLog("featureInvoiceApproval", "Failed", "invoice_details", "error");
  }
}`,
  },

  {
    id: 'F-02',
    label: 'Invoice Accounting Resync',
    description:
      'Shows a Resync button on invoice details when the sync status field is not '
      + '"success". Calls a webhook to retry the sync, then refreshes the page.',
    pages: ['invoice_details'],
    fnName: 'featureSageResync',
    requiredConfig: [
      {
        key: 'sageResyncWebhook',
        label: 'Resync Webhook URL',
        type: 'url',
        placeholder: 'https://internalwf.zuper.co/webhook/...',
        hint: 'POST receives { invoice_uid, triggered_by: user_uid }',
      },
      {
        key: 'sageSyncStatusField',
        label: 'Sync Status Custom Field Label',
        type: 'text',
        default: 'Sage Invoice Sync Status',
        placeholder: 'Sage Invoice Sync Status',
      },
    ],
    codeBlock: (cfg) => `
async function featureSageResync(stateChangeData) {
  try {
    const invoiceResp = await window.zclient.get("invoice");
    if (!invoiceResp.success) return;
    const invoice = invoiceResp.response;
    const fieldLabel = "${val(cfg, 'sageSyncStatusField', 'Sage Invoice Sync Status')}";
    const syncStatus = invoice.custom_fields?.find(cf => cf.label === fieldLabel)?.value || "";
    if (!syncStatus || syncStatus === "success") return;

    const { success, data: btn } = await createButton({
      id: "btn-sage-resync",
      icon: "sync",
      type: "BUTTON",
      title: "Resync Invoice",
      page: "invoice_details",
      location: "BREADCRUMB",
    });
    if (!success) return;

    btn.on("click", async () => {
      const freshResp = await window.zclient.get("invoice");
      const userResp  = await window.zclient.get("user");
      if (!freshResp.success || !userResp.success) return;
      const freshStatus = freshResp.response.custom_fields
        ?.find(cf => cf.label === fieldLabel)?.value || "";

      if (freshStatus === "In Progress") {
        await createToast({ id: "toast-resync-progress", type: "TOAST",
          message: "Sync already in progress",
          options: { autoClose: true, position: "top-center", type: "info", dismissible: true } });
        return;
      }
      if (freshStatus === "success") {
        await createToast({ id: "toast-resync-done", type: "TOAST",
          message: "Invoice already synced",
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
        return;
      }
      await window.zclient.request({
        url: "${val(cfg, 'sageResyncWebhook')}",
        type: "POST",
        contentType: "application/json",
        cors: false,
        externalRequest: true,
        data: JSON.stringify({ invoice_uid: freshResp.response.invoice_uid, triggered_by: userResp.response.user_uid }),
      });
      await createToast({ id: "toast-resync-ok", type: "TOAST",
        message: "Resync initiated",
        options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
      window.zclient.invoke("page.refresh", "invoice_details");
    });
  } catch (e) {
    createLog("featureSageResync", "Failed", "invoice_details", "error");
  }
}`,
  },

  {
    id: 'F-03',
    label: 'Invoice Number Prefix by State',
    description:
      'Automatically sets the invoice number prefix when the service address state '
      + 'changes on the new invoice form. Provide state→prefix pairs as JSON.',
    pages: ['invoice_new'],
    fnName: 'featureInvoicePrefixByState',
    requiredConfig: [
      {
        key: 'statePrefixMap',
        label: 'State → Prefix Map (JSON)',
        type: 'textarea',
        default: '{"colorado":"RM10","texas":"TX10","tennessee":"TN10"}',
        placeholder: '{"colorado":"RM10","texas":"TX10"}',
        hint: 'Keys are lowercase state names, values are prefix strings.',
      },
    ],
    codeBlock: (cfg) => `
async function featureInvoicePrefixByState(stateChangeData) {
  try {
    const statePrefixMap = ${val(cfg, 'statePrefixMap', '{}')};
    const applyPrefix = async (state) => {
      if (!state) return;
      const key = state.trim().toLowerCase();
      if (statePrefixMap[key]) {
        await window.zclient.set("invoice_new.prefix", statePrefixMap[key]);
      }
    };
    window.zclient.on("invoice_new.service_address", async (event) => {
      applyPrefix(event?.data?.newValue?.state);
    });
    await wait(1000);
    const form = await window.zclient.get("invoice_new.form");
    applyPrefix(form?.response?.serviceAddress?.state);
  } catch (e) {
    createLog("featureInvoicePrefixByState", "Failed", "invoice_new", "error");
  }
}`,
  },

  {
    id: 'F-07',
    label: 'Organisation Accounting ID Validation',
    description:
      'On the new invoice form, checks that the selected organisation has a valid '
      + 'accounting ID in a custom field. If missing, shows an error and redirects '
      + 'back to the invoice list.',
    pages: ['invoice_new'],
    fnName: 'featureOrgAccountingIdValidation',
    requiredConfig: [
      {
        key: 'accountingIdField',
        label: 'Accounting ID Custom Field Label',
        type: 'text',
        default: 'Sage Customer ID',
        placeholder: 'Sage Customer ID',
      },
    ],
    codeBlock: (cfg) => `
async function featureOrgAccountingIdValidation(stateChangeData) {
  const fieldLabel = "${val(cfg, 'accountingIdField', 'Sage Customer ID')}";
  const validate = async (orgUid) => {
    if (!orgUid) return;
    const orgResp = await window.zclient.get({ key: "organization", uid: orgUid });
    if (!orgResp.success) return;
    const field = orgResp.response.custom_fields?.find(f => f.label === fieldLabel);
    if (!field || !field.value?.trim()) {
      await createToast({ id: "toast-org-invalid", type: "TOAST",
        message: "Organisation is missing a valid " + fieldLabel + ". Invoice creation blocked.",
        options: { autoClose: false, position: "top-center", type: "error", dismissible: true } });
      window.zclient.invoke("page.navigate", { page: "invoice_list", module: "invoice" });
    }
  };
  window.zclient.on("invoice_new.organization", async (event) => {
    validate(event?.data?.newValue?.organization_uid);
  });
  await wait(1000);
  const form = await window.zclient.get("invoice_new.form");
  validate(form?.response?.organization);
}`,
  },

  // ── JOB FEATURES ──────────────────────────────────────────────────────────

  {
    id: 'F-04',
    label: 'Job Number Prefix by State',
    description:
      'Automatically sets the job number prefix when the service address state '
      + 'changes on the new job form.',
    pages: ['job_new'],
    fnName: 'featureJobPrefixByState',
    requiredConfig: [
      {
        key: 'jobStatePrefixMap',
        label: 'State → Prefix Map (JSON)',
        type: 'textarea',
        default: '{"colorado":"RM10","texas":"TX10","tennessee":"TN10"}',
        placeholder: '{"colorado":"RM10","texas":"TX10"}',
        hint: 'Keys are lowercase state names, values are prefix strings.',
      },
    ],
    codeBlock: (cfg) => `
async function featureJobPrefixByState(stateChangeData) {
  try {
    const statePrefixMap = ${val(cfg, 'jobStatePrefixMap', '{}')};
    const applyPrefix = async (state) => {
      if (!state) return;
      const key = state.trim().toLowerCase();
      if (statePrefixMap[key]) {
        await window.zclient.set("job_new.prefix", statePrefixMap[key]);
      }
    };
    window.zclient.on("job_new.service_address", async (event) => {
      applyPrefix(event?.data?.newValue?.state);
    });
    await wait(1000);
    const form = await window.zclient.get("job_new.form");
    applyPrefix(form?.response?.serviceAddress?.state);
  } catch (e) {
    createLog("featureJobPrefixByState", "Failed", "job_new", "error");
  }
}`,
  },

  {
    id: 'F-05',
    label: 'Business Hours Time Enforcement',
    description:
      'On the new job form, auto-sets the start/end time to the company\'s configured '
      + 'business hours whenever the user picks a new date.',
    pages: ['job_new'],
    fnName: 'featureBusinessHours',
    requiredConfig: [],
    codeBlock: () => `
async function featureBusinessHours(stateChangeData) {
  try {
    const configResp = await window.zclient.request({
      url: "/api/company/config",
      type: "GET",
      externalRequest: false,
    });
    const businessHours = configResp?.body?.data?.business_hours;
    if (!businessHours) return;

    const applyTime = (oldDate, newDate, timeStr) => {
      if (!timeStr || !newDate) return null;
      const [h, m, s] = timeStr.split(":").map(Number);
      if (oldDate &&
          oldDate.getUTCFullYear() === newDate.getUTCFullYear() &&
          oldDate.getUTCMonth()    === newDate.getUTCMonth()    &&
          oldDate.getUTCDate()     === newDate.getUTCDate()) return null;
      return new Date(Date.UTC(newDate.getUTCFullYear(), newDate.getUTCMonth(),
        newDate.getUTCDate(), h, m, s || 0));
    };

    window.zclient.on("job_new.startDate", async (event) => {
      const { newValue, oldValue } = event.data || {};
      const updated = applyTime(oldValue?.startDate, newValue?.startDate, businessHours.start_time);
      if (updated) await window.zclient.set("job_new.startDate", updated);
    });

    window.zclient.on("job_new.endDate", async (event) => {
      const { newValue, oldValue } = event.data || {};
      const updated = applyTime(oldValue?.endDate, newValue?.endDate, businessHours.end_time);
      if (updated) await window.zclient.set("job_new.endDate", updated);
    });
  } catch (e) {
    createLog("featureBusinessHours", "Failed", "job_new", "error");
  }
}`,
  },

  {
    id: 'F-06',
    label: 'Discount Details Modal',
    description:
      'Adds a "Discount Details" button on job details that opens an HTML table '
      + 'showing all line items with their individual discounts and totals.',
    pages: ['job_details'],
    fnName: 'featureDiscountDetails',
    requiredConfig: [],
    codeBlock: () => `
async function featureDiscountDetails(stateChangeData) {
  try {
    const { id: jobUid } = stateChangeData;
    if (!jobUid) return;
    const job = await getJobDetails(jobUid);
    if (!job) return;
    const products = job.products || [];

    const { success, data: btn } = await createButton({
      id: "btn-discount-details",
      type: "BUTTON",
      title: "Discount Details",
      page: "job_details",
      location: "BREADCRUMB",
    });
    if (!success) return;

    btn.on("click", async () => {
      const rows = products.map((p, i) =>
        "<tr>" +
        "<td>" + (i + 1) + "</td>" +
        "<td>" + (p.product_name || "") + "</td>" +
        "<td>" + (p.quantity || 0) + " " + (p.uom || "") + "</td>" +
        "<td>$" + (p.price || 0).toFixed(2) + "</td>" +
        "<td>$" + (p.discount || 0).toFixed(2) + "</td>" +
        "<td>$" + (p.total || 0).toFixed(2) + "</td>" +
        "</tr>"
      ).join("");
      const totalDiscount = products.reduce((s, p) => s + (p.discount || 0), 0);
      const grandTotal    = products.reduce((s, p) => s + (p.total || 0), 0);
      const html = products.length
        ? "<table style='width:100%;border-collapse:collapse'>" +
          "<thead><tr style='background:#f3f4f6'>" +
          "<th>#</th><th>Product</th><th>Qty</th><th>Price</th><th>Discount</th><th>Total</th>" +
          "</tr></thead><tbody>" + rows + "</tbody>" +
          "<tfoot><tr><td colspan='4'></td>" +
          "<td><b>$" + totalDiscount.toFixed(2) + "</b></td>" +
          "<td><b>$" + grandTotal.toFixed(2) + "</b></td>" +
          "</tr></tfoot></table>"
        : "<p style='text-align:center;padding:2rem'>No products found.</p>";

      const { success: ms, data: modal } = await createModal({
        id: "modal-discount-" + genUUID(),
        type: "MODAL",
        options: {
          title: "Discount Details",
          position: "center",
          dataType: "HTML",
          size: "lg",
          html,
          actions: { cancel: { label: "Close" }, confirm: { hide: true } },
        },
      });
      if (ms) modal.invoke("ui.open");
    });
  } catch (e) {
    createLog("featureDiscountDetails", "Failed", "job_details", "error");
  }
}`,
  },

  {
    id: 'F-09',
    label: 'Assign Job To Me (Single)',
    description:
      'Shows an "Assign To Me" button on job details when the current user is not '
      + 'yet assigned. Assigns the user via the API using their first team.',
    pages: ['job_details'],
    fnName: 'featureAssignToMe',
    requiredConfig: [],
    codeBlock: () => `
async function featureAssignToMe(stateChangeData) {
  try {
    const jobResp = await window.zclient.get("job");
    if (!jobResp.success) return;
    const { job_uid, assigned_to } = jobResp.response;
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    if (!user.user_uid) return;
    const alreadyAssigned = (assigned_to || []).some(a => a.user?.user_uid === user.user_uid);
    if (alreadyAssigned) return;

    const { success, data: btn } = await createButton({
      id: "btn-assign-me",
      icon: "user-plus",
      type: "BUTTON",
      title: "Assign To Me",
      page: "job_details",
      location: "BREADCRUMB",
    });
    if (!success) return;

    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-assign-loader", type: "TOAST",
        message: "Assigning...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const teams = await getUserTeams(user.user_uid);
        if (!teams.length) throw new Error("User has no teams");
        await window.zclient.request({
          url: "/jobs/" + job_uid + "/update?job_uid=" + job_uid + "&notify_users=true&update_all_jobs=false",
          type: "PUT",
          contentType: "application/json",
          externalRequest: false,
          data: { job: [{ type: "ASSIGN", user_uid: user.user_uid, team_uid: teams[0].team_uid, is_primary: false }] },
        });
        loader?.invoke("ui.close");
        btn.invoke("ui.remove");
        await createToast({ id: "toast-assign-ok", type: "TOAST",
          message: "Job assigned to you",
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
        window.zclient.invoke("page.refresh");
      } catch (err) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-assign-err", type: "TOAST",
          message: "Assignment failed: " + err.message,
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureAssignToMe", "Failed", "job_details", "error");
  }
}`,
  },

  {
    id: 'F-11',
    label: 'Go To Dispatch Board Button',
    description:
      'Adds an "Open Dispatch Board" button on job details that navigates the '
      + 'parent window to the dispatch board filtered by the job\'s work order number.',
    pages: ['job_details'],
    fnName: 'featureGoToDispatch',
    requiredConfig: [],
    codeBlock: () => `
async function featureGoToDispatch(stateChangeData) {
  try {
    const { success, data: btn } = await createButton({
      id: "btn-go-dispatch",
      icon: "calendar",
      type: "BUTTON",
      title: "Open Dispatch Board",
      page: "job_details",
      location: "BREADCRUMB",
      position: "left",
    });
    if (!success) return;

    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-dispatch-load", type: "TOAST",
        message: "Opening Dispatch Board...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const jobResp = await window.zclient.get("job");
        if (!jobResp.success) throw new Error("Could not fetch job");
        const { work_order_number } = jobResp.response;
        if (!work_order_number) throw new Error("Work order number missing");
        loader?.invoke("ui.close");
        window.parent.location.href =
          window.parent.origin + "/dispatch_board?work-order-number=" + work_order_number;
      } catch (err) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-dispatch-err", type: "TOAST",
          message: err.message,
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureGoToDispatch", "Failed", "job_details", "error");
  }
}`,
  },

  {
    id: 'F-18',
    label: 'Job Profitability View',
    description:
      'Adds a "View Profitability" button on job details that opens a profitability '
      + 'dashboard in a new browser tab. Hidden for "purchase order" category jobs.',
    pages: ['job_details'],
    fnName: 'featureProfitability',
    requiredConfig: [
      {
        key: 'profitabilityPageUrl',
        label: 'Profitability Dashboard Base URL',
        type: 'url',
        placeholder: 'https://static.zuperpro.com/Job_Profitability.html',
        hint: 'Job UID and title will be appended as ?job=...&name=...',
      },
    ],
    codeBlock: (cfg) => `
async function featureProfitability(stateChangeData) {
  try {
    const { id: jobUid } = stateChangeData;
    if (!jobUid) return;
    const job = await getJobDetails(jobUid);
    if (!job) return;
    if (job.job_category?.category_name?.toLowerCase().includes("purchase order")) return;

    const { success, data: btn } = await createButton({
      id: "btn-profitability",
      icon: "chart-donut",
      type: "BUTTON",
      title: "View Profitability",
      page: "job_details",
      location: "BREADCRUMB",
    });
    if (!success) return;

    btn.on("click", () => {
      const url = "${val(cfg, 'profitabilityPageUrl')}" +
        "?job=" + job.job_uid + "&name=" + encodeURIComponent(job.job_title || "");
      window.open(url, "_blank");
    });
  } catch (e) {
    createLog("featureProfitability", "Failed", "job_details", "error");
  }
}`,
  },

  // ── DISPATCH BOARD ────────────────────────────────────────────────────────

  {
    id: 'F-08',
    label: 'Delivery Date Restriction (Dispatch Board)',
    description:
      'Prevents rescheduling a "delivery" category job to a date earlier than its '
      + '"1st Available Delivery Date" custom field value.',
    pages: [],
    fnName: '',
    initFnName: 'featureDateRestrictionInit',
    requiredConfig: [
      {
        key: 'deliveryDateField',
        label: '1st Available Delivery Date — Custom Field Label',
        type: 'text',
        default: '1st Available Delivery Date',
      },
      {
        key: 'deliveryCategoryName',
        label: 'Delivery Job Category Name',
        type: 'text',
        default: 'delivery',
        hint: 'Case-insensitive match.',
      },
    ],
    codeBlock: (cfg) => `
async function featureDateRestrictionInit() {
  const DATE_FIELD    = "${val(cfg, 'deliveryDateField', '1st Available Delivery Date')}";
  const CATEGORY_NAME = "${val(cfg, 'deliveryCategoryName', 'delivery')}".toLowerCase();

  const applyMinDate = async (instance, jobUid) => {
    if (!jobUid) return;
    const jobResp = await window.zclient.get({ key: "job", uid: jobUid });
    if (!jobResp?.success) return;
    const job = jobResp.response;
    if (job.job_category?.category_name?.toLowerCase() !== CATEGORY_NAME) return;
    const minDate = job.custom_fields?.find(f => f.label === DATE_FIELD)?.value;
    if (minDate) instance.prop("start_date", { min: minDate });
  };

  ["dispatch_board.job_reschedule", "job_details.job_reschedule"].forEach(id => {
    window.zclient.instance(id).on("open", (event) => {
      applyMinDate(window.zclient.instance(id), event?.data?.job_details?.job_uid);
    });
  });

  window.zclient.on("pre_event.dispatch_board.job_schedule_change", async ({ data }) => {
    const job = data?.jobDetails;
    if (!job || job.job_category?.category_name?.toLowerCase() !== CATEGORY_NAME) return;
    const minDateStr = job.custom_fields?.find(f => f.label === DATE_FIELD)?.value;
    if (!minDateStr) return;
    const newStart = new Date(data.newValue?.startDate);
    const minDate  = new Date(minDateStr);
    if (newStart < minDate) {
      const fmt = minDate.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
      await createToast({ id: "toast-date-restrict", type: "TOAST",
        message: "First available date is " + fmt,
        options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      await window.zclient.handle("pre_event.reject", { field: "dispatch_board.job_schedule_change" });
    }
  });
}`,
  },

  {
    id: 'F-10',
    label: 'Assign Job To Me (Bulk)',
    description:
      'Adds an "Assign To Me" button to the job list bulk action toolbar. '
      + 'Assigns the logged-in user to all selected jobs in parallel.',
    pages: [],
    fnName: '',
    initFnName: 'featureAssignToMeBulkInit',
    requiredConfig: [],
    codeBlock: () => `
async function featureAssignToMeBulkInit() {
  const { success, data: btn } = await createButton({
    id: "btn-assign-bulk",
    icon: "user-plus",
    type: "BUTTON",
    title: "Assign To Me",
    page: "job_list",
    location: "BULK_ACTION",
    position: "left",
  });
  if (!success) return;

  btn.on("click", async ({ uid: jobUids = [] }) => {
    const loader = (await createToast({ id: "toast-bulk-assign-load", type: "TOAST",
      message: "Assigning " + jobUids.length + " job(s)...",
      options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
    })).data;
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      if (!user.user_uid) throw new Error("Not logged in");
      const teams = await getUserTeams(user.user_uid);
      if (!teams.length) throw new Error("User has no teams");
      const results = await Promise.all(jobUids.map(uid =>
        window.zclient.request({
          url: "/jobs/" + uid + "/update?job_uid=" + uid + "&notify_users=true&update_all_jobs=false",
          type: "PUT",
          contentType: "application/json",
          externalRequest: false,
          data: { job: [{ type: "ASSIGN", user_uid: user.user_uid, team_uid: teams[0].team_uid, is_primary: false }] },
        })
      ));
      loader?.invoke("ui.close");
      const failed = results.filter(r => !r?.ok).length;
      await createToast({ id: "toast-bulk-ok", type: "TOAST",
        message: failed ? (jobUids.length - failed) + " assigned, " + failed + " failed" : "All jobs assigned",
        options: { autoClose: true, position: "top-center", type: failed ? "warning" : "success", dismissible: true } });
      window.zclient.invoke("page.refresh");
    } catch (err) {
      loader?.invoke("ui.close");
      await createToast({ id: "toast-bulk-err", type: "TOAST",
        message: "Bulk assignment failed: " + err.message,
        options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
    }
  });
}`,
  },

  // ── TIMELOG / IFRAME EMBEDS ───────────────────────────────────────────────

  {
    id: 'F-12',
    label: 'Timelog IFRAME Modal (Job)',
    description:
      'Adds an "Add Timelog" button on job details that opens a full-screen IFRAME '
      + 'modal. Passes job details, auth token, and API base URL into the IFRAME '
      + 'via postMessage.',
    pages: ['job_details'],
    fnName: 'featureTimelogJob',
    requiredConfig: [
      {
        key: 'timelogJobUrl',
        label: 'Timelog App URL',
        type: 'url',
        placeholder: 'https://your-timelog-app.web.app',
      },
    ],
    codeBlock: (cfg) => `
async function featureTimelogJob(stateChangeData) {
  try {
    const existing = await window.zclient.isExist("btn-timelog-job");
    if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");

    const { success, data: btn } = await createButton({
      id: "btn-timelog-job",
      type: "BUTTON",
      title: "Add Timelog",
      page: "job_details",
      location: "BREADCRUMB",
      position: "left",
    });
    if (!success) return;

    btn.on("click", async () => {
      const { success: ms, data: modal } = await createModal({
        id: "modal-timelog-job-" + genUUID(),
        type: "MODAL",
        options: {
          title: null,
          dataType: "IFRAME",
          position: "center",
          url: "${val(cfg, 'timelogJobUrl')}",
          height: "47rem",
          width: "65rem",
          hide_header: true,
          hide_footer: true,
          full_screen: false,
        },
      });
      if (!ms) return;
      modal.on("listen", async ({ type }) => {
        if (type === "initiate") {
          const jobResp = await window.zclient.get("job");
          await modal.dispatch({ type: "init_data", content: JSON.stringify({
            jobDetails: jobResp?.response,
            token: "Bearer " + localStorage.getItem("auth_token"),
            baseUrl: localStorage.getItem("dc_api_url"),
          })});
        } else if (type === "success") {
          window.zclient.invoke("page.refresh");
          modal.invoke("ui.remove");
        } else if (type === "cancel") {
          modal.invoke("ui.remove");
        }
      });
      modal.invoke("ui.open");
    });
  } catch (e) {
    createLog("featureTimelogJob", "Failed", "job_details", "error");
  }
}`,
  },

  {
    id: 'F-13',
    label: 'Timelog IFRAME Modal (Project)',
    description:
      'Same as F-12 but for the project details page. Sends project details into '
      + 'the IFRAME and listens for "project-success".',
    pages: ['project_details'],
    fnName: 'featureTimelogProject',
    requiredConfig: [
      {
        key: 'timelogProjectUrl',
        label: 'Timelog App URL',
        type: 'url',
        placeholder: 'https://your-timelog-app.web.app',
      },
    ],
    codeBlock: (cfg) => `
async function featureTimelogProject(stateChangeData) {
  try {
    const existing = await window.zclient.isExist("btn-timelog-project");
    if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");

    const { success, data: btn } = await createButton({
      id: "btn-timelog-project",
      type: "BUTTON",
      title: "Add Timelog",
      page: "project_details",
      location: "BREADCRUMB",
      position: "left",
    });
    if (!success) return;

    btn.on("click", async () => {
      const { success: ms, data: modal } = await createModal({
        id: "modal-timelog-proj-" + genUUID(),
        type: "MODAL",
        options: {
          title: null,
          dataType: "IFRAME",
          position: "center",
          url: "${val(cfg, 'timelogProjectUrl')}",
          height: "47rem",
          width: "65rem",
          hide_header: true,
          hide_footer: true,
          full_screen: false,
        },
      });
      if (!ms) return;
      modal.on("listen", async ({ type }) => {
        if (type === "initiate") {
          const projResp = await window.zclient.get("project");
          await modal.dispatch({ type: "init_data", content: JSON.stringify({
            projectDetails: projResp?.response,
            token: "Bearer " + localStorage.getItem("auth_token"),
            baseUrl: localStorage.getItem("dc_api_url"),
          })});
        } else if (type === "project-success") {
          window.zclient.invoke("page.refresh");
          modal.invoke("ui.remove");
        } else if (type === "cancel") {
          modal.invoke("ui.remove");
        }
      });
      modal.invoke("ui.open");
    });
  } catch (e) {
    createLog("featureTimelogProject", "Failed", "project_details", "error");
  }
}`,
  },

  // ── SERVICE TASK / REPORTS ────────────────────────────────────────────────

  {
    id: 'F-14',
    label: 'Bulk Service Task Assignment (IFRAME)',
    description:
      'Adds an "Assign Service Tasks" bulk action button on the job list. '
      + 'Opens a full-screen IFRAME with the service task manager, passing '
      + 'selected job UIDs and auth credentials.',
    pages: [],
    fnName: '',
    initFnName: 'featureServiceTaskAssignInit',
    requiredConfig: [
      {
        key: 'serviceTaskIframeUrl',
        label: 'Service Task Manager IFRAME URL',
        type: 'url',
        placeholder: 'https://static.zuperpro.com/service_tasks.html',
        hint: 'bearer and region will be appended as query params.',
      },
    ],
    codeBlock: (cfg) => `
async function featureServiceTaskAssignInit() {
  const { success, data: btn } = await createButton({
    id: "btn-service-tasks",
    type: "BUTTON",
    title: "Assign Service Tasks",
    page: "job_list",
    location: "BULK_ACTION",
    position: "right",
  });
  if (!success) return;

  btn.on("click", async ({ uid: jobUids = [], isTotalRecordSelected = false, filter_rules = [] }) => {
    const bearer = localStorage.getItem("auth_token");
    const region = localStorage.getItem("dc_region");
    const iframeUrl = "${val(cfg, 'serviceTaskIframeUrl')}" +
      "?bearer=" + encodeURIComponent(bearer) + "&region=" + encodeURIComponent(region);

    const { success: ms, data: modal } = await createModal({
      id: "modal-service-tasks",
      type: "MODAL",
      options: {
        title: "Service Task Manager",
        size: "xl",
        dataType: "IFRAME",
        position: "center",
        url: iframeUrl,
        hide_header: true,
        full_screen: true,
        auto_close: false,
        hide_footer: true,
        actions: { confirm: { hide: true }, cancel: { label: "Close", hide: false } },
      },
    });
    if (!ms) return;
    modal.invoke("ui.open");
    const handled = {};
    modal.on("listen", async ({ type, content }) => {
      if (type === "success") {
        await modal.dispatch({ type: "getData",
          content: JSON.stringify({ job_uids: jobUids, isBulkSelect: isTotalRecordSelected, filter_rules }) });
      }
      if (type === "close" && !handled[type]) {
        handled[type] = true;
        modal.invoke("ui.remove");
        await createToast({ id: "toast-st-done", type: "TOAST",
          message: "Service tasks will be assigned shortly",
          options: { autoClose: false, position: "bottom-center", dismissible: true } });
      }
      if (type === "cancel") modal.invoke("ui.remove");
    });
    await wait(1000);
    await modal.dispatch({ type: "API",
      content: JSON.stringify({ bearer, region }) });
  });
}`,
  },

  {
    id: 'F-15',
    label: 'Inspection Form Data Report',
    description:
      'Adds a "Inspection Form Data Report" button on the report list page. '
      + 'Opens a date-range FORM modal with optional customer/user filters, '
      + 'then triggers a report webhook. The report is emailed to the user.',
    pages: ['report_list'],
    fnName: 'featureInspectionReport',
    requiredConfig: [
      {
        key: 'reportWebhook',
        label: 'Report Webhook URL',
        type: 'url',
        placeholder: 'https://internalwf.zuper.co/webhook/...',
        hint: 'POST receives { from_date, to_date, customer, user, userEmail }',
      },
      {
        key: 'optionsWebhook',
        label: 'Options Webhook URL (customers & users list)',
        type: 'url',
        placeholder: 'https://internalwf.zuper.co/webhook/...',
        hint: 'POST returns { customers: [{customerName, customer_uid}], users: [{userName, user_uid}] }',
      },
    ],
    codeBlock: (cfg) => `
async function featureInspectionReport(stateChangeData) {
  try {
    const { success, data: btn } = await createButton({
      id: "btn-inspection-report-" + (stateChangeData?.page || ""),
      icon: "download",
      type: "BUTTON",
      title: "Inspection Form Data Report",
      page: stateChangeData?.page || "report_list",
      location: "BREADCRUMB",
      position: "left",
    });
    if (!success) return;

    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-report-load", type: "TOAST",
        message: "Loading filters...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;

      const optResp = await window.zclient.request({
        url: "${val(cfg, 'optionsWebhook')}",
        type: "POST",
        contentType: "application/json",
        cors: false,
        externalRequest: true,
        data: {},
      });
      loader?.invoke("ui.close");

      const customers = optResp?.body?.customers || [];
      const users     = optResp?.body?.users     || [];
      let selCustomer = "", selUser = "";

      const { success: ms, data: modal } = await createModal({
        id: "modal-inspection-report",
        type: "MODAL",
        options: {
          title: "Inspection Form Data Report",
          position: "center",
          dataType: "FORM",
          size: "md",
          height: "340px",
          width: "740px",
          fields: [
            { label: "From Date", type: "DATE", id: "from_date", default: "", field_options: { is_required: true, width: "col-span-2" } },
            { label: "To Date",   type: "DATE", id: "to_date",   default: "", field_options: { is_required: true, width: "col-span-2" } },
            { label: "Customer", type: "SINGLE_ITEM", id: "customer_field",
              values: customers.map(c => c.customerName), field_options: { is_required: false, width: "col-span-3" } },
            { label: "User", type: "SINGLE_ITEM", id: "user_field",
              values: users.map(u => u.userName), field_options: { is_required: false, width: "col-span-3" } },
          ],
          actions: { confirm: { label: "Generate Report", color: "primary" }, cancel: { label: "Close" } },
        },
      });
      if (!ms) return;
      modal.invoke("ui.open");
      modal.on("changes", async () => {
        selCustomer = (await modal.get("customer_field"))?.customer_field || "";
        selUser     = (await modal.get("user_field"))?.user_field         || "";
      });
      modal.on("confirm", async (data) => {
        if (data.from_date > data.to_date) {
          await createToast({ id: "toast-date-err", type: "TOAST",
            message: "From Date cannot be after To Date",
            options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
          return;
        }
        modal.invoke("ui.close");
        const custUid = customers.find(c => c.customerName === selCustomer)?.customer_uid || "";
        const userUid = users.find(u => u.userName === selUser)?.user_uid               || "";
        const userEmail = JSON.parse(localStorage.getItem("user") || "{}").email || "";
        await window.zclient.request({
          url: "${val(cfg, 'reportWebhook')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: { from_date: data.from_date, to_date: data.to_date, customer: custUid, user: userUid, userEmail },
        });
        await createToast({ id: "toast-report-sent", type: "TOAST",
          message: "Report generated and sent to your email",
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
      });
    });
  } catch (e) {
    createLog("featureInspectionReport", "Failed", stateChangeData?.page, "error");
  }
}`,
  },

  {
    id: 'F-22',
    label: 'Clock-Shop Times Report',
    description:
      'Adds a report download button on the timesheet list / report list page. '
      + 'Same FORM modal as F-15 with date range + customer/user filters.',
    pages: ['timesheet_list', 'report_list'],
    fnName: 'featureClockShopReport',
    requiredConfig: [
      {
        key: 'clockShopReportWebhook',
        label: 'Clock-Shop Report Webhook URL',
        type: 'url',
        placeholder: 'https://internalwf.zuper.co/webhook/...',
        hint: 'POST receives { from_date, to_date, customer, user, userEmail }',
      },
      {
        key: 'clockShopOptionsWebhook',
        label: 'Options Webhook URL (customers & users list)',
        type: 'url',
        placeholder: 'https://internalwf.zuper.co/webhook/...',
      },
    ],
    codeBlock: (cfg) => `
async function featureClockShopReport(stateChangeData) {
  try {
    const page = stateChangeData?.page || "timesheet_list";
    const btnId = "btn-clockshop-" + page;
    const existing = await window.zclient.isExist(btnId);
    if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");

    const { success, data: btn } = await createButton({
      id: btnId,
      icon: "download",
      type: "BUTTON",
      title: "Clock-Shop Times Report",
      page,
      location: "BREADCRUMB",
      position: "left",
    });
    if (!success) return;

    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-cs-load", type: "TOAST",
        message: "Fetching filters...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      const optResp = await window.zclient.request({
        url: "${val(cfg, 'clockShopOptionsWebhook')}",
        type: "POST",
        contentType: "application/json",
        cors: false,
        externalRequest: true,
        data: {},
      });
      loader?.invoke("ui.close");
      const customers = optResp?.body?.customers || [];
      const users     = optResp?.body?.users     || [];
      let selCustomer = "", selUser = "";

      const { success: ms, data: modal } = await createModal({
        id: "modal-clockshop-" + genUUID(),
        type: "MODAL",
        options: {
          title: "Clock-Shop Times Report",
          position: "center",
          dataType: "FORM",
          size: "md",
          fields: [
            { label: "From Date", type: "DATE", id: "from_date", default: "", field_options: { is_required: true, width: "col-span-2" } },
            { label: "To Date",   type: "DATE", id: "to_date",   default: "", field_options: { is_required: true, width: "col-span-2" } },
            { label: "Customer", type: "SINGLE_ITEM", id: "customer_field",
              values: customers.map(c => c.customerName), field_options: { is_required: false, width: "col-span-3" } },
            { label: "User", type: "SINGLE_ITEM", id: "user_field",
              values: users.map(u => u.userName), field_options: { is_required: false, width: "col-span-3" } },
          ],
          actions: { confirm: { label: "Generate Report", color: "primary" }, cancel: { label: "Close" } },
        },
      });
      if (!ms) return;
      modal.invoke("ui.open");
      modal.on("changes", async () => {
        selCustomer = (await modal.get("customer_field"))?.customer_field || "";
        selUser     = (await modal.get("user_field"))?.user_field         || "";
      });
      modal.on("confirm", async (data) => {
        if (data.from_date > data.to_date) {
          await createToast({ id: "toast-cs-date-err", type: "TOAST",
            message: "From Date cannot be after To Date",
            options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
          return;
        }
        modal.invoke("ui.close");
        const custUid   = customers.find(c => c.customerName === selCustomer)?.customer_uid || "";
        const userUid   = users.find(u => u.userName === selUser)?.user_uid               || "";
        const userEmail = JSON.parse(localStorage.getItem("user") || "{}").email || "";
        await window.zclient.request({
          url: "${val(cfg, 'clockShopReportWebhook')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: { from_date: data.from_date, to_date: data.to_date, customer: custUid, user: userUid, userEmail },
        });
        await createToast({ id: "toast-cs-sent", type: "TOAST",
          message: "Report sent to your email",
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
      });
    });
  } catch (e) {
    createLog("featureClockShopReport", "Failed", stateChangeData?.page, "error");
  }
}`,
  },

  // ── PRODUCT / PURCHASE ORDER ──────────────────────────────────────────────

  {
    id: 'F-16',
    label: 'Smart Document Scan (Product List)',
    description:
      'Adds a "Smart Scan" button on the product list page breadcrumb that opens '
      + 'an IFRAME modal to a document-scanning application.',
    pages: ['product_list'],
    fnName: 'featureSmartScan',
    requiredConfig: [
      {
        key: 'scanPageUrl',
        label: 'Document Scan App URL',
        type: 'url',
        placeholder: 'https://your-scan-app.web.app/upload',
      },
    ],
    codeBlock: (cfg) => `
async function featureSmartScan(stateChangeData) {
  try {
    const { success, data: btn } = await createButton({
      id: "btn-smart-scan",
      icon: "robot",
      type: "BUTTON",
      title: "Smart Scan",
      page: "product_list",
      location: "BREADCRUMB",
    });
    if (!success) return;

    btn.on("click", async () => {
      const { success: ms, data: modal } = await createModal({
        id: "modal-scan-" + genUUID(),
        type: "MODAL",
        options: {
          size: "xl",
          title: "Scan Document",
          position: "center",
          dataType: "IFRAME",
          url: "${val(cfg, 'scanPageUrl')}",
          actions: { confirm: { hide: true }, cancel: { label: "Close" } },
        },
      });
      if (ms) modal.invoke("ui.open");
    });
  } catch (e) {
    createLog("featureSmartScan", "Failed", "product_list", "error");
  }
}`,
  },

  {
    id: 'F-17',
    label: 'Create Purchase Order',
    description:
      'Adds a "Create PO" button on the product list (bulk action), product details, '
      + 'and job details pages. Calls a webhook to trigger PO creation.',
    pages: ['product_list', 'product_details', 'job_details'],
    fnName: 'featureCreatePO',
    requiredConfig: [
      {
        key: 'poWebhook',
        label: 'Create PO Webhook URL',
        type: 'url',
        placeholder: 'https://internalwf.zuper.co/webhook/...',
      },
    ],
    codeBlock: (cfg) => `
async function featureCreatePO(stateChangeData) {
  try {
    const page = stateChangeData?.page || "product_list";
    const location = page === "product_list" ? "BULK_ACTION" : "BREADCRUMB";
    const { success, data: btn } = await createButton({
      id: "btn-create-po-" + page,
      icon: "briefcase-2",
      type: "BUTTON",
      title: "Create PO",
      page,
      location,
    });
    if (!success) return;

    btn.on("click", async (event) => {
      const loader = (await createToast({ id: "toast-po-load", type: "TOAST",
        message: "Creating Purchase Order...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const payload = {
          page,
          selected_uids: event?.uid || [],
          entity_id: stateChangeData?.id || null,
          triggered_by: JSON.parse(localStorage.getItem("user") || "{}").user_uid,
        };
        await window.zclient.request({
          url: "${val(cfg, 'poWebhook')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: payload,
        });
        loader?.invoke("ui.close");
        await createToast({ id: "toast-po-ok", type: "TOAST",
          message: "Purchase Order creation initiated",
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
      } catch (err) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-po-err", type: "TOAST",
          message: "PO creation failed: " + err.message,
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureCreatePO", "Failed", stateChangeData?.page, "error");
  }
}`,
  },

  {
    id: 'F-19',
    label: 'Budget vs Actual (Project)',
    description:
      'Adds a "Budget vs Actuals" button on project details. Fetches all associated '
      + 'jobs (excluding purchase orders), collects their products, and renders a '
      + 'budget comparison table in an HTML modal.',
    pages: ['project_details'],
    fnName: 'featureBudgetVsActual',
    requiredConfig: [
      {
        key: 'budgetFieldKeyword',
        label: 'Budget Line Item Keyword',
        type: 'text',
        default: 'budget',
        hint: 'Products whose name/description contains this keyword are treated as budget rows.',
      },
    ],
    codeBlock: (cfg) => `
async function featureBudgetVsActual(stateChangeData) {
  try {
    const { id: projectUid } = stateChangeData;
    if (!projectUid) return;

    const projResp = await window.zclient.request({
      url: "/projects/" + projectUid,
      type: "GET",
      contentType: "application/json",
      cors: false,
      externalRequest: false,
    });
    const project = projResp?.body?.data;
    if (!project) return;

    const jobUids = (project.jobs || []).map(j => j.job?.job_uid).filter(Boolean);
    const jobDetails = await Promise.all(jobUids.map(uid => getJobDetails(uid)));
    const validJobs  = jobDetails.filter(j => j &&
      !j.job_category?.category_name?.toLowerCase().includes("purchase order"));
    const products = validJobs.flatMap(j => j.products || []);

    const BUDGET_KW = "${val(cfg, 'budgetFieldKeyword', 'budget')}".toLowerCase();
    const budgetItems = products.filter(p =>
      (p.product_name || "").toLowerCase().includes(BUDGET_KW) ||
      (p.description  || "").toLowerCase().includes(BUDGET_KW));
    const actualItems = products.filter(p =>
      !(p.product_name || "").toLowerCase().includes(BUDGET_KW) &&
      !(p.description  || "").toLowerCase().includes(BUDGET_KW));

    const budgetTotal = budgetItems.reduce((s, p) => s + (p.total || 0), 0);
    const actualTotal = actualItems.reduce((s, p) => s + (p.total || 0), 0);
    const variance    = budgetTotal - actualTotal;

    const html =
      "<div style='padding:1rem'>" +
      "<table style='width:100%;border-collapse:collapse;margin-bottom:1rem'>" +
      "<thead><tr style='background:#f3f4f6'><th style='text-align:left;padding:8px'>Metric</th><th style='text-align:right;padding:8px'>Amount</th></tr></thead>" +
      "<tbody>" +
      "<tr><td style='padding:8px'>Budget</td><td style='text-align:right;padding:8px'>$" + budgetTotal.toFixed(2) + "</td></tr>" +
      "<tr><td style='padding:8px'>Actual</td><td style='text-align:right;padding:8px'>$" + actualTotal.toFixed(2) + "</td></tr>" +
      "<tr style='font-weight:bold;color:" + (variance >= 0 ? "green" : "red") + "'>" +
      "<td style='padding:8px'>Variance</td><td style='text-align:right;padding:8px'>" + (variance >= 0 ? "+" : "") + "$" + variance.toFixed(2) + "</td></tr>" +
      "</tbody></table>" +
      "<p style='color:#6b7280;font-size:0.875rem'>Based on " + validJobs.length + " job(s), " + products.length + " product(s)</p></div>";

    const existing = await window.zclient.isExist("btn-budget-actual");
    if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");

    const { success, data: btn } = await createButton({
      id: "btn-budget-actual",
      icon: "brand-cashapp",
      type: "BUTTON",
      title: "Budget vs Actuals",
      page: "project_details",
      location: "BREADCRUMB",
    });
    if (!success) return;

    btn.on("click", async () => {
      const { success: ms, data: modal } = await createModal({
        id: "modal-budget-" + genUUID(),
        type: "MODAL",
        options: {
          title: "Budget vs Actuals — " + (project.project_name || "Project"),
          position: "center",
          dataType: "HTML",
          size: "md",
          html,
          actions: { cancel: { label: "Close" }, confirm: { hide: true } },
        },
      });
      if (ms) modal.invoke("ui.open");
    });
  } catch (e) {
    createLog("featureBudgetVsActual", "Failed", "project_details", "error");
  }
}`,
  },

  // ── TIMESHEET PUNCH SYSTEM ────────────────────────────────────────────────

  {
    id: 'F-20',
    label: 'Timesheet Punch In / Out / Break / Resume',
    description:
      'Registers four timesheet buttons (Punch In, Punch Out, Break, Resume) on '
      + 'job details. Button visibility follows a state machine driven by the user\'s '
      + 'last timesheet entry type (CHECK_IN, CHECK_OUT, BREAK, RESUME_WORK).',
    pages: ['job_details'],
    fnName: 'featureTimesheetPunch',
    initFnName: 'featureTimesheetPunchInit',
    requiredConfig: [
      {
        key: 'timesheetWebhook',
        label: 'Timesheet Action Webhook URL',
        type: 'url',
        placeholder: 'https://internalwf.zuper.co/webhook/...',
        hint: 'POST receives { user_uid, job_uid, type: PUNCH_IN|PUNCH_OUT|BREAK|RESUME_WORK, timestamp }',
      },
    ],
    codeBlock: (cfg) => `
// ── Timesheet state machine ──────────────────────────────────────────────────
const TIMESHEET_BUTTONS = [
  { id: "ts-punch-in",  title: "Punch IN",    icon: "clock-check", type: "PUNCH_IN",    check: "CHECK_IN"  },
  { id: "ts-punch-out", title: "Punch OUT",   icon: "clock-up",    type: "PUNCH_OUT",   check: "CHECK_OUT" },
  { id: "ts-break",     title: "Take Break",  icon: "clock-pause", type: "BREAK",       check: "BREAK"     },
  { id: "ts-resume",    title: "Resume",      icon: "clock-play",  type: "RESUME_WORK", check: "RESUME_WORK" },
];

const TIMESHEET_VISIBILITY = {
  CHECK_OUT:   { "ts-punch-in": true,  "ts-punch-out": false, "ts-break": false, "ts-resume": false },
  CHECK_IN:    { "ts-punch-in": false, "ts-punch-out": true,  "ts-break": true,  "ts-resume": false },
  RESUME_WORK: { "ts-punch-in": false, "ts-punch-out": true,  "ts-break": true,  "ts-resume": false },
  BREAK:       { "ts-punch-in": false, "ts-punch-out": false, "ts-break": false, "ts-resume": true  },
};

async function featureTimesheetPunchInit() {
  for (const btn of TIMESHEET_BUTTONS) {
    const { success, data: instance } = await createButton({
      id: btn.id,
      icon: btn.icon,
      type: "BUTTON",
      title: btn.title,
      page: "job_details",
      location: "BREADCRUMB",
      className: "hidden",
    });
    if (!success) continue;
    instance.on("click", async () => {
      const jobResp  = await window.zclient.get("job");
      const user     = JSON.parse(localStorage.getItem("user") || "{}");
      if (!jobResp.success || !user.user_uid) return;
      const loader = (await createToast({ id: "toast-ts-load", type: "TOAST",
        message: btn.title + "...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        await window.zclient.request({
          url: "${val(cfg, 'timesheetWebhook')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: {
            user_uid: user.user_uid,
            job_uid:  jobResp.response.job_uid,
            type:     btn.type,
            timestamp: new Date().toISOString(),
          },
        });
        loader?.invoke("ui.close");
        await applyTimesheetVisibility(btn.check);
        await createToast({ id: "toast-ts-ok", type: "TOAST",
          message: btn.title + " recorded",
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
      } catch (err) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-ts-err", type: "TOAST",
          message: btn.title + " failed: " + err.message,
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  }
}

async function featureTimesheetPunch(stateChangeData) {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    if (!user.user_uid) return;
    const tsResp = await window.zclient.request({
      url: "/timesheets/" + user.user_uid,
      type: "GET",
      externalRequest: false,
    });
    const timesheets = tsResp?.body?.data || [];
    const last = timesheets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    const lastCheck = last?.type_of_check || "CHECK_OUT";
    await applyTimesheetVisibility(lastCheck);
  } catch (e) {
    createLog("featureTimesheetPunch", "Failed", "job_details", "error");
  }
}

async function applyTimesheetVisibility(state) {
  const map = TIMESHEET_VISIBILITY[state] || TIMESHEET_VISIBILITY["CHECK_OUT"];
  for (const [btnId, show] of Object.entries(map)) {
    const ex = await window.zclient.isExist(btnId);
    if (ex?.uid) {
      window.zclient.instance(ex.uid).invoke(show ? "ui.show" : "ui.hide");
    }
  }
}`,
  },

  // ── UTILITIES ────────────────────────────────────────────────────────────

  {
    id: 'F-30',
    label: 'Timesheet Report Button',
    description:
      'Adds a "Timesheet Report" button on the timesheet list page breadcrumb. '
      + 'Calls a configurable webhook to trigger report generation.',
    pages: ['timesheet_list'],
    fnName: 'featureTimesheetReport',
    initFnName: 'featureTimesheetReportInit',
    requiredConfig: [
      {
        key: 'timesheetReportWebhook',
        label: 'Timesheet Report Webhook URL',
        type: 'url',
        placeholder: 'https://internalwf.zuper.co/webhook/...',
      },
    ],
    codeBlock: (cfg) => `
async function featureTimesheetReportInit() {
  const existing = await window.zclient.isExist("btn-timesheet-report");
  if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");
  const { success, data: btn } = await createButton({
    id: "btn-timesheet-report",
    icon: "clipboard-text",
    type: "BUTTON",
    title: "Timesheet Report",
    page: "timesheet_list",
    location: "BREADCRUMB",
    position: "left",
  });
  if (!success) return;
  btn.on("click", async () => {
    const loader = (await createToast({ id: "toast-ts-report-load", type: "TOAST",
      message: "Generating report...",
      options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
    })).data;
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      await window.zclient.request({
        url: "${val(cfg, 'timesheetReportWebhook')}",
        type: "POST",
        contentType: "application/json",
        cors: false,
        externalRequest: true,
        data: { triggered_by: user.user_uid, email: user.email },
      });
      loader?.invoke("ui.close");
      await createToast({ id: "toast-ts-report-ok", type: "TOAST",
        message: "Report generated and sent to your email",
        options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
    } catch (err) {
      loader?.invoke("ui.close");
      await createToast({ id: "toast-ts-report-err", type: "TOAST",
        message: "Report generation failed",
        options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
    }
  });
}

async function featureTimesheetReport(stateChangeData) {
  // Timesheet list page — button already registered globally; nothing extra needed per navigation.
}`,
  },

  // ── F-21 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-21',
    label: 'Timesheet Button Visibility State Machine',
    description:
      'Controls visibility of punch-in/out/break/resume buttons based on the last timesheet check type for the current user on job_details. '
      + 'Depends on F-20 (Timesheet Punch feature) buttons being registered.',
    pages: ['job_details'],
    fnName: 'featureTimesheetVisibility',
    requiredConfig: [],
    codeBlock: (_cfg) => `
async function featureTimesheetVisibility(stateChangeData) {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    if (!user.user_uid) return;
    const tsResp = await window.zclient.get("timesheets");
    if (!tsResp.success) return;
    const entries = tsResp.response || [];
    const userEntries = entries.filter(e => e.user_uid === user.user_uid);
    if (!userEntries.length) return;
    const last = userEntries[userEntries.length - 1];
    const lastCheckType = last.type_of_check;
    const buttonVisibilityMap = {
      CHECK_OUT:   { "btn-punch-in": "show", "btn-punch-out": "hide", "btn-resume": "hide", "btn-break": "hide" },
      CHECK_IN:    { "btn-punch-in": "hide", "btn-punch-out": "show", "btn-resume": "hide", "btn-break": "show" },
      RESUME_WORK: { "btn-punch-in": "hide", "btn-punch-out": "show", "btn-resume": "hide", "btn-break": "show" },
      BREAK:       { "btn-punch-in": "hide", "btn-punch-out": "hide", "btn-resume": "show", "btn-break": "hide" },
    };
    const visMap = buttonVisibilityMap[lastCheckType];
    if (!visMap) return;
    for (const [btnId, action] of Object.entries(visMap)) {
      const existing = await window.zclient.isExist(btnId);
      if (existing?.uid) {
        window.zclient.instance(existing.uid).invoke(action === "show" ? "ui.show" : "ui.hide");
      }
    }
  } catch (e) {
    createLog("featureTimesheetVisibility", "Failed", "job_details", "error");
  }
}`,
  },

  // ── F-23 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-23',
    label: 'Standalone Booking Widget',
    description:
      'Standalone HTML/CSS/JS booking widget (no SDK dependency). Provides service type selection, date picker, slot availability, customer info form, and job creation via webhooks. '
      + 'Generated as a separate booking_widget.html file.',
    pages: [],
    fnName: 'featureBookingWidget',
    requiredConfig: [
      {
        key: 'categoryDurationWebhook',
        label: 'Category Duration Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { type: "category_duration", category } → { duration: "60" }',
      },
      {
        key: 'assistedScheduleWebhook',
        label: 'Assisted Schedule Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { type: "assisted_schedule", date, category, duration } → { slots: [...] }',
      },
      {
        key: 'createJobWebhook',
        label: 'Create Job Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { type: "create_job", customer, address, date, slot, category } → { success, job_uid }',
      },
    ],
    codeBlock: (cfg) => `
// NOTE: This is a standalone HTML widget — not an SDK extension.
// Deploy booking_widget.html separately (e.g., Firebase Hosting, S3).
// The generated snippet below is the webhook integration scaffold.

// Webhook 1: Fetch category duration
// POST { type: "category_duration", category: selectedCategory }
// → Response: { duration: "60" }  (minutes)

// Webhook 2: Fetch available slots
// POST { type: "assisted_schedule", date: "YYYY-MM-DD", category, duration }
// → Response: { slots: ["09:00 AM", "10:00 AM", ...] }

// Webhook 3: Create job
// POST { type: "create_job", customer: {...}, address: {...}, date, slot, category }
// → Response: { success: true, job_uid: "..." }

// Configure these webhooks in booking_widget.html:
const BOOKING_CONFIG = {
  categoryDurationWebhook: "${val(cfg, 'categoryDurationWebhook')}",
  assistedScheduleWebhook: "${val(cfg, 'assistedScheduleWebhook')}",
  createJobWebhook: "${val(cfg, 'createJobWebhook')}",
};`,
  },

  // ── F-24 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-24',
    label: 'Color Information Lookup (Hollander #)',
    description:
      'Reads the "Hollander #" custom field from the job, POSTs to a color database webhook, and opens an HTML modal displaying color info (finish, code, description).',
    pages: ['job_details'],
    fnName: 'featureColorLookup',
    requiredConfig: [
      {
        key: 'colorLookupWebhook',
        label: 'Color Lookup Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { hollanderNumber } → { finish, code, description }',
      },
    ],
    codeBlock: (cfg) => `
async function featureColorLookup(stateChangeData) {
  try {
    const { success, data: btn } = await createButton({
      id: "btn-color-lookup",
      icon: "palette",
      type: "BUTTON",
      title: "Color Info",
      page: "job_details",
      location: "BREADCRUMB",
    });
    if (!success) return;
    btn.on("click", async () => {
      const jobResp = await window.zclient.get("job");
      if (!jobResp.success) return;
      const hollander = jobResp.response.custom_fields?.find(cf => cf.label === "Hollander #")?.value || "";
      if (!hollander) {
        await createToast({ id: "toast-color-no-hollander", type: "TOAST",
          message: "No Hollander # found on this job",
          options: { autoClose: true, position: "top-center", type: "warning", dismissible: true } });
        return;
      }
      const loader = (await createToast({ id: "toast-color-load", type: "TOAST",
        message: "Looking up color info...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const res = await window.zclient.request({
          url: "${val(cfg, 'colorLookupWebhook')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: { hollanderNumber: hollander },
        });
        loader?.invoke("ui.close");
        const color = res?.data || res;
        const html = \`<div style="padding:16px;font-family:sans-serif">
          <h3 style="margin-bottom:12px">Color: \${hollander}</h3>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px;font-weight:600">Finish</td><td>\${color.finish || "N/A"}</td></tr>
            <tr><td style="padding:6px;font-weight:600">Code</td><td>\${color.code || "N/A"}</td></tr>
            <tr><td style="padding:6px;font-weight:600">Description</td><td>\${color.description || "N/A"}</td></tr>
          </table>
        </div>\`;
        await createModal({
          id: "modal-color-" + genUUID(),
          type: "MODAL",
          options: {
            title: "Color Information",
            position: "center",
            dataType: "HTML",
            size: "md",
            html,
            actions: { cancel: { label: "Close" }, confirm: { hide: true } },
          },
        }).then(r => r.data?.invoke("ui.open"));
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-color-err", type: "TOAST",
          message: "Color lookup failed",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureColorLookup", "Failed", "job_details", "error");
  }
}`,
  },

  // ── F-25 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-25',
    label: 'Print Label Consolidation & Email',
    description:
      'Creates a "Print Label" button on job_details. Consolidates label data from job products and sends to webhook which emails the label to the configured recipient.',
    pages: ['job_details'],
    fnName: 'featurePrintLabel',
    requiredConfig: [
      {
        key: 'printLabelWebhook',
        label: 'Print Label Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST label data including job_uid, job_title, recipient, labels[]',
      },
      {
        key: 'recipientEmail',
        label: 'Recipient Email',
        type: 'text',
        placeholder: 'labels@example.com',
        hint: 'Email address to receive the label',
      },
    ],
    codeBlock: (cfg) => `
async function featurePrintLabel(stateChangeData) {
  try {
    const { success, data: btn } = await createButton({
      id: "btn-print-label",
      icon: "printer",
      type: "BUTTON",
      title: "Print Label",
      page: "job_details",
      location: "BREADCRUMB",
    });
    if (!success) return;
    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-label-load", type: "TOAST",
        message: "Preparing label...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const jobResp = await window.zclient.get("job");
        if (!jobResp.success) { loader?.invoke("ui.close"); return; }
        const job = jobResp.response;
        const products = job.line_items || job.products || [];
        const labelData = products.map(p => ({
          sku: p.part_number || p.sku || "",
          name: p.name || "",
          quantity: p.quantity || 1,
          serial: p.serial_number || "",
        }));
        await window.zclient.request({
          url: "${val(cfg, 'printLabelWebhook')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: {
            job_uid: job.job_uid,
            job_title: job.title,
            recipient: "${val(cfg, 'recipientEmail')}",
            labels: labelData,
          },
        });
        loader?.invoke("ui.close");
        await createToast({ id: "toast-label-ok", type: "TOAST",
          message: "Label sent successfully",
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-label-err", type: "TOAST",
          message: "Failed to send label",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featurePrintLabel", "Failed", "job_details", "error");
  }
}`,
  },

  // ── F-26 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-26',
    label: 'Budget vs Actual Report (Invoice Batch Sync)',
    description:
      'Batch synchronizes invoice data and generates a budget-vs-actual financial report via an integration endpoint.',
    pages: ['invoice_details'],
    fnName: 'featureBudgetVsActual',
    requiredConfig: [
      {
        key: 'syncEndpoint',
        label: 'Sync Endpoint URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { invoice_uid, triggered_by, email }',
      },
    ],
    codeBlock: (cfg) => `
async function featureBudgetVsActual(stateChangeData) {
  try {
    const { success, data: btn } = await createButton({
      id: "btn-budget-vs-actual",
      icon: "chart-bar",
      type: "BUTTON",
      title: "Budget vs Actual",
      page: "invoice_details",
      location: "BREADCRUMB",
    });
    if (!success) return;
    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-bva-load", type: "TOAST",
        message: "Generating report...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const invoiceResp = await window.zclient.get("invoice");
        if (!invoiceResp.success) { loader?.invoke("ui.close"); return; }
        const user = JSON.parse(localStorage.getItem("user") || "{}");
        await window.zclient.request({
          url: "${val(cfg, 'syncEndpoint')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: {
            invoice_uid: invoiceResp.response.invoice_uid,
            triggered_by: user.user_uid,
            email: user.email,
          },
        });
        loader?.invoke("ui.close");
        await createToast({ id: "toast-bva-ok", type: "TOAST",
          message: "Report generated and sent to your email",
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-bva-err", type: "TOAST",
          message: "Report generation failed",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureBudgetVsActual", "Failed", "invoice_details", "error");
  }
}`,
  },

  // ── F-27 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-27',
    label: 'Service Task Dashboard with Image Gallery',
    description:
      'Creates a "Service Tasks" button on job_details. Fetches service tasks, then inspection form data and images for each task. '
      + 'Renders a rich HTML modal dashboard with task status indicators and image galleries.',
    pages: ['job_details'],
    fnName: 'featureServiceTaskDashboard',
    requiredConfig: [
      {
        key: 'inspectionFormWebhook',
        label: 'Inspection Form Webhook Base URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'GET /assets/inspection_form/{submissionId}',
      },
    ],
    codeBlock: (_cfg) => `
async function featureServiceTaskDashboard(stateChangeData) {
  try {
    const { success, data: btn } = await createButton({
      id: "btn-service-tasks",
      icon: "clipboard-list",
      type: "BUTTON",
      title: "Service Tasks",
      page: "job_details",
      location: "BREADCRUMB",
    });
    if (!success) return;
    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-st-load", type: "TOAST",
        message: "Loading service tasks...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const tsResp = await window.zclient.get("service_tasks");
        loader?.invoke("ui.close");
        const tasks = tsResp.success ? (tsResp.response || []) : [];
        const rows = tasks.map(t => \`
          <tr style="border-bottom:1px solid #eee">
            <td style="padding:8px">\${t.title || "Untitled"}</td>
            <td style="padding:8px">\${t.status || "—"}</td>
            <td style="padding:8px">\${t.assigned_to?.name || "Unassigned"}</td>
          </tr>\`).join("");
        const html = \`<div style="padding:16px;font-family:sans-serif">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f5f5f5">
              <th style="padding:8px;text-align:left">Task</th>
              <th style="padding:8px;text-align:left">Status</th>
              <th style="padding:8px;text-align:left">Assigned To</th>
            </tr></thead>
            <tbody>\${rows || "<tr><td colspan=3 style='padding:16px;text-align:center'>No tasks found</td></tr>"}</tbody>
          </table>
        </div>\`;
        const { data: modal } = await createModal({
          id: "modal-service-tasks-" + genUUID(),
          type: "MODAL",
          options: {
            title: "Service Task Dashboard",
            position: "center",
            dataType: "HTML",
            size: "xl",
            html,
            actions: { cancel: { label: "Close" }, confirm: { hide: true } },
          },
        });
        modal?.invoke("ui.open");
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-st-err", type: "TOAST",
          message: "Failed to load service tasks",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureServiceTaskDashboard", "Failed", "job_details", "error");
  }
}`,
  },

  // ── F-28 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-28',
    label: 'Dynamic Pricing Display Modal',
    description:
      'Creates a "View Pricing" button on job and estimate detail pages. Fetches current pricing data for line item SKUs and displays a breakdown in an HTML modal.',
    pages: ['job_details', 'estimate_details'],
    fnName: 'featureDynamicPricing',
    requiredConfig: [
      {
        key: 'pricingWebhook',
        label: 'Pricing Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { skus: [...] } → { items: [{sku, price, availability, warehouse}] }',
      },
    ],
    codeBlock: (cfg) => `
async function featureDynamicPricing(stateChangeData) {
  try {
    const page = stateChangeData.page;
    const { success, data: btn } = await createButton({
      id: "btn-dynamic-pricing",
      icon: "tag",
      type: "BUTTON",
      title: "View Pricing",
      page,
      location: "BREADCRUMB",
    });
    if (!success) return;
    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-pricing-load", type: "TOAST",
        message: "Fetching pricing...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const dataResp = await window.zclient.get(page === "job_details" ? "job" : "estimate");
        if (!dataResp.success) { loader?.invoke("ui.close"); return; }
        const lineItems = dataResp.response.line_items || [];
        const skus = lineItems.map(i => i.part_number || i.sku).filter(Boolean);
        const res = await window.zclient.request({
          url: "${val(cfg, 'pricingWebhook')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: { skus },
        });
        loader?.invoke("ui.close");
        const items = res?.data?.items || res?.items || [];
        const rows = items.map(i => \`
          <tr style="border-bottom:1px solid #eee">
            <td style="padding:8px">\${i.sku}</td>
            <td style="padding:8px">$\${i.price || "N/A"}</td>
            <td style="padding:8px">\${i.availability || "N/A"}</td>
            <td style="padding:8px">\${i.warehouse || "N/A"}</td>
          </tr>\`).join("");
        const html = \`<div style="padding:16px;font-family:sans-serif">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f5f5f5">
              <th style="padding:8px;text-align:left">SKU</th>
              <th style="padding:8px;text-align:left">Price</th>
              <th style="padding:8px;text-align:left">Availability</th>
              <th style="padding:8px;text-align:left">Warehouse</th>
            </tr></thead>
            <tbody>\${rows || "<tr><td colspan=4 style='padding:16px;text-align:center'>No pricing data</td></tr>"}</tbody>
          </table>
        </div>\`;
        const { data: modal } = await createModal({
          id: "modal-pricing-" + genUUID(),
          type: "MODAL",
          options: {
            title: "Dynamic Pricing",
            position: "center",
            dataType: "HTML",
            size: "lg",
            html,
            actions: { cancel: { label: "Close" }, confirm: { hide: true } },
          },
        });
        modal?.invoke("ui.open");
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-pricing-err", type: "TOAST",
          message: "Failed to fetch pricing",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureDynamicPricing", "Failed", stateChangeData.page, "error");
  }
}`,
  },

  // ── F-29 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-29',
    label: 'NetSuite Sync Retry',
    description:
      'Shows a resync button on invoice_details when NetSuite Invoice ID is missing or Integration Error Message is set. '
      + 'Calls webhook with invoice_uid and triggered_by to retry the NetSuite sync.',
    pages: ['invoice_details'],
    fnName: 'featureNetSuiteResync',
    requiredConfig: [
      {
        key: 'netSuiteResyncWebhook',
        label: 'NetSuite Resync Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { invoice_uid, triggered_by }',
      },
      {
        key: 'netSuiteStatusField',
        label: 'NetSuite Status Custom Field Label',
        type: 'text',
        default: 'NetSuite Invoice ID',
        placeholder: 'NetSuite Invoice ID',
      },
      {
        key: 'netSuiteErrorField',
        label: 'NetSuite Error Custom Field Label',
        type: 'text',
        default: 'Integration Error Message',
        placeholder: 'Integration Error Message',
      },
    ],
    codeBlock: (cfg) => `
async function featureNetSuiteResync(stateChangeData) {
  try {
    const invoiceResp = await window.zclient.get("invoice");
    if (!invoiceResp.success) return;
    const invoice = invoiceResp.response;
    const statusLabel = "${val(cfg, 'netSuiteStatusField', 'NetSuite Invoice ID')}";
    const errorLabel = "${val(cfg, 'netSuiteErrorField', 'Integration Error Message')}";
    const netSuiteId = invoice.custom_fields?.find(cf => cf.label === statusLabel)?.value || "";
    const errorMsg = invoice.custom_fields?.find(cf => cf.label === errorLabel)?.value || "";
    if (netSuiteId && !errorMsg) return;
    const { success, data: btn } = await createButton({
      id: "btn-netsuite-resync",
      icon: "refresh",
      type: "BUTTON",
      title: "NetSuite Resync",
      page: "invoice_details",
      location: "BREADCRUMB",
    });
    if (!success) return;
    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-ns-load", type: "TOAST",
        message: "Retrying NetSuite sync...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const fresh = await window.zclient.get("invoice");
        const user = JSON.parse(localStorage.getItem("user") || "{}");
        await window.zclient.request({
          url: "${val(cfg, 'netSuiteResyncWebhook')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: { invoice_uid: fresh.response.invoice_uid, triggered_by: user.user_uid },
        });
        loader?.invoke("ui.close");
        await createToast({ id: "toast-ns-ok", type: "TOAST",
          message: "NetSuite sync initiated",
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
        window.zclient.invoke("page.refresh", "invoice_details");
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-ns-err", type: "TOAST",
          message: "NetSuite sync failed",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureNetSuiteResync", "Failed", "invoice_details", "error");
  }
}`,
  },

  // ── F-31 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-31',
    label: 'Component Deduplication Helper',
    description:
      'Utility pattern. Injects ensureFreshComponent(id, createFn) helper into the generated code. '
      + 'Call it before creating any SDK component to prevent duplicates on re-navigation.',
    pages: [],
    fnName: 'featureDeduplication',
    requiredConfig: [],
    codeBlock: (_cfg) => `
// Component deduplication helper — call before creating any component:
// Usage: const result = await ensureFreshComponent("my-btn-id", () => createButton({...}));
async function ensureFreshComponent(id, createFn) {
  const existing = await window.zclient.isExist(id);
  if (existing?.uid) {
    window.zclient.instance(existing.uid).invoke("ui.remove");
  }
  return await createFn();
}

async function featureDeduplication(stateChangeData) {
  // Helper registered — use ensureFreshComponent() in your other feature handlers.
}`,
  },

  // ── F-32 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-32',
    label: 'Structured Logging Utility',
    description:
      'Injects a createLog(functionName, message, page, level, metadata) structured logging utility into the generated code. '
      + 'Outputs JSON-structured console messages for info/warn/error/default levels.',
    pages: [],
    fnName: 'featureLogging',
    requiredConfig: [],
    codeBlock: (_cfg) => `
// Structured logging utility — call anywhere in your extension:
// createLog("FunctionName", "Event description", "page_name", "info", { extra: "data" });
function createLog(functionName, message, page = "", level = "default", metadata = {}) {
  const logEntry = {
    level,
    message: \`SDK: fn: \${functionName} : \${page ? "page: " + page : ""} - \${message}\`,
    metadata,
  };
  switch (level.toLowerCase()) {
    case "info":  console.info(JSON.stringify(logEntry, null, 2)); break;
    case "warn":  console.warn(JSON.stringify(logEntry, null, 2)); break;
    case "error": console.error(JSON.stringify(logEntry, null, 2)); break;
    default:      console.log(JSON.stringify(logEntry, null, 2));  break;
  }
}

async function featureLogging(stateChangeData) {
  // createLog utility registered — use it in your other feature handlers.
}`,
  },

  // ── F-33 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-33',
    label: 'Business Hours Time Enforcement',
    description:
      'Enforces business hours start/end times on job_new. Listens to scheduled_start_time and scheduled_end_time changes, '
      + 'resetting times to configured business hours when dates change.',
    pages: ['job_new'],
    fnName: 'featureBusinessHoursEnforcement',
    requiredConfig: [
      {
        key: 'startTime',
        label: 'Business Start Time',
        type: 'text',
        default: '08:00:00',
        placeholder: '08:00:00',
        hint: 'HH:MM:SS format',
      },
      {
        key: 'endTime',
        label: 'Business End Time',
        type: 'text',
        default: '17:00:00',
        placeholder: '17:00:00',
        hint: 'HH:MM:SS format',
      },
    ],
    codeBlock: (cfg) => `
async function featureBusinessHoursEnforcement(stateChangeData) {
  try {
    const startTime = "${val(cfg, 'startTime', '08:00:00')}";
    const endTime   = "${val(cfg, 'endTime', '17:00:00')}";
    let prevStart = null;
    let prevEnd   = null;
    window.zclient.on("job_new.scheduled_start_time", async (event) => {
      const newDate = event?.data?.newValue ? new Date(event.data.newValue) : null;
      if (!newDate) return;
      const updated = setTime(prevStart, newDate, startTime);
      if (updated) {
        await window.zclient.set("job_new.scheduled_start_time", updated.toISOString());
        prevStart = updated;
      } else {
        prevStart = newDate;
      }
    });
    window.zclient.on("job_new.scheduled_end_time", async (event) => {
      const newDate = event?.data?.newValue ? new Date(event.data.newValue) : null;
      if (!newDate) return;
      const updated = setTime(prevEnd, newDate, endTime);
      if (updated) {
        await window.zclient.set("job_new.scheduled_end_time", updated.toISOString());
        prevEnd = updated;
      } else {
        prevEnd = newDate;
      }
    });
    await wait(1000);
    const form = await window.zclient.get("job_new.form");
    if (form?.data?.scheduled_start_time) prevStart = new Date(form.data.scheduled_start_time);
    if (form?.data?.scheduled_end_time)   prevEnd   = new Date(form.data.scheduled_end_time);
  } catch (e) {
    createLog("featureBusinessHoursEnforcement", "Failed", "job_new", "error");
  }
}`,
  },

  // ── F-34 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-34',
    label: 'Navigator URL Redirect (Dispatch Board Deep Link)',
    description:
      'Adds a "Go to Dispatch Board" button on job_details. On click navigates to the dispatch board page filtered to the current job using the SDK\'s page.navigate invoke.',
    pages: ['job_details'],
    fnName: 'featureDispatchBoardDeepLink',
    requiredConfig: [],
    codeBlock: (_cfg) => `
async function featureDispatchBoardDeepLink(stateChangeData) {
  try {
    const { success, data: btn } = await createButton({
      id: "btn-dispatch-deeplink",
      icon: "layout-board",
      type: "BUTTON",
      title: "Go to Dispatch Board",
      page: "job_details",
      location: "BREADCRUMB",
    });
    if (!success) return;
    btn.on("click", async () => {
      const jobResp = await window.zclient.get("job");
      const jobUid = jobResp?.response?.job_uid || stateChangeData.id;
      await window.zclient.invoke("page.navigate", {
        page: "dispatch_board",
        module: "job",
        id: jobUid,
      });
    });
  } catch (e) {
    createLog("featureDispatchBoardDeepLink", "Failed", "job_details", "error");
  }
}`,
  },

  // ── F-35 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-35',
    label: 'Commission Report Generator',
    description:
      'Adds a "Commissioning Report" button on job_list breadcrumb. Opens a FORM modal with from_date and to_date fields. '
      + 'Validates date range, then POSTs {from_date, to_date, userEmail, userName} to webhook.',
    pages: ['job_list'],
    fnName: 'featureCommissionReport',
    requiredConfig: [
      {
        key: 'commissionWebhook',
        label: 'Commission Report Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { from_date, to_date, userEmail, userName }',
      },
    ],
    codeBlock: (cfg) => `
async function featureCommissionReport(stateChangeData) {
  try {
    const existing = await window.zclient.isExist("btn-commission-report");
    if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");
    const { success, data: btn } = await createButton({
      id: "btn-commission-report",
      icon: "report",
      type: "BUTTON",
      title: "Commissioning Report",
      page: "job_list",
      location: "BREADCRUMB",
      position: "left",
    });
    if (!success) return;
    let selectedFrom = "";
    let selectedTo = "";
    btn.on("click", async () => {
      const { data: modal } = await createModal({
        id: "modal-commission-" + genUUID(),
        type: "MODAL",
        options: {
          title: "Commissioning Report",
          position: "center",
          dataType: "FORM",
          size: "md",
          fields: [
            { label: "From Date", type: "DATE", id: "from_date", default: "", field_options: { is_required: true } },
            { label: "To Date",   type: "DATE", id: "to_date",   default: "", field_options: { is_required: true } },
          ],
          actions: { confirm: { label: "Generate" }, cancel: {} },
        },
      });
      if (!modal) return;
      modal.invoke("ui.open");
      modal.on("changes", async (data) => {
        if (data.from_date) selectedFrom = data.from_date;
        if (data.to_date)   selectedTo   = data.to_date;
      });
      modal.on("confirm", async (data) => {
        const from = data.from_date || selectedFrom;
        const to   = data.to_date   || selectedTo;
        if (!from || !to || new Date(from) > new Date(to)) {
          await createToast({ id: "toast-commission-date-err", type: "TOAST",
            message: "From date must be before To date",
            options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
          return;
        }
        modal.invoke("ui.close");
        const user = JSON.parse(localStorage.getItem("user") || "{}");
        await window.zclient.request({
          url: "${val(cfg, 'commissionWebhook')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: {
            from_date: from,
            to_date:   to,
            userEmail: user.email || "",
            userName:  (user.first_name || "") + " " + (user.last_name || ""),
          },
        });
        await createToast({ id: "toast-commission-ok", type: "TOAST",
          message: "Report has been generated and sent to your mail",
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
      });
    });
  } catch (e) {
    createLog("featureCommissionReport", "Failed", "job_list", "error");
  }
}`,
  },

  // ── F-36 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-36',
    label: 'Pool Chemistry Field Auto-Clear (LSI)',
    description:
      'On job_new page load, waits 5 seconds then silently clears 26 LSI (Langelier Saturation Index) custom fields. No buttons or modals.',
    pages: ['job_new'],
    fnName: 'featurePoolChemistryClear',
    requiredConfig: [],
    codeBlock: (_cfg) => `
async function featurePoolChemistryClear(stateChangeData) {
  try {
    await wait(5000);
    const lsiFields = [
      "Pool Volume", "Start Temperature", "End Temperature",
      "Start pH", "End pH", "Start Total Alkalinity", "End Total Alkalinity",
      "Start Calcium Hardness", "End Calcium Hardness",
      "Start CYA", "End CYA", "Start TDS", "End TDS",
      "Start Borate", "End Borate",
      "Start Free Chlorine", "End Free Chlorine",
      "Start Combined Chlorine", "End Combined Chlorine",
      "Start Phosphate", "End Phosphate",
      "Chlorine Dosage", "pH Dosage", "Alkalinity Dosage",
      "Calcium Dosage", "DEFAULT_LSI Calculator Link",
    ];
    for (const fieldLabel of lsiFields) {
      try {
        await window.zclient.set("job_new." + fieldLabel.toLowerCase().replace(/ /g, "_"), "");
      } catch (_) {}
    }
  } catch (e) {
    createLog("featurePoolChemistryClear", "Failed", "job_new", "error");
  }
}`,
  },

  // ── F-37 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-37',
    label: 'Multi-Account Switcher',
    description:
      'On the dashboard page, checks if current user is in a parent or child company. '
      + 'Parent sees dropdown to switch to child companies. Child sees a "Switch to Parent" button.',
    pages: ['dashboard'],
    fnName: 'featureMultiAccountSwitcher',
    requiredConfig: [
      {
        key: 'companyConfig',
        label: 'Company Configuration (JSON)',
        type: 'textarea',
        placeholder: '[{"company_uid":"uid1","company_name":"Parent Co","parent":true},{"company_uid":"uid2","company_name":"Child Co"}]',
        hint: 'JSON array of {company_uid, company_name, parent?}',
      },
    ],
    codeBlock: (cfg) => `
async function featureMultiAccountSwitcher(stateChangeData) {
  try {
    const companies = ${val(cfg, 'companyConfig', '[]')};
    if (!Array.isArray(companies) || companies.length === 0) return;
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    const companyUid = user.company_uid || "";
    const current = companies.find(c => c.company_uid === companyUid);
    const parentCompany = companies.find(c => c.parent === true);
    const childCompanies = companies.filter(c => c.parent !== true && c.company_uid !== companyUid);
    if (current?.parent) {
      // Parent account — show dropdown to switch to child
      const { data: btn } = await createButton({
        id: "btn-switch-account",
        icon: "switch",
        type: "BUTTON",
        title: "Switch Account",
        page: "dashboard",
        location: "BREADCRUMB",
      });
      if (!btn) return;
      btn.on("click", async () => {
        const { data: modal } = await createModal({
          id: "modal-switch-" + genUUID(),
          type: "MODAL",
          options: {
            title: "Switch Account",
            position: "center",
            dataType: "FORM",
            size: "sm",
            fields: [{
              label: "Select Account",
              type: "SINGLE_ITEM",
              id: "target_company",
              default: "",
              values: childCompanies.map(c => c.company_name),
              field_options: { is_required: true },
            }],
            actions: { confirm: { label: "Switch" }, cancel: {} },
          },
        });
        if (!modal) return;
        modal.invoke("ui.open");
        modal.on("confirm", async (data) => {
          const target = childCompanies.find(c => c.company_name === data.target_company);
          if (!target) return;
          modal.invoke("ui.close");
          await window.zclient.invoke("user.switch", { company_uid: target.company_uid });
        });
      });
    } else if (parentCompany) {
      // Child account — show switch to parent button
      const { data: btn } = await createButton({
        id: "btn-switch-to-parent",
        icon: "arrow-up",
        type: "BUTTON",
        title: "Switch to Parent",
        page: "dashboard",
        location: "BREADCRUMB",
      });
      if (!btn) return;
      btn.on("click", async () => {
        await window.zclient.invoke("user.switch", { company_uid: parentCompany.company_uid });
      });
    }
  } catch (e) {
    createLog("featureMultiAccountSwitcher", "Failed", "dashboard", "error");
  }
}`,
  },

  // ── F-38 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-38',
    label: 'Cancel & Clone Quote',
    description:
      'Renders a "Cancel and Clone" button on estimate_details. Hidden if estimate status is CANCELED. '
      + 'Shows confirmation dialog before calling webhook. Refreshes page on success.',
    pages: ['estimate_details'],
    fnName: 'featureCancelCloneQuote',
    requiredConfig: [
      {
        key: 'cancelCloneWebhook',
        label: 'Cancel & Clone Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { uid: estimate_uid }',
      },
    ],
    codeBlock: (cfg) => `
async function featureCancelCloneQuote(stateChangeData) {
  try {
    const estimateResp = await window.zclient.get("estimate");
    if (estimateResp?.response?.status === "CANCELED") return;
    const { success, data: btn } = await createButton({
      id: "btn-cancel-clone",
      icon: "copy",
      type: "BUTTON",
      title: "Cancel and Clone",
      page: "estimate_details",
      location: "BREADCRUMB",
      position: "left",
    });
    if (!success) return;
    btn.on("click", async () => {
      const { data: dialog } = await createModal({
        id: "dialog-cancel-clone-" + genUUID(),
        type: "MODAL",
        options: {
          title: "Cancel and Clone Quote",
          position: "center",
          dataType: "FORM",
          size: "sm",
          label: "Are you sure you want to cancel and clone this quote?",
          fields: [],
          actions: { confirm: { label: "Confirm" }, cancel: { label: "Cancel" } },
        },
      });
      if (!dialog) return;
      dialog.invoke("ui.open");
      dialog.on("confirm", async () => {
        dialog.invoke("ui.close");
        const loader = (await createToast({ id: "toast-cc-load", type: "TOAST",
          message: "Processing...",
          options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
        })).data;
        try {
          const freshResp = await window.zclient.get("estimate");
          await window.zclient.request({
            url: "${val(cfg, 'cancelCloneWebhook')}",
            type: "POST",
            contentType: "application/json",
            cors: false,
            externalRequest: true,
            data: { uid: freshResp.response.estimate_uid },
          });
          loader?.invoke("ui.close");
          await createToast({ id: "toast-cc-ok", type: "TOAST",
            message: "Quote cancelled and cloned successfully",
            options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
          await wait(2000);
          window.zclient.invoke("page.refresh");
          btn.invoke("ui.remove");
        } catch (e) {
          loader?.invoke("ui.close");
          await createToast({ id: "toast-cc-err", type: "TOAST",
            message: "Cancel and clone failed",
            options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
        }
      });
    });
  } catch (e) {
    createLog("featureCancelCloneQuote", "Failed", "estimate_details", "error");
  }
}`,
  },

  // ── F-39 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-39',
    label: 'Job Pictures Manager (Download & Review)',
    description:
      'Adds two buttons on job_details: "Download Job Pictures" (fetches S3 URLs, downloads all as ZIP using JSZip) '
      + 'and "Review Job Pictures" (opens an IFRAME modal for inline review).',
    pages: ['job_details'],
    fnName: 'featureJobPictures',
    requiredConfig: [
      {
        key: 'picturesWebhook',
        label: 'Pictures Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { job_uid } → { imageUrls: [...] }',
      },
      {
        key: 'iframeReviewUrl',
        label: 'IFRAME Review URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'Base URL for inline review iframe; job_uid appended as query param',
      },
    ],
    codeBlock: (cfg) => `
async function featureJobPictures(stateChangeData) {
  try {
    const jobResp = await window.zclient.get("job");
    if (!jobResp.success) return;
    const job = jobResp.response;

    // Download button
    const { data: dlBtn } = await createButton({
      id: "btn-download-pictures",
      icon: "download",
      type: "BUTTON",
      title: "Download Job Pictures",
      page: "job_details",
      location: "BREADCRUMB",
    });
    dlBtn?.on("click", async () => {
      const loader = (await createToast({ id: "toast-pics-load", type: "TOAST",
        message: "Preparing download...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const res = await window.zclient.request({
          url: "${val(cfg, 'picturesWebhook')}",
          type: "POST", contentType: "application/json",
          cors: false, externalRequest: true,
          data: { job_uid: job.job_uid },
        });
        const imageUrls = res?.data?.imageUrls || res?.imageUrls || [];
        if (!imageUrls.length) {
          loader?.invoke("ui.close");
          await createToast({ id: "toast-pics-none", type: "TOAST",
            message: "No pictures found for this job",
            options: { autoClose: true, position: "top-center", type: "warning", dismissible: true } });
          return;
        }
        // Dynamic JSZip load
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
        const zip = new window.JSZip();
        const folder = zip.folder("job_pictures");
        await Promise.all(imageUrls.map(async (url, i) => {
          const resp = await fetch(url);
          const blob = await resp.blob();
          const ext = url.split(".").pop().split("?")[0] || "jpg";
          folder.file("image_" + (i + 1) + "." + ext, blob);
        }));
        const content = await zip.generateAsync({ type: "blob" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(content);
        a.download = (job.work_order_number || job.job_uid) + "_" + (job.title || "job") + "_images.zip";
        a.click();
        loader?.invoke("ui.close");
        await createToast({ id: "toast-pics-ok", type: "TOAST",
          message: "Download started",
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-pics-err", type: "TOAST",
          message: "Download failed",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });

    // Review button
    const { data: revBtn } = await createButton({
      id: "btn-review-pictures",
      icon: "eye",
      type: "BUTTON",
      title: "Review Job Pictures",
      page: "job_details",
      location: "BREADCRUMB",
    });
    revBtn?.on("click", async () => {
      const { data: modal } = await createModal({
        id: "modal-review-pics-" + genUUID(),
        type: "MODAL",
        options: {
          title: "Review Job Pictures",
          position: "center",
          dataType: "IFRAME",
          size: "xl",
          url: "${val(cfg, 'iframeReviewUrl')}?job_uid=" + job.job_uid,
          actions: { cancel: { label: "Close" }, confirm: { hide: true } },
        },
      });
      modal?.invoke("ui.open");
    });
  } catch (e) {
    createLog("featureJobPictures", "Failed", "job_details", "error");
  }
}`,
  },

  // ── F-40 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-40',
    label: 'Assisted Scheduling via IFRAME',
    description:
      'Renders an "Assisted Schedule" button on job_details. On click opens an IFRAME modal pointing to the scheduling app with job_uid as query param. '
      + 'Listens for postMessage confirmation from the IFRAME.',
    pages: ['job_details'],
    fnName: 'featureAssistedScheduling',
    requiredConfig: [
      {
        key: 'schedulingIframeUrl',
        label: 'Scheduling IFRAME URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'Base URL for the scheduling app; job_uid appended as ?job_uid=',
      },
    ],
    codeBlock: (cfg) => `
async function featureAssistedScheduling(stateChangeData) {
  try {
    const { success, data: btn } = await createButton({
      id: "btn-assisted-schedule",
      icon: "calendar-event",
      type: "BUTTON",
      title: "Assisted Schedule",
      page: "job_details",
      location: "BREADCRUMB",
    });
    if (!success) return;
    btn.on("click", async () => {
      const jobResp = await window.zclient.get("job");
      const jobUid = jobResp?.response?.job_uid || stateChangeData.id;
      const { data: modal } = await createModal({
        id: "modal-schedule-" + genUUID(),
        type: "MODAL",
        options: {
          title: "Assisted Scheduling",
          position: "center",
          dataType: "IFRAME",
          size: "xl",
          url: "${val(cfg, 'schedulingIframeUrl')}?job_uid=" + jobUid,
          actions: { cancel: { label: "Close" }, confirm: { hide: true } },
        },
      });
      if (!modal) return;
      modal.invoke("ui.open");
      modal.on("listen", async (message) => {
        if (message?.type === "schedule_complete" || message?.scheduled === true) {
          modal.invoke("ui.close");
          await createToast({ id: "toast-schedule-ok", type: "TOAST",
            message: "Job scheduled successfully",
            options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
          window.zclient.invoke("page.refresh");
        }
      });
    });
  } catch (e) {
    createLog("featureAssistedScheduling", "Failed", "job_details", "error");
  }
}`,
  },

  // ── F-41 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-41',
    label: 'Job Status Count Dashboard',
    description:
      'Renders a button on job_list. On click, calls webhook to fetch job counts by status and displays them in an HTML modal dashboard table.',
    pages: ['job_list'],
    fnName: 'featureJobStatusDashboard',
    requiredConfig: [
      {
        key: 'statusCountWebhook',
        label: 'Status Count Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'GET → { Open, "Vendor Rejected", "Vendor Scheduled", Completed, Started, Closed }',
      },
    ],
    codeBlock: (cfg) => `
async function featureJobStatusDashboard(stateChangeData) {
  try {
    const existing = await window.zclient.isExist("btn-job-status-dash");
    if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");
    const { success, data: btn } = await createButton({
      id: "btn-job-status-dash",
      icon: "chart-pie",
      type: "BUTTON",
      title: "Job Status Summary",
      page: "job_list",
      location: "BREADCRUMB",
    });
    if (!success) return;
    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-jsd-load", type: "TOAST",
        message: "Fetching status counts...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const res = await window.zclient.request({
          url: "${val(cfg, 'statusCountWebhook')}",
          type: "GET",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: {},
        });
        loader?.invoke("ui.close");
        const counts = res?.data || res || {};
        const statuses = ["Open", "Vendor Rejected", "Vendor Scheduled", "Completed", "Started", "Closed"];
        const rows = statuses.map(s => \`
          <tr style="border-bottom:1px solid #eee">
            <td style="padding:10px 16px">\${s}</td>
            <td style="padding:10px 16px;text-align:right;font-weight:600">\${counts[s] ?? counts[s.toLowerCase().replace(/ /g,"_")] ?? "—"}</td>
          </tr>\`).join("");
        const html = \`<div style="padding:16px;font-family:sans-serif">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f5f5f5">
              <th style="padding:10px 16px;text-align:left">Status</th>
              <th style="padding:10px 16px;text-align:right">Count</th>
            </tr></thead>
            <tbody>\${rows}</tbody>
          </table>
        </div>\`;
        const { data: modal } = await createModal({
          id: "modal-jsd-" + genUUID(),
          type: "MODAL",
          options: {
            title: "Job Status Summary",
            position: "center",
            dataType: "HTML",
            size: "md",
            html,
            actions: { cancel: { label: "Close" }, confirm: { hide: true } },
          },
        });
        modal?.invoke("ui.open");
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-jsd-err", type: "TOAST",
          message: "Failed to fetch status counts",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureJobStatusDashboard", "Failed", "job_list", "error");
  }
}`,
  },

  // ── F-42 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-42',
    label: 'Asset Report Download (Gillette Pepsi)',
    description:
      'Fetches asset details, renders "Save Asset Report" button on asset_details, and downloads XLSX on click via a Gillette Pepsi-specific webhook.',
    pages: ['asset_details'],
    fnName: 'featureAssetReportGillette',
    requiredConfig: [
      {
        key: 'assetReportWebhookGillette',
        label: 'Asset Report Webhook URL (Gillette)',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { asset_uid } → XLSX blob',
      },
      {
        key: 'internalApiUrlGillette',
        label: 'Internal API URL (Gillette)',
        type: 'url',
        placeholder: 'https://...',
        hint: 'Base URL for Gillette internal API',
      },
    ],
    codeBlock: (cfg) => `
async function featureAssetReportGillette(stateChangeData) {
  try {
    const existing = await window.zclient.isExist("btn-asset-report-gillette");
    if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");
    const { success, data: btn } = await createButton({
      id: "btn-asset-report-gillette",
      icon: "file-spreadsheet",
      type: "BUTTON",
      title: "Save Asset Report",
      page: "asset_details",
      location: "BREADCRUMB",
      position: "left",
    });
    if (!success) return;
    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-asset-rep-gill", type: "TOAST",
        message: "Generating asset report...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const assetUid = stateChangeData.id;
        const res = await window.zclient.request({
          url: "${val(cfg, 'assetReportWebhookGillette')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: { asset_uid: assetUid },
        });
        loader?.invoke("ui.close");
        const blob = new Blob([res?.data || res], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "Asset_" + assetUid + "_report.xlsx";
        a.click();
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-asset-rep-gill-err", type: "TOAST",
          message: "Failed to generate asset report",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureAssetReportGillette", "Failed", "asset_details", "error");
  }
}`,
  },

  // ── F-43 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-43',
    label: 'QBD Accounting Report Generation',
    description:
      'Renders "Generate QBD report (csv)" button on report_list. Opens modal with from_date, to_date, search_type. '
      + 'Validates date range. GETs webhook; if 200 downloads .iif file, otherwise shows email notification toast.',
    pages: ['report_list'],
    fnName: 'featureQBDReport',
    requiredConfig: [
      {
        key: 'qbdWebhook',
        label: 'QBD Report Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'GET ?from_date=&to_date=&search_type=&userEmail= → .iif file or email',
      },
    ],
    codeBlock: (cfg) => `
async function featureQBDReport(stateChangeData) {
  try {
    const existing = await window.zclient.isExist("btn-qbd-report");
    if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");
    const { success, data: btn } = await createButton({
      id: "btn-qbd-report",
      icon: "file-text",
      type: "BUTTON",
      title: "Generate QBD report (csv)",
      page: "report_list",
      location: "BREADCRUMB",
    });
    if (!success) return;
    let selectedFrom = "";
    let selectedTo   = "";
    let selectedType = "Schedule Date";
    btn.on("click", async () => {
      const { data: modal } = await createModal({
        id: "modal-qbd-" + genUUID(),
        type: "MODAL",
        options: {
          title: "QBD Report",
          position: "center",
          dataType: "FORM",
          size: "md",
          fields: [
            { label: "From Date",    type: "DATE",        id: "from_date",   default: "", field_options: { is_required: true } },
            { label: "To Date",      type: "DATE",        id: "to_date",     default: "", field_options: { is_required: true } },
            { label: "Search Type",  type: "SINGLE_ITEM", id: "search_type", default: "Schedule Date", values: ["Schedule Date", "Created At"], field_options: { is_required: true } },
          ],
          actions: { confirm: { label: "Generate" }, cancel: {} },
        },
      });
      if (!modal) return;
      modal.invoke("ui.open");
      modal.on("changes", async (data) => {
        if (data.from_date)   selectedFrom = data.from_date;
        if (data.to_date)     selectedTo   = data.to_date;
        if (data.search_type) selectedType = data.search_type;
      });
      modal.on("confirm", async (data) => {
        const from = data.from_date   || selectedFrom;
        const to   = data.to_date     || selectedTo;
        const type = data.search_type || selectedType;
        if (!from || !to || new Date(from) > new Date(to)) {
          await createToast({ id: "toast-qbd-date-err", type: "TOAST",
            message: "From date must be before To date",
            options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
          return;
        }
        modal.invoke("ui.close");
        const searchTypeMap = { "Schedule Date": "scheduled_date_range", "Created At": "created_at" };
        const user = JSON.parse(localStorage.getItem("user") || "{}");
        const url = "${val(cfg, 'qbdWebhook')}?from_date=" + from + "&to_date=" + to
          + "&search_type=" + (searchTypeMap[type] || "scheduled_date_range")
          + "&userEmail=" + encodeURIComponent(user.email || "");
        const loader = (await createToast({ id: "toast-qbd-load", type: "TOAST",
          message: "Generating QBD report...",
          options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
        })).data;
        try {
          const res = await window.zclient.request({ url, type: "GET", cors: false, externalRequest: true, data: {} });
          loader?.invoke("ui.close");
          if (res?.status === 200 || res?.data) {
            const blob = new Blob([res.data || res], { type: "application/octet-stream" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "QBD Report " + from + " to " + to + ".iif";
            a.click();
          } else {
            await createToast({ id: "toast-qbd-email", type: "TOAST",
              message: "Report will be sent to your email",
              options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
          }
        } catch (e) {
          loader?.invoke("ui.close");
          await createToast({ id: "toast-qbd-err", type: "TOAST",
            message: "Report generation failed",
            options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
        }
      });
    });
  } catch (e) {
    createLog("featureQBDReport", "Failed", "report_list", "error");
  }
}`,
  },

  // ── F-44 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-44',
    label: 'Job Profitability Chart (Webhook HTML)',
    description:
      'Renders "Show Job Profitability" button on job_details. GETs webhook with jobUid, extracts response.body.html, and injects into an XL HTML modal.',
    pages: ['job_details'],
    fnName: 'featureJobProfitabilityChart',
    requiredConfig: [
      {
        key: 'profitabilityChartWebhook',
        label: 'Profitability Chart Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'GET ?jobUid=... → { body: { html: "..." } }',
      },
    ],
    codeBlock: (cfg) => `
async function featureJobProfitabilityChart(stateChangeData) {
  try {
    const { success, data: btn } = await createButton({
      id: "btn-job-profitability-chart",
      icon: "chart-line",
      type: "BUTTON",
      title: "Show Job Profitability",
      page: "job_details",
      location: "BREADCRUMB",
    });
    if (!success) return;
    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-profit-load", type: "TOAST",
        message: "Loading profitability data...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const jobUid = stateChangeData.id;
        const res = await window.zclient.request({
          url: "${val(cfg, 'profitabilityChartWebhook')}?jobUid=" + jobUid,
          type: "GET",
          cors: false,
          externalRequest: true,
          data: {},
        });
        loader?.invoke("ui.close");
        const html = res?.body?.html || res?.data?.body?.html || res?.html || "<p>No chart data available</p>";
        const { data: modal } = await createModal({
          id: "modal-profit-" + genUUID(),
          type: "MODAL",
          options: {
            title: "Job Profitability",
            position: "center",
            dataType: "HTML",
            size: "xl",
            html,
            actions: { cancel: { label: "Close" }, confirm: { hide: true } },
          },
        });
        modal?.invoke("ui.open");
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-profit-err", type: "TOAST",
          message: "Failed to load profitability data",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureJobProfitabilityChart", "Failed", "job_details", "error");
  }
}`,
  },

  // ── F-45 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-45',
    label: 'Job Template Manager',
    description:
      'Renders "Template" button on job_details. Validates job has an org, fetches templates by category, '
      + 'auto-applies if only one, or shows dropdown modal. Updates job custom fields and refreshes page.',
    pages: ['job_details'],
    fnName: 'featureJobTemplateManager',
    requiredConfig: [
      {
        key: 'fetchTemplatesWebhook',
        label: 'Fetch Templates Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { organization, job_category } → [{ templateName, typeOfWork }]',
      },
      {
        key: 'internalApiUrl',
        label: 'Internal API Base URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'Used for PUT /jobs/{uid} to apply template custom fields',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'text',
        placeholder: 'your-api-key',
        hint: 'Authorization key for internal API calls',
      },
    ],
    codeBlock: (cfg) => `
async function featureJobTemplateManager(stateChangeData) {
  try {
    const { success, data: btn } = await createButton({
      id: "btn-job-template",
      icon: "template",
      type: "BUTTON",
      title: "Template",
      page: "job_details",
      location: "BREADCRUMB",
    });
    if (!success) return;
    btn.on("click", async () => {
      const jobResp = await window.zclient.get("job");
      if (!jobResp.success) return;
      const job = jobResp.response;
      if (!job.organization) {
        await createToast({ id: "toast-tpl-no-org", type: "TOAST",
          message: "Job must have an organization to use templates",
          options: { autoClose: true, position: "top-center", type: "warning", dismissible: true } });
        return;
      }
      const loader = (await createToast({ id: "toast-tpl-load", type: "TOAST",
        message: "Fetching Templates...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const res = await window.zclient.request({
          url: "${val(cfg, 'fetchTemplatesWebhook')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: { organization: job.organization, job_category: job.job_category },
        });
        loader?.invoke("ui.close");
        const templates = res?.data || res || [];
        if (!templates.length) {
          await createToast({ id: "toast-tpl-none", type: "TOAST",
            message: "No templates found for this job category",
            options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
          return;
        }
        const applyTemplate = async (template) => {
          const customFields = (job.custom_fields || []).map(cf => {
            if (cf.label === "Template")     return { ...cf, value: template.templateName };
            if (cf.label === "Type of Work") return { ...cf, value: template.typeOfWork };
            return cf;
          });
          await window.zclient.request({
            url: "${val(cfg, 'internalApiUrl')}/jobs/" + job.job_uid,
            type: "PUT",
            contentType: "application/json",
            cors: false,
            externalRequest: true,
            data: { custom_fields: customFields },
          });
          await createToast({ id: "toast-tpl-ok", type: "TOAST",
            message: "Template applied: " + template.templateName,
            options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
          window.zclient.invoke("page.refresh");
        };
        if (templates.length === 1) {
          await applyTemplate(templates[0]);
          return;
        }
        const { data: modal } = await createModal({
          id: "modal-template-" + genUUID(),
          type: "MODAL",
          options: {
            title: "Select Template",
            position: "center",
            dataType: "FORM",
            size: "md",
            fields: [{
              label: "Template",
              type: "SINGLE_ITEM",
              id: "selected_template",
              default: "",
              values: templates.map(t => t.templateName),
              field_options: { is_required: true },
            }],
            actions: { confirm: { label: "Apply" }, cancel: {} },
          },
        });
        if (!modal) return;
        modal.invoke("ui.open");
        modal.on("confirm", async (data) => {
          const chosen = templates.find(t => t.templateName === data.selected_template);
          if (!chosen) return;
          modal.invoke("ui.close");
          await applyTemplate(chosen);
        });
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-tpl-err", type: "TOAST",
          message: "Failed to fetch templates",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureJobTemplateManager", "Failed", "job_details", "error");
  }
}`,
  },

  // ── F-46 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-46',
    label: 'Timesheet Report with Date Range Validation',
    description:
      '"Timesheet Report" button on timesheet_list. Opens modal with start_date/end_date. '
      + 'Validates start ≤ end AND range ≤ 7 days. GETs webhook and shows success toast with email address.',
    pages: ['timesheet_list'],
    fnName: 'featureTimesheetReportValidated',
    requiredConfig: [
      {
        key: 'timesheetValidatedWebhook',
        label: 'Timesheet Report Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'GET ?start_date=&end_date=&email=',
      },
    ],
    codeBlock: (cfg) => `
async function featureTimesheetReportValidated(stateChangeData) {
  try {
    const existing = await window.zclient.isExist("btn-ts-report-validated");
    if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");
    const { success, data: btn } = await createButton({
      id: "btn-ts-report-validated",
      icon: "clock-check",
      type: "BUTTON",
      title: "Timesheet Report",
      page: "timesheet_list",
      location: "BREADCRUMB",
      position: "left",
    });
    if (!success) return;
    let selectedStart = "";
    let selectedEnd   = "";
    btn.on("click", async () => {
      const { data: modal } = await createModal({
        id: "modal-ts-report-" + genUUID(),
        type: "MODAL",
        options: {
          title: "Timesheet Report",
          position: "center",
          dataType: "FORM",
          size: "md",
          fields: [
            { label: "Start Date", type: "DATE", id: "start_date", default: "", field_options: { is_required: true } },
            { label: "End Date",   type: "DATE", id: "end_date",   default: "", field_options: { is_required: true } },
          ],
          actions: { confirm: { label: "Generate" }, cancel: {} },
        },
      });
      if (!modal) return;
      modal.invoke("ui.open");
      modal.on("changes", async (data) => {
        if (data.start_date) selectedStart = data.start_date;
        if (data.end_date)   selectedEnd   = data.end_date;
      });
      modal.on("confirm", async (data) => {
        const start = data.start_date || selectedStart;
        const end   = data.end_date   || selectedEnd;
        if (!start || !end) return;
        const startD = new Date(start);
        const endD   = new Date(end);
        if (startD > endD) {
          await createToast({ id: "toast-ts-val-order", type: "TOAST",
            message: "Start date must be before End date",
            options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
          return;
        }
        const diffDays = (endD - startD) / (1000 * 60 * 60 * 24);
        if (diffDays > 7) {
          await createToast({ id: "toast-ts-val-range", type: "TOAST",
            message: "Date range cannot exceed 7 days",
            options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
          return;
        }
        modal.invoke("ui.close");
        const user = JSON.parse(localStorage.getItem("user") || "{}");
        await window.zclient.request({
          url: "${val(cfg, 'timesheetValidatedWebhook')}?start_date=" + start + "&end_date=" + end + "&email=" + encodeURIComponent(user.email || ""),
          type: "GET",
          cors: false,
          externalRequest: true,
          data: {},
        });
        await createToast({ id: "toast-ts-val-ok", type: "TOAST",
          message: "Report generation initiated and will be sent to mail: " + (user.email || ""),
          options: { autoClose: true, position: "top-center", type: "success", dismissible: true } });
      });
    });
  } catch (e) {
    createLog("featureTimesheetReportValidated", "Failed", "timesheet_list", "error");
  }
}`,
  },

  // ── F-47 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-47',
    label: 'Products Report Download (XLSX)',
    description:
      '"Download Products Report" button on product_list breadcrumb. Direct download on click — GET webhook returns XLSX blob. No modal.',
    pages: ['product_list'],
    fnName: 'featureProductsReport',
    requiredConfig: [
      {
        key: 'productsReportWebhook',
        label: 'Products Report Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'GET → XLSX blob',
      },
      {
        key: 'downloadFilename',
        label: 'Download Filename',
        type: 'text',
        default: 'Products_transaction_report.xlsx',
        placeholder: 'Products_transaction_report.xlsx',
        hint: 'Filename for the downloaded XLSX file',
      },
    ],
    codeBlock: (cfg) => `
async function featureProductsReport(stateChangeData) {
  try {
    const existing = await window.zclient.isExist("btn-products-report");
    if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");
    const { success, data: btn } = await createButton({
      id: "btn-products-report",
      icon: "file-download",
      type: "BUTTON",
      title: "Download Products Report",
      page: "product_list",
      location: "BREADCRUMB",
      position: "left",
    });
    if (!success) return;
    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-prod-rep-load", type: "TOAST",
        message: "Downloading report...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const res = await window.zclient.request({
          url: "${val(cfg, 'productsReportWebhook')}",
          type: "GET",
          cors: false,
          externalRequest: true,
          data: {},
        });
        loader?.invoke("ui.close");
        const blob = new Blob([res?.data || res], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "${val(cfg, 'downloadFilename', 'Products_transaction_report.xlsx')}";
        a.click();
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-prod-rep-err", type: "TOAST",
          message: "Download failed",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureProductsReport", "Failed", "product_list", "error");
  }
}`,
  },

  // ── F-48 ───────────────────────────────────────────────────────────────────

  {
    id: 'F-48',
    label: 'Asset Report Download (XLSX)',
    description:
      '"Save Asset Report" button on asset_details. Deduplicates on each page visit. '
      + 'Fetches asset details to get asset_name/asset_code, then on click POSTs to webhook and downloads response as XLSX.',
    pages: ['asset_details'],
    fnName: 'featureAssetReport',
    requiredConfig: [
      {
        key: 'assetReportWebhook',
        label: 'Asset Report Webhook URL',
        type: 'url',
        placeholder: 'https://...',
        hint: 'POST { asset_uid } → XLSX blob',
      },
    ],
    codeBlock: (cfg) => `
async function featureAssetReport(stateChangeData) {
  try {
    const existing = await window.zclient.isExist("btn-asset-report");
    if (existing?.uid) window.zclient.instance(existing.uid).invoke("ui.remove");
    const assetUid = stateChangeData.id;
    const { success, data: btn } = await createButton({
      id: "btn-asset-report",
      icon: "file-spreadsheet",
      type: "BUTTON",
      title: "Save Asset Report",
      page: "asset_details",
      location: "BREADCRUMB",
      position: "left",
    });
    if (!success) return;
    btn.on("click", async () => {
      const loader = (await createToast({ id: "toast-asset-load", type: "TOAST",
        message: "Generating asset report...",
        options: { autoClose: false, position: "top-center", type: "loading", dismissible: false },
      })).data;
      try {
        const assetResp = await window.zclient.get("asset");
        const assetName = assetResp?.response?.asset_name || assetUid;
        const assetCode = assetResp?.response?.asset_code || assetUid;
        const res = await window.zclient.request({
          url: "${val(cfg, 'assetReportWebhook')}",
          type: "POST",
          contentType: "application/json",
          cors: false,
          externalRequest: true,
          data: { asset_uid: assetUid },
        });
        loader?.invoke("ui.close");
        const blob = new Blob([res?.data || res], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "Asset_" + assetCode + "_" + assetName + "_report.xlsx";
        a.click();
      } catch (e) {
        loader?.invoke("ui.close");
        await createToast({ id: "toast-asset-err", type: "TOAST",
          message: "Failed to generate asset report",
          options: { autoClose: true, position: "top-center", type: "error", dismissible: true } });
      }
    });
  } catch (e) {
    createLog("featureAssetReport", "Failed", "asset_details", "error");
  }
}`,
  },
];
