const state = { employees: [], data: null };
const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(value || 0));
const fields = (form) => Object.fromEntries(new FormData(form));
const actorId = () => $("#actor").value;

function message(text, type = "") { const box = $("#notice"); box.textContent = text; box.className = `notice ${type}`; }
async function api(path, options = {}) { const response = await fetch(`/api${path}`, { headers: { "Content-Type": "application/json" }, ...options }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Request failed."); return result; }

function projectLines(project) { return [["Approved income", project.income], ["Commission expense", -project.commissions], ["Allocated expenses", -project.expenses], ["Result", project.result]].map(([label, value]) => `<div class="project-line"><span>${label}</span><strong>${money(value)}</strong></div>`).join(""); }
function renderDashboard(d) {
  $("#dashboard-section").classList.toggle("hidden", !d); if (!d) return;
  const c = d.company;
  $("#counts").textContent = `${d.pendingSales} pending sale${d.pendingSales === 1 ? "" : "s"} · ${d.awaitingExpenses} awaiting allocation`;
  $("#metrics").innerHTML = [["Approved income", c.income, ""], ["Commission expense", -c.commissions, ""], ["All recorded expenses", -c.expenses, ""], ["Company result", c.result, c.result >= 0 ? "positive" : "negative"]].map(([label, value, klass]) => `<div class="metric ${klass}"><span>${label}</span><strong>${money(value)}</strong></div>`).join("");
  $("#project-a").innerHTML = projectLines(d.projects.A); $("#project-b").innerHTML = projectLines(d.projects.B);
  $("#commissions").innerHTML = [["Richard", d.people.richard], ["Anastasia", d.people.anastasia], ["Jean-Claude", d.people.jean_claude], ["Company overhead", -c.overhead], ["Awaiting allocation", -c.awaiting]].map(([name, value]) => `<div><span>${name}</span><strong>${money(value)}</strong></div>`).join("");
}
function statusClass(value) { return value?.startsWith("Synced") ? "synced" : "pending"; }
function recordCard(kind, row) {
  const primary = kind === "sale" ? `${row.customer} · Project ${row.project}` : `${row.category} · proposed ${row.proposed_allocation}`;
  const status = `${row.status} · ${row.sync_status || "Sync pending"}`;
  const retry = actorId() === "svetlana" && (!row.sync_status?.startsWith("Synced") || row.decision_notification_status === "Failed") ? `<button class="retry" data-retry="${kind}" data-ref="${row.reference}" data-notification="${row.decision_notification_status === "Failed"}">Retry ${row.decision_notification_status === "Failed" ? "sync and notification" : "sync"}</button>` : "";
  return `<article class="record"><div><strong>${row.reference}</strong><small>${kind === "sale" ? "Sale" : "Expense"}</small></div><div><span>${primary}</span><small>${row.description}</small><small>${status}</small></div><div><strong>${money(row.amount)}</strong><br>${retry}</div></article>`;
}
function renderRecords(data) { $("#records").innerHTML = [...data.sales.map((row) => recordCard("sale", row)), ...data.expenses.map((row) => recordCard("expense", row))].join("") || "<p>No saved transactions yet.</p>"; }
function renderManager(data) {
  const manager = actorId() === "svetlana"; $("#manager").classList.toggle("hidden", !manager); if (!manager) return;
  const pending = $("#pending"); pending.innerHTML = "";
  for (const sale of data.sales.filter((row) => row.status === "Pending approval")) {
    const node = $("#sale-approval").content.firstElementChild.cloneNode(true); node.querySelector("h3").textContent = `Approve ${sale.reference}`; node.querySelector(".details").textContent = `${sale.customer}, Project ${sale.project}, ${money(sale.amount)}. Proposed: ${sale.proposed_richard}% / ${sale.proposed_anastasia}% / ${sale.proposed_jean_claude}%.`; ["richard", "anastasia", "jean_claude"].forEach((name) => node.querySelector(`[name=${name}]`).value = sale[`proposed_${name}`]); node.querySelector("form").addEventListener("submit", async (event) => { event.preventDefault(); await request("/sales/approve", { actorId: actorId(), reference: sale.reference, ...fields(event.target) }); }); pending.append(node);
  }
  for (const expense of data.expenses.filter((row) => row.status === "Awaiting allocation")) {
    const node = $("#expense-approval").content.firstElementChild.cloneNode(true); node.querySelector("h3").textContent = `Allocate ${expense.reference}`; node.querySelector(".details").textContent = `${expense.description}, ${money(expense.amount)}. Proposed: ${expense.proposed_allocation}.`; node.querySelector("select").value = expense.proposed_allocation; node.querySelector("form").addEventListener("submit", async (event) => { event.preventDefault(); await request("/expenses/allocate", { actorId: actorId(), reference: expense.reference, ...fields(event.target) }); }); pending.append(node);
  }
  if (!pending.children.length) pending.innerHTML = "<p>No pending manager decisions.</p>";
}
function permissions() { const current = state.employees.find((employee) => employee.id === actorId()); $("#sale-panel").classList.toggle("hidden", current?.role !== "sales"); $("#expense-panel").classList.toggle("hidden", current?.role !== "expense_reporter"); }
function render() { if (!state.data) return; permissions(); renderDashboard(state.data.dashboard); renderManager(state.data); renderRecords(state.data); }
async function load() {
  try { const employees = await api("/employees"); state.employees = employees; $("#setup").classList.add("hidden"); const select = $("#actor"); const previous = select.value; select.innerHTML = employees.map((employee) => `<option value="${employee.id}">${employee.name}</option>`).join(""); select.value = previous || "svetlana"; $("#link-employee").innerHTML = employees.map((employee) => `<option value="${employee.id}">${employee.name}</option>`).join(""); state.data = await api(`/dashboard?actorId=${encodeURIComponent(actorId())}`); render(); message("Records loaded.", "good"); }
  catch (error) { $("#setup").classList.remove("hidden"); message(error.message, "error"); }
}
async function request(path, payload) { try { const result = await api(path, { method: "POST", body: JSON.stringify(payload) }); message(result.message || "Saved.", "good"); await load(); } catch (error) { message(error.message, "error"); } }

$("#sale-form").addEventListener("submit", (event) => { event.preventDefault(); request("/sales", { actorId: actorId(), ...fields(event.target) }); });
$("#expense-form").addEventListener("submit", (event) => { event.preventDefault(); request("/expenses", { actorId: actorId(), ...fields(event.target) }); });
$("#setup-form").addEventListener("submit", (event) => { event.preventDefault(); request("/setup", fields(event.target)); });
$("#link-form").addEventListener("submit", (event) => { event.preventDefault(); request("/employees/link", { actorId: actorId(), ...fields(event.target) }); });
$("#actor").addEventListener("change", load); $("#refresh").addEventListener("click", load);
$("#records").addEventListener("click", (event) => { const button = event.target.closest("[data-retry]"); if (button) request("/retry", { actorId: actorId(), kind: button.dataset.retry, reference: button.dataset.ref, retryNotification: button.dataset.notification === "true" }); });
load();
