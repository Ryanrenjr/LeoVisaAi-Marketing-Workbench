import { describe, expect, it } from "vitest";
import { appendCustomInstructions } from "./prompt-addendum";

describe("appendCustomInstructions", () => {
  it("returns the base prompt unchanged when there is no custom text", () => {
    expect(appendCustomInstructions("BASE", null)).toBe("BASE");
    expect(appendCustomInstructions("BASE", undefined)).toBe("BASE");
    expect(appendCustomInstructions("BASE", "")).toBe("BASE");
    expect(appendCustomInstructions("BASE", "   ")).toBe("BASE");
  });

  it("appends the custom text after the base, never before it", () => {
    const result = appendCustomInstructions("BASE RULES", "多用一些比喻");
    const baseIndex = result.indexOf("BASE RULES");
    const customIndex = result.indexOf("多用一些比喻");
    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(customIndex).toBeGreaterThan(baseIndex);
  });

  it("trims surrounding whitespace from the custom text", () => {
    const result = appendCustomInstructions("BASE", "  extra note  ");
    expect(result).toContain("extra note");
    expect(result).not.toContain("  extra note  ");
  });
});
