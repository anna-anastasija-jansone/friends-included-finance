"use strict";

const crypto = require("crypto");
const { validateReference, validateAmount, validateSplit, calculateCommissions, dashboard } = require("../lib/finance");

const ROSTER = [
  { id: "svetlana", name: "Svetlana de Monte Carlo", role: "manager" },
  { id: "richard", name: "Richard Call Me Dick Darling", role: "sales" },
  { id: "anastasia", name: "Anastasia Ferrari", role: "sales" },
  { id: "jean_claude", name: "Jean-Claude Berzins", role: "sales" },
  { id: "kevin", name: "Kevin von Whatever", role: "expense_reporter" }
];

function config() {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing server configuration: ${missing.join(", ")}.`);
  return { url: process.env.SUPABASE_URL.replace(/\/$/, ""), key: process.env.SUPABASE_SERVICE_ROLE_KEY };
}

async function db(path, options = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(options.headers || {}) }
  });
  const text = await response.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.message || body?.hint || `Supabase request failed (${response.status}).`);
  return body;
}

const getRows = (table, filter = "") => db(`${table}?select=*&${filter}`.replace(/&$/, ""));
const one = async (table, reference) => { const rows = await getRows(table, `reference=eq.${encodeURIComponent(reference)}`); return rows[0] || null; };
const patch = (table, reference, values) => db(`${table}?reference=eq.${encodeURIComponent(reference)}`, { method: "PATCH", body: JSON.stringify(values) });

function roleAllowed(employee, action) {
  if (!employee) return false;
  return (action === "sale" && employee.role === "sales") || (action === "expense" && employee.role === "expense_reporter") || (action === "manager" && employee.role === "manager");
}

async function employeeById(id) {
  const rows = await getRows("employees", `id=eq.${encodeURIComponent(id)}`);
  return rows[0] || null;
}

async function getActor(id, action) {
  const employee = await employeeById(id);
  if (!roleAllowed(employee, action)) throw new Error("This role is not allowed to perform that action.");
  return employee;
}

function saleInput(input) {
  const split = validateSplit({ richard: input.richard, anastasia: input.anastasia, jean_claude: input.jean_claude });
  const project = input.project;
  if (!["A", "B"].includes(project)) throw new Error("Project must be A or B.");
  if (!String(input.customer || "").trim() || !String(input.description || "").trim()) throw new Error("Customer and description are required.");
  return { reference: validateReference(input.reference, "S"), customer: input.customer.trim(), project, description: input.description.trim(), amount: validateAmount(input.amount), ...split };
}

function expenseInput(input) {
  const category = input.category;
  const allocation = input.proposed_allocation;
  if (!["Materials", "Travel", "Other"].includes(category)) throw new Error("Choose Materials, Travel, or Other.");
  if (!["A", "B", "Company overhead"].includes(allocation)) throw new Error("Choose A, B, or Company overhead.");
  if (!String(input.description || "").trim()) throw new Error("Description is required.");
  return { reference: validateReference(input.reference, "E"), description: input.description.trim(), category, proposed_allocation: allocation, amount: validateAmount(input.amount) };
}

async function saveSale(actor, input, notificationChatId) {
  const sale = saleInput(input);
  const record = {
    reference: sale.reference, submitted_by: actor.id, notification_chat_id: notificationChatId || actor.telegram_chat_id || null,
    customer: sale.customer, project: sale.project, description: sale.description, amount: sale.amount,
    proposed_richard: sale.richard, proposed_anastasia: sale.anastasia, proposed_jean_claude: sale.jean_claude,
    status: "Pending approval", sync_status: "Sync pending"
  };
  await db("sales", { method: "POST", body: JSON.stringify(record) });
  return record;
}

async function saveExpense(actor, input, notificationChatId) {
  const expense = expenseInput(input);
  const overhead = expense.proposed_allocation === "Company overhead";
  const record = {
    reference: expense.reference, submitted_by: actor.id, notification_chat_id: notificationChatId || actor.telegram_chat_id || null,
    description: expense.description, category: expense.category, amount: expense.amount, proposed_allocation: expense.proposed_allocation,
    final_allocation: overhead ? "Company overhead" : null, status: overhead ? "Allocated" : "Awaiting allocation", sync_status: "Sync pending"
  };
  await db("expenses", { method: "POST", body: JSON.stringify(record) });
  return record;
}

function b64url(value) { return Buffer.from(value).toString("base64url"); }
async function googleToken() {
  const service = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
  if (!service.client_email || !service.private_key) throw new Error("Google Sheets credentials are not configured.");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: service.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).end().sign(service.private_key).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }) });
  const token = await response.json();
  if (!response.ok) throw new Error(token.error_description || "Could not authorize Google Sheets.");
  return token.access_token;
}

function saleRow(s) { return [s.reference, s.submitted_at || new Date().toISOString(), s.submitted_by, s.customer, s.project, s.description, s.amount, s.proposed_richard, s.proposed_anastasia, s.proposed_jean_claude, s.approved_richard ?? "", s.approved_anastasia ?? "", s.approved_jean_claude ?? "", s.commission_richard || 0, s.commission_anastasia || 0, s.commission_jean_claude || 0, s.status]; }
function expenseRow(e) { return [e.reference, e.submitted_at || new Date().toISOString(), e.submitted_by, e.description, e.category, e.amount, e.proposed_allocation, e.final_allocation || "", e.status]; }
const HEADERS = { Sales: ["Reference", "Submission time", "Salesperson", "Customer", "Project", "Description", "Amount", "Proposed Richard %", "Proposed Anastasia %", "Proposed Jean-Claude %", "Approved Richard %", "Approved Anastasia %", "Approved Jean-Claude %", "Richard commission", "Anastasia commission", "Jean-Claude commission", "Status"], Expenses: ["Reference", "Submission time", "Reporter", "Description", "Category", "Amount", "Proposed allocation", "Final allocation", "Status"] };

async function sheetsFetch(path, options = {}) {
  if (!process.env.GOOGLE_SHEETS_ID) throw new Error("Google Sheets ID is not configured.");
  const token = await googleToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_ID}/${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message || "Google Sheets update failed.");
  return json;
}

async function syncSheet(kind, record) {
  const tab = kind === "sale" ? "Sales" : "Expenses";
  const row = kind === "sale" ? saleRow(record) : expenseRow(record);
  const values = (await sheetsFetch(`values/${encodeURIComponent(tab)}!A:Z`)).values || [];
  if (!values.length) await sheetsFetch(`values/${encodeURIComponent(tab)}!A1:Z1?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [HEADERS[tab]] }) });
  const found = values.findIndex((cells, index) => index > 0 && cells[0] === record.reference);
  if (found > 0) await sheetsFetch(`values/${encodeURIComponent(tab)}!A${found + 1}:Z${found + 1}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [row] }) });
  else await sheetsFetch(`values/${encodeURIComponent(tab)}!A:Z:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: [row] }) });
}

