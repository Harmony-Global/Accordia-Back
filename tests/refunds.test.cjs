const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../lib/refunds.ts"), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleContext = {
  exports: {},
  require(name) {
    if (name === "@/lib/paystack") return { listPaystackRefunds: async () => [] };
    throw new Error(`Unexpected import: ${name}`);
  }
};
vm.runInNewContext(output, moduleContext);
const { recordPaystackRefund } = moduleContext.exports;

function database() {
  const rows = {
    payments: [{ id: "payment-1", provider: "paystack", provider_transaction_id: "123",
      conversation_id: "job-1", appointment_id: null, professional_id: "pro-1" }],
    payment_refunds: [],
    professional_earnings: [{ id: "earning-1", professional_id: "pro-1", source_type: "job",
      source_id: "job-1", hold_reason: null }],
    payout_exceptions: [],
    payout_allocations: [{ earning_id: "earning-1", payout: { status: "success" } }]
  };
  const matches = (row, filters) => filters.every(([key, value, operator]) => {
    if (operator === "neq") return row[key] !== value;
    if (operator === "in") return value.includes(row[key]);
    if (operator === "is") return row[key] === value;
    return String(row[key]) === String(value);
  });
  const from = (table) => {
    const filters = [];
    let update = null;
    const query = {
      select() { return query; },
      eq(key, value) { filters.push([key, value, "eq"]); return query; },
      neq(key, value) { filters.push([key, value, "neq"]); return query; },
      in(key, value) { filters.push([key, value, "in"]); return query; },
      is(key, value) { filters.push([key, value, "is"]); return query; },
      limit() { return query; },
      update(value) { update = value; return query; },
      async maybeSingle() { return { data: rows[table].find((row) => matches(row, filters)) ?? null, error: null }; },
      async upsert(value) {
        const existing = rows[table].find((row) => table === "payout_exceptions"
          ? row.source_type === value.source_type && row.source_id === value.source_id && row.reason === value.reason
          : row.provider_refund_id === value.provider_refund_id);
        if (existing) Object.assign(existing, value);
        else rows[table].push({ id: `refund-${rows[table].length + 1}`, ...value });
        return { error: null };
      },
      then(resolve) {
        const selected = rows[table].filter((row) => matches(row, filters));
        if (update) selected.forEach((row) => Object.assign(row, update));
        return Promise.resolve({ data: selected, error: null }).then(resolve);
      }
    };
    return query;
  };
  return { rows, client: { from } };
}

const refund = (status = "processed") => ({ id: 456, transaction: 123, amount: 5000,
  currency: "NGN", status, created_at: "2026-10-01T12:00:00.000Z",
  updated_at: "2026-10-02T12:00:00.000Z" });

test("processed refund is idempotent, holds earning, and flags disbursed work", async () => {
  const db = database();
  assert.equal(await recordPaystackRefund(db.client, refund()), true);
  assert.equal(await recordPaystackRefund(db.client, refund()), true);
  assert.equal(db.rows.payment_refunds.length, 1);
  assert.equal(db.rows.payment_refunds[0].initiated_at, "2026-10-01T12:00:00.000Z");
  assert.equal(db.rows.payment_refunds[0].processed_at, "2026-10-02T12:00:00.000Z");
  assert.equal(db.rows.professional_earnings[0].hold_reason, "Refund requires admin reconciliation");
  assert.equal(db.rows.payout_exceptions.length, 2);
});

test("failed refund releases only its own refund hold", async () => {
  const db = database();
  await recordPaystackRefund(db.client, refund("pending"));
  await recordPaystackRefund(db.client, refund("failed"));
  assert.equal(db.rows.payment_refunds[0].status, "failed");
  assert.equal(db.rows.professional_earnings[0].hold_reason, null);
});

test("unmatched provider transaction is not attached to another payment", async () => {
  const db = database();
  assert.equal(await recordPaystackRefund(db.client, { ...refund(), transaction: 999 }), false);
  assert.equal(db.rows.payment_refunds.length, 0);
});
