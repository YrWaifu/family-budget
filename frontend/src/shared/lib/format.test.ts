import { describe, expect, it } from "vitest";
import { amountToCents, formatMoney } from "./format";

describe("amount formatting", () => {
  it("parses russian decimal input without floats", () => {
    expect(amountToCents("150")).toBe(15000);
    expect(amountToCents("150.50")).toBe(15050);
    expect(amountToCents("150,50")).toBe(15050);
  });

  it("formats rubles", () => {
    expect(formatMoney(15050)).toContain("151");
  });
});

