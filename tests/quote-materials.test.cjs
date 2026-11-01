const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../lib/validators.ts"), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleContext = { exports: {}, require };
vm.runInNewContext(output, moduleContext);
const { jobQuoteSchema } = moduleContext.exports;

const quote = {
  project_title: "Repair kitchen wiring",
  project_description: "Replace the faulty kitchen wiring safely.",
  total_budget: 50000,
  duration_days: 2
};

test("legacy quotes default to no informational material payment", () => {
  const result = jobQuoteSchema.parse(quote);
  assert.equal(result.requires_material_payment, false);
  assert.equal(result.material_payment_amount, null);
  assert.equal(result.material_payment_covers, null);
});

test("material payment must be positive, within the budget, and described", () => {
  const valid = jobQuoteSchema.safeParse({ ...quote, requires_material_payment: true,
    material_payment_amount: 25000, material_payment_covers: "Wiring and fittings" });
  assert.equal(valid.success, true);
  for (const amount of [0, -1, 50000.01, 1.001]) {
    assert.equal(jobQuoteSchema.safeParse({ ...quote, requires_material_payment: true,
      material_payment_amount: amount, material_payment_covers: "Materials" }).success, false);
  }
  assert.equal(jobQuoteSchema.safeParse({ ...quote, requires_material_payment: true,
    material_payment_amount: 100, material_payment_covers: null }).success, false);
});

test("material details cannot be submitted when No is selected", () => {
  assert.equal(jobQuoteSchema.safeParse({ ...quote, requires_material_payment: false,
    material_payment_amount: 100, material_payment_covers: "Materials" }).success, false);
});
