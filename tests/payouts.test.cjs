const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../lib/payouts.ts"), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleContext = { exports: {} };
vm.runInNewContext(output, moduleContext);
const { lastFridayCutoff, nextFridayCutoff, payoutDateRange, payoutPage } = moduleContext.exports;

test("custom dates use inclusive Lagos start and exclusive following-day end", () => {
  const range = payoutDateRange(new URLSearchParams("period=custom&from=2026-10-01&to=2026-10-02"));
  assert.equal(range.from, "2026-09-30T23:00:00.000Z");
  assert.equal(range.to, "2026-10-02T23:00:00.000Z");
});

test("Friday 00:00 Lagos is an eligibility cutoff, not the next cutoff", () => {
  const now = new Date("2026-10-22T23:00:00.000Z");
  assert.equal(lastFridayCutoff(now), "2026-10-22T23:00:00.000Z");
  assert.equal(nextFridayCutoff(now), "2026-10-29T23:00:00.000Z");
  assert.equal(lastFridayCutoff(new Date("2026-10-22T22:59:59.000Z")), "2026-10-15T23:00:00.000Z");
});

test("invalid ranges and pages are rejected", () => {
  assert.throws(() => payoutDateRange(new URLSearchParams("period=custom&from=2026-02-30&to=2026-03-01")));
  assert.throws(() => payoutDateRange(new URLSearchParams("period=custom&from=2026-10-10&to=2026-10-01")));
  assert.throws(() => payoutPage(new URLSearchParams("page=0")));
  assert.equal(payoutPage(new URLSearchParams("page=2")).start, 10);
});
