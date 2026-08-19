import { describe, expect, it } from "vitest";
import { resolveViewMode } from "./view-mode";

describe("resolveViewMode — role-default view behaviour", () => {
  it("EXPERT always resolves to boss mode, regardless of cookie", () => {
    expect(resolveViewMode("EXPERT", undefined)).toBe("boss");
    expect(resolveViewMode("EXPERT", "admin")).toBe("boss");
    expect(resolveViewMode("EXPERT", "boss")).toBe("boss");
  });

  it("ADMIN defaults to admin mode with no cookie set", () => {
    expect(resolveViewMode("ADMIN", undefined)).toBe("admin");
  });

  it("ADMIN can opt into a boss mode preview via the cookie", () => {
    expect(resolveViewMode("ADMIN", "boss")).toBe("boss");
  });

  it("ADMIN falls back to admin mode for any unrecognized cookie value", () => {
    expect(resolveViewMode("ADMIN", "admin")).toBe("admin");
    expect(resolveViewMode("ADMIN", "garbage")).toBe("admin");
  });
});