async function syncRecord(kind, record) {
  try { await syncSheet(kind, record); await patch(kind === "sale" ? "sales" : "expenses", record.reference, { sync_status: "Synced", updated_at: new Date().toISOString() }); return "Synced"; }
  catch (error) { await patch(kind === "sale" ? "sales" : "expenses", record.reference, { sync_status: `Sync pending: ${error.message}`, updated_at: new Date().toISOString() }); return `Sync pending: ${error.message}`; }
}

async function telegram(chatId, text) {
  if (!chatId) throw new Error("No Telegram recipient linked.");
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram bot token is not configured.");
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || "Telegram delivery failed.");
}

function saleDecisionText(sale, changed) { return `Sale ${sale.reference} approved${changed ? " - commission split changed" : ""}. Sale EUR ${Number(sale.amount).toFixed(2)}; total commission EUR ${(Number(sale.commission_richard) + Number(sale.commission_anastasia) + Number(sale.commission_jean_claude)).toFixed(2)}. Richard: ${sale.proposed_richard}% -> ${sale.approved_richard}% (EUR ${Number(sale.commission_richard).toFixed(2)}). Anastasia: ${sale.proposed_anastasia}% -> ${sale.approved_anastasia}% (EUR ${Number(sale.commission_anastasia).toFixed(2)}). Jean-Claude: ${sale.proposed_jean_claude}% -> ${sale.approved_jean_claude}% (EUR ${Number(sale.commission_jean_claude).toFixed(2)}).`; }
function expenseDecisionText(expense, changed) { return `Expense ${expense.reference}${changed ? " - allocation changed" : " allocated"}. EUR ${Number(expense.amount).toFixed(2)}: ${expense.description}. Proposed: ${expense.proposed_allocation}. Approved: ${expense.final_allocation}.`; }

