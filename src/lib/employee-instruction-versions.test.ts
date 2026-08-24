import { describe, expect, it } from "vitest";
import { nextInstructionVersion } from "./employee-instruction-versions";

describe("nextInstructionVersion — Skill version increment", () => {
  it("starts at 1 when there are no existing versions", () => {
    expect(nextInstructionVersion([])).toBe(1);
  });

  it("increments one past the current max version", () => {
    expect(nextInstructionVersion([1])).toBe(2);
    expect(nextInstructionVersion([1, 2, 3])).toBe(4);
  });

  it("is not confused by out-of-order input", () => {
    expect(nextInstructionVersion([3, 1, 2])).toBe(4);
  });
});
