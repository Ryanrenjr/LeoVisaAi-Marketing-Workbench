import { describe, expect, it } from "vitest";
import { selectSearchProvider } from "./search-selection";

describe("selectSearchProvider", () => {
  it("Development Mode selects TAVILY (the only FREE registered provider) when nothing else is specified", () => {
    const result = selectSearchProvider({ developmentMode: true, configuredDefault: null, executionOverride: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider.provider).toBe("TAVILY");
      expect(result.source).toBe("development_free_first");
    }
  });

  it("prefers an explicit execution override", () => {
    const result = selectSearchProvider({ developmentMode: true, configuredDefault: null, executionOverride: "BRAVE" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("override");
  });

  it("rejects an override that doesn't exist in the registry", () => {
    const result = selectSearchProvider({
      developmentMode: true,
      configuredDefault: null,
      // @ts-expect-error deliberately invalid provider id for this test
      executionOverride: "NOT_A_REAL_PROVIDER",
    });
    expect(result.ok).toBe(false);
  });

  it("requires an explicit configured default outside Development Mode", () => {
    const result = selectSearchProvider({ developmentMode: false, configuredDefault: null, executionOverride: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/尚未为研究任务配置默认搜索服务/);
  });

  it("never auto-selects a PAID provider (Brave) even though it's registered — only an explicit override or configured default can reach it", () => {
    const withOverride = selectSearchProvider({ developmentMode: true, configuredDefault: null, executionOverride: "BRAVE" });
    expect(withOverride.ok).toBe(true);
    if (withOverride.ok) expect(withOverride.source).toBe("override");

    const withoutOverride = selectSearchProvider({ developmentMode: true, configuredDefault: null, executionOverride: null });
    expect(withoutOverride.ok).toBe(true);
    if (withoutOverride.ok) expect(withoutOverride.provider.provider).toBe("TAVILY");
  });
});
