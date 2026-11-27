import { describe, expect, it } from "vitest";
import { formatQuantity, removeQuantityRoundoff, quantityAvailability } from "@/lib/portfolio/quantity";

describe("quantity", () => {
  it("removes roundoff when a shorter decimal represents the quantity", () => {
    expect(formatQuantity(100 * 1.1 - 20)).toBe("90");
    expect(formatQuantity(0.3 - 0.1)).toBe("0.2");
    expect(formatQuantity(1250.125)).toBe("1,250.125");
    expect(removeQuantityRoundoff(0.1234567890123456)).toBe(0.1234567890123456);
    expect(formatQuantity(1e-12)).toBe("1e-12");
  });

  it("keeps actual differences in small fractions and large holdings", () => {
    expect(quantityAvailability(0.2, 0.3 - 0.1)).toBe("full");
    expect(quantityAvailability(0.999999999999, 1)).toBe("partial");
    expect(quantityAvailability(0.5e-20, 1e-20)).toBe("partial");
    expect(quantityAvailability(1_000_000_000_000_000.125, 1_000_000_000_000_000)).toBeNull();
    expect(quantityAvailability(1_000_000_000_000_000, 1_000_000_000_000_001)).toBe("partial");
  });
});
