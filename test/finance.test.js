"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateCommissions, validateSplit, dashboard } = require("../lib/finance");

test("requires proposed or approved commission shares to total 100%", () => {
  assert.throws(() => validateSplit({ richard: 60, anastasia: 30, jean_claude: 20 }), /total exactly 100/);
});

test("gives a rounding cent to the largest share, then Richard on a tie", () => {
  const result = calculateCommissions(0.15, { richard: 50, anastasia: 50, jean_claude: 0 });
  assert.equal(result.pool, 0.02);
  assert.equal(result.richard, 0.01);
  assert.equal(result.anastasia, 0.01);
  const tie = calculateCommissions(0.05, { richard: 50, anastasia: 50, jean_claude: 0 });
  assert.equal(tie.richard, 0.01);
  assert.equal(tie.anastasia, 0);
});

test("reproduces the supplied cumulative Test 2 dashboard figures", () => {
  const sales = [
    { reference: "S01", status: "Approved", amount: 1000, project: "A", commission_richard: 50, commission_anastasia: 30, commission_jean_claude: 20 },
    { reference: "S02", status: "Approved", amount: 2000, project: "B", commission_richard: 40, commission_anastasia: 80, commission_jean_claude: 80 },
    { reference: "S03", status: "Approved", amount: 1500, project: "A", commission_richard: 30, commission_anastasia: 45, commission_jean_claude: 75 },
    { reference: "S04", status: "Approved", amount: 800, project: "B", commission_richard: 20, commission_anastasia: 20, commission_jean_claude: 40 },
    { reference: "S05", status: "Pending approval", amount: 600, project: "B", commission_richard: 0, commission_anastasia: 0, commission_jean_claude: 0 }
  ];
  const expenses = [
    { reference: "E01", status: "Allocated", amount: 120, final_allocation: "A", proposed_allocation: "A" },
    { reference: "E02", status: "Allocated", amount: 80, final_allocation: "A", proposed_allocation: "B" },
    { reference: "E03", status: "Allocated", amount: 100, final_allocation: "Company overhead", proposed_allocation: "Company overhead" },
    { reference: "E04", status: "Allocated", amount: 250, final_allocation: "B", proposed_allocation: "B" },
    { reference: "E05", status: "Allocated", amount: 90, final_allocation: "B", proposed_allocation: "A" },
    { reference: "E06", status: "Allocated", amount: 60, final_allocation: "Company overhead", proposed_allocation: "Company overhead" },
    { reference: "E07", status: "Awaiting allocation", amount: 140, final_allocation: null, proposed_allocation: "A" }
  ];
  const result = dashboard(sales, expenses);
  assert.equal(result.projects.A.result, 2050);
  assert.equal(result.projects.B.result, 2180);
  assert.equal(result.company.result, 3930);
  assert.deepEqual(result.people, { richard: 140, anastasia: 175, jean_claude: 215 });
});

test("keeps pending sales out of income and commission totals", () => {
  const result = dashboard([
    { reference: "S01", status: "Pending approval", amount: 1000, project: "A", commission_richard: 0, commission_anastasia: 0, commission_jean_claude: 0 }
  ], []);
  assert.equal(result.company.income, 0);
  assert.equal(result.company.commissions, 0);
  assert.equal(result.projects.A.result, 0);
  assert.equal(result.pendingSales, 1);
});

test("deducts an awaiting expense from company once but not from either project", () => {
  const expenses = [{ reference: "E07", status: "Awaiting allocation", amount: 140, final_allocation: null, proposed_allocation: "A" }];
  const awaiting = dashboard([], expenses);
  assert.equal(awaiting.company.result, -140);
  assert.equal(awaiting.projects.A.result, 0);
  assert.equal(awaiting.company.awaiting, 140);

  const allocated = dashboard([], [{ ...expenses[0], status: "Allocated", final_allocation: "B" }]);
  assert.equal(allocated.company.result, -140);
  assert.equal(allocated.projects.A.result, 0);
  assert.equal(allocated.projects.B.result, -140);
  assert.equal(allocated.company.awaiting, 0);
});
