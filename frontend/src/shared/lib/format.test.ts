import { describe, expect, it } from "vitest";
import { amountToCents, dateInputToISO, formatMoney, isoDate } from "./format";

describe("amount formatting", () => {
  it("parses russian decimal input without floats", () => {
    expect(amountToCents("150")).toBe(15000);
    expect(amountToCents("150.50")).toBe(15050);
    expect(amountToCents("150,50")).toBe(15050);
  });

  it("formats rubles", () => {
    expect(formatMoney(15050)).toContain("151");
  });

  it("formats calendar date without utc shift", () => {
    expect(isoDate(new Date(2026, 6, 22, 0, 30))).toBe("2026-07-22");
  });

  it("keeps selected calendar day inside iso payload", () => {
    expect(dateInputToISO("2026-07-22")).toContain("2026-07-22");
  });
});
