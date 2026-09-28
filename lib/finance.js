"use strict";

const PEOPLE = ["richard", "anastasia", "jean_claude"];

function cents(value) {
  return Math.round(Number(value) * 100);
}

function euros(value) {
  return cents(value) / 100;
}

function money(value) {
  return euros(value).toFixed(2);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateReference(reference, type) {
  assert(typeof reference === "string" && new RegExp(`^${type}[0-9]+$`).test(reference.trim()), `Reference must look like ${type}01.`);
  return reference.trim();
}

function validateAmount(amount) {
  const value = Number(amount);
  assert(Number.isFinite(value) && value > 0, "Amount must be greater than zero.");
  return euros(value);
}

function validateSplit(split) {
  const values = PEOPLE.map((person) => Number(split[person]));
  assert(values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100), "Each commission percentage must be between 0% and 100%.");
  assert(Math.abs(values.reduce((a, b) => a + b, 0) - 100) < 0.00001, "Commission percentages must total exactly 100%.");
  return Object.fromEntries(PEOPLE.map((person, index) => [person, values[index]]));
}

function calculateCommissions(amount, split) {
  const clean = validateSplit(split);
  const pool = Math.round(cents(amount) * 0.1);
  // Start below the exact proportional amounts, then assign every remaining cent
  // to the prescribed largest share. This keeps the pool exact even for €0.05.
  const raw = PEOPLE.map((person) => Math.floor(pool * clean[person] / 100));
  let difference = pool - raw.reduce((a, b) => a + b, 0);
  const recipient = PEOPLE.reduce((winner, person) => clean[person] > clean[winner] ? person : winner, "richard");
  raw[PEOPLE.indexOf(recipient)] += difference;
  difference = pool - raw.reduce((a, b) => a + b, 0);
  assert(difference === 0, "Commission rounding failed.");
  return {
    pool: pool / 100,
    richard: raw[0] / 100,
    anastasia: raw[1] / 100,
    jean_claude: raw[2] / 100
  };
}

function salesTotals(sales) {
  return sales.filter((sale) => sale.status === "Approved").reduce((result, sale) => {
    result.income += Number(sale.amount);
    result.commissions += Number(sale.commission_richard) + Number(sale.commission_anastasia) + Number(sale.commission_jean_claude);
    result.people.richard += Number(sale.commission_richard);
    result.people.anastasia += Number(sale.commission_anastasia);
    result.people.jean_claude += Number(sale.commission_jean_claude);
    return result;
  }, { income: 0, commissions: 0, people: { richard: 0, anastasia: 0, jean_claude: 0 } });
}

function dashboard(sales, expenses) {
  const salesResult = salesTotals(sales);
  const projects = { A: { income: 0, commissions: 0, expenses: 0 }, B: { income: 0, commissions: 0, expenses: 0 } };
  for (const sale of sales.filter((item) => item.status === "Approved")) {
    projects[sale.project].income += Number(sale.amount);
    projects[sale.project].commissions += Number(sale.commission_richard) + Number(sale.commission_anastasia) + Number(sale.commission_jean_claude);
  }
  let overhead = 0;
  let awaiting = 0;
  let expensesTotal = 0;
  for (const expense of expenses) {
    const amount = Number(expense.amount);
    expensesTotal += amount;
    if (expense.status === "Allocated" && (expense.final_allocation === "A" || expense.final_allocation === "B")) projects[expense.final_allocation].expenses += amount;
    if ((expense.status === "Allocated" && expense.final_allocation === "Company overhead") || (expense.status === "Awaiting allocation" && expense.proposed_allocation === "Company overhead")) overhead += amount;
    if (expense.status === "Awaiting allocation" && expense.proposed_allocation !== "Company overhead") awaiting += amount;
  }
  for (const project of Object.values(projects)) project.result = project.income - project.commissions - project.expenses;
  return {
    projects,
    company: { income: salesResult.income, commissions: salesResult.commissions, expenses: expensesTotal, overhead, awaiting, result: salesResult.income - salesResult.commissions - expensesTotal },
    people: salesResult.people,
    pendingSales: sales.filter((item) => item.status === "Pending approval").length,
    awaitingExpenses: expenses.filter((item) => item.status === "Awaiting allocation").length
  };
}

module.exports = { PEOPLE, cents, euros, money, validateReference, validateAmount, validateSplit, calculateCommissions, dashboard };