async function notifyDecision(kind, record) {
  const changed = kind === "sale" ? ["richard", "anastasia", "jean_claude"].some((person) => Number(record[`proposed_${person}`]) !== Number(record[`approved_${person}`])) : record.proposed_allocation !== record.final_allocation;
  try { await telegram(record.notification_chat_id, kind === "sale" ? saleDecisionText(record, changed) : expenseDecisionText(record, changed)); await patch(kind === "sale" ? "sales" : "expenses", record.reference, { decision_notification_status: "Sent", decision_notification_error: null }); return "Sent"; }
  catch (error) { await patch(kind === "sale" ? "sales" : "expenses", record.reference, { decision_notification_status: "Failed", decision_notification_error: error.message }); return `Failed: ${error.message}`; }
}

async function approveSale(actorId, reference, split) {
  await getActor(actorId, "manager");
  const sale = await one("sales", reference);
  if (!sale) throw new Error("Sale not found.");
  if (sale.status === "Approved") return { record: sale, message: "Already approved; totals were unchanged." };
  const approved = validateSplit(split);
  const commission = calculateCommissions(sale.amount, approved);
  const [record] = await patch("sales", reference, { approved_richard: approved.richard, approved_anastasia: approved.anastasia, approved_jean_claude: approved.jean_claude, commission_richard: commission.richard, commission_anastasia: commission.anastasia, commission_jean_claude: commission.jean_claude, status: "Approved", updated_at: new Date().toISOString() });
  await syncRecord("sale", record); await notifyDecision("sale", record);
  return { record, message: "Sale approved." };
}

async function allocateExpense(actorId, reference, allocation) {
  await getActor(actorId, "manager");
  if (!["A", "B", "Company overhead"].includes(allocation)) throw new Error("Choose a valid final allocation.");
  const expense = await one("expenses", reference);
  if (!expense) throw new Error("Expense not found.");
  if (expense.status === "Allocated") return { record: expense, message: "Already allocated; totals were unchanged." };
  const [record] = await patch("expenses", reference, { final_allocation: allocation, status: "Allocated", updated_at: new Date().toISOString() });
  await syncRecord("expense", record); await notifyDecision("expense", record);
  return { record, message: "Expense allocated." };
}

async function completeSubmission(kind, actor, input, chatId) {
  const record = kind === "sale" ? await saveSale(actor, input, chatId) : await saveExpense(actor, input, chatId);
  const sync = await syncRecord(kind, record);
  const status = kind === "sale" ? "Pending approval" : record.status;
  return { record, message: `${record.reference} saved. EUR ${Number(record.amount).toFixed(2)}. ${kind === "sale" ? `Project ${record.project}` : `Proposed allocation: ${record.proposed_allocation}`}. Status: ${status}. ${sync}.` };
}

function send(res, status, data) { res.status(status).json(data); }
async function body(req) { return typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }

async function handleTelegram(req) {
  if (process.env.TELEGRAM_WEBHOOK_SECRET && req.headers["x-telegram-bot-api-secret-token"] !== process.env.TELEGRAM_WEBHOOK_SECRET) throw new Error("Telegram webhook secret did not match.");
  const update = await body(req); const message = update.message;
  if (!message?.text || !message?.from?.id) return { ok: true };
  const rows = await getRows("employees", `telegram_user_id=eq.${message.from.id}`); const actor = rows[0];
  if (!actor) {
    const isStart = message.text.trim().toLowerCase() === "/start";
    const reply = isStart
      ? `Welcome to Friends Included Finance. Your Telegram user ID is ${message.from.id} and your chat ID is ${message.chat.id}. Ask Svetlana to save these values in the website before you submit a transaction.`
      : "Your Telegram account is not linked to a fictional employee. Send /start to see the IDs Svetlana needs to link you.";
    await telegram(message.chat.id, reply);
    return { ok: true };
  }
  try {
    const [command, rest] = message.text.trim().split(/\s+/, 2);
    const p = (rest || "").split("|").map((item) => item.trim()); let result;
    if (command === "/sale") { if (p.length !== 8) throw new Error("Use /sale REF|CUSTOMER|A-or-B|DESCRIPTION|AMOUNT|RICHARD%|ANASTASIA%|JEAN-CLAUDE%."); result = await completeSubmission("sale", await getActor(actor.id, "sale"), { reference: p[0], customer: p[1], project: p[2], description: p[3], amount: p[4], richard: p[5], anastasia: p[6], jean_claude: p[7] }, String(message.chat.id)); }
    else if (command === "/expense") { if (p.length !== 5) throw new Error("Use /expense REF|DESCRIPTION|CATEGORY|AMOUNT|A-B-or-Company overhead."); result = await completeSubmission("expense", await getActor(actor.id, "expense"), { reference: p[0], description: p[1], category: p[2], amount: p[3], proposed_allocation: p[4] }, String(message.chat.id)); }
    else throw new Error("Commands: /sale or /expense. See the website instructions for the exact format.");
    await telegram(message.chat.id, result.message);
  } catch (error) { await telegram(message.chat.id, `Not recorded: ${error.message}`); }
  return { ok: true };
}

