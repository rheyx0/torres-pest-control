// Migration 077: contracts take a down payment before their visits are booked.
import { canBookContract, contractDepositStatus, contractDepositToApply } from "../billing";

const contract = { id: "k1", status: "ACTIVE", depositAmount: 12600 };
const pay = (fields) => ({ id: Math.random().toString(36), contractId: "k1", kind: "DEPOSIT", method: "CASH", amount: 0, ...fields });

test("due, partly paid, pending check, paid", () => {
  expect(contractDepositStatus(contract, []).state).toBe("DUE");
  expect(contractDepositStatus(contract, [pay({ amount: 5000 })])).toMatchObject({ state: "PARTIAL", paid: 5000, remaining: 7600 });
  expect(contractDepositStatus(contract, [pay({ amount: 12600, method: "CHECK", checkStatus: "PENDING" })]).state).toBe("PENDING_CHECK");
  expect(contractDepositStatus(contract, [pay({ amount: 12600 })]).state).toBe("PAID");
  expect(contractDepositStatus({ ...contract, depositAmount: 0 }, []).state).toBe("NONE");
  // Another contract's, or a reversed one, does not count.
  expect(contractDepositStatus(contract, [pay({ amount: 12600, contractId: "k2" })]).state).toBe("DUE");
  expect(contractDepositStatus(contract, [pay({ amount: 12600, reversedAt: "2026-10-12" })]).state).toBe("DUE");
});

test("visits are booked only once it is in", () => {
  expect(canBookContract(contract, []).ok).toBe(false);
  expect(canBookContract(contract, [pay({ amount: 12600, method: "CHECK", checkStatus: "PENDING" })]).reason).toMatch(/not cleared/);
  expect(canBookContract(contract, [pay({ amount: 12600 })]).ok).toBe(true);
  expect(canBookContract({ ...contract, depositAmount: 0 }, []).ok).toBe(true);
  expect(canBookContract({ ...contract, status: "DRAFT", depositAmount: 0 }, []).ok).toBe(false);
});

test("the first invoice deducts it, a later one only what is left", () => {
  const payments = [pay({ amount: 12600 })];
  expect(contractDepositToApply(contract, payments, [], 40000)).toBe(12600);
  expect(contractDepositToApply(contract, payments, [], 3500)).toBe(3500);
  const first = { id: "i1", contractId: "k1", quoteId: "", status: "ISSUED", depositApplied: 3500 };
  expect(contractDepositToApply(contract, payments, [first], 40000)).toBe(9100);
});