module.exports = async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname.replace(/^\/api/, "") || "/";
    if (path === "/telegram" && req.method === "POST") return send(res, 200, await handleTelegram(req));
    if (path === "/setup" && req.method === "POST") { const input = await body(req); if (!process.env.SETUP_SECRET || input.secret !== process.env.SETUP_SECRET) throw new Error("Setup secret is invalid."); for (const employee of ROSTER) { const exists = await employeeById(employee.id); if (!exists) await db("employees", { method: "POST", body: JSON.stringify(employee) }); } return send(res, 200, { message: "Demonstration roster is ready." }); }
    if (path === "/employees" && req.method === "GET") { const rows = await getRows("employees", "order=name.asc"); return send(res, 200, rows.map(({ id, name, role }) => ({ id, name, role }))); }
    if (path === "/dashboard" && req.method === "GET") {
      const actorId = new URL(req.url, "http://localhost").searchParams.get("actorId");
      const actor = await employeeById(actorId);
      if (!actor) throw new Error("Choose a valid demonstration role.");
      const [allSales, allExpenses] = await Promise.all([getRows("sales", "order=submitted_at.desc"), getRows("expenses", "order=submitted_at.desc")]);
      const manager = actor.role === "manager";
      const sales = manager ? allSales : allSales.filter((item) => item.submitted_by === actor.id);
      const expenses = manager ? allExpenses : allExpenses.filter((item) => item.submitted_by === actor.id);
      return send(res, 200, { sales, expenses, dashboard: manager ? dashboard(allSales, allExpenses) : null });
    }
    const input = await body(req);
    if (path === "/sales" && req.method === "POST") { const actor = await getActor(input.actorId, "sale"); return send(res, 201, await completeSubmission("sale", actor, input, null)); }
    if (path === "/expenses" && req.method === "POST") { const actor = await getActor(input.actorId, "expense"); return send(res, 201, await completeSubmission("expense", actor, input, null)); }
    if (path === "/sales/approve" && req.method === "POST") return send(res, 200, await approveSale(input.actorId, input.reference, input));
    if (path === "/expenses/allocate" && req.method === "POST") return send(res, 200, await allocateExpense(input.actorId, input.reference, input.allocation));
    if (path === "/retry" && req.method === "POST") { await getActor(input.actorId, "manager"); const table = input.kind === "sale" ? "sales" : "expenses"; const record = await one(table, input.reference); if (!record) throw new Error("Record not found."); const sync = await syncRecord(input.kind, record); const notification = input.retryNotification ? await notifyDecision(input.kind, record) : null; return send(res, 200, { message: `${sync}${notification ? `; notification ${notification}` : ""}` }); }
    if (path === "/employees/link" && req.method === "POST") { await getActor(input.actorId, "manager"); const employee = await employeeById(input.employeeId); if (!employee) throw new Error("Employee not found."); await db(`employees?id=eq.${encodeURIComponent(input.employeeId)}`, { method: "PATCH", body: JSON.stringify({ telegram_user_id: String(input.telegramUserId), telegram_chat_id: input.telegramChatId ? String(input.telegramChatId) : null }) }); return send(res, 200, { message: "Telegram account link saved." }); }
    return send(res, 404, { error: "Route not found." });
  } catch (error) { return send(res, 400, { error: error.message || "Request failed." }); }
};
