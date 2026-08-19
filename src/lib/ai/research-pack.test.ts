import { describe, expect, it } from "vitest";
import {
  buildGroundedPack,
  buildResearchUserPrompt,
  groundSources,
  parseResearchPackJson,
} from "./research-pack";

describe("parseResearchPackJson", () => {
  const valid = JSON.stringify({
    summary: "总结内容",
    key_findings: ["发现一", "发现二"],
    sources: [{ title: "来源标题", url: "https://www.gov.uk/example", note: "说明" }],
    warnings: "",
    confidence: "HIGH",
  });

  it("parses a well-formed JSON response", () => {
    const result = parseResearchPackJson(valid);
    expect(result.summary).toBe("总结内容");
    expect(result.key_findings).toEqual(["发现一", "发现二"]);
    expect(result.sources).toEqual([
      { title: "来源标题", url: "https://www.gov.uk/example", note: "说明" },
    ]);
    expect(result.confidence).toBe("HIGH");
    expect(result.confidenceInferred).toBe(false);
  });

  it("strips a markdown code fence around the JSON", () => {
    const fenced = "```json\n" + valid + "\n```";
    expect(parseResearchPackJson(fenced).summary).toBe("总结内容");
  });

  it("defaults a missing source note to an empty string", () => {
    const noNote = JSON.stringify({
      summary: "x",
      key_findings: [],
      sources: [{ title: "t", url: "https://example.com" }],
      warnings: "",
      confidence: "MEDIUM",
    });
    expect(parseResearchPackJson(noNote).sources[0].note).toBe("");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseResearchPackJson("not json")).toThrow();
  });

  it("throws when summary is missing", () => {
    const missing = JSON.stringify({ key_findings: [], sources: [], warnings: "" });
    expect(() => parseResearchPackJson(missing)).toThrow(/summary/);
  });

  it("throws when a source is missing a url", () => {
    const badSource = JSON.stringify({
      summary: "x",
      key_findings: [],
      sources: [{ title: "only a title" }],
      warnings: "",
    });
    expect(() => parseResearchPackJson(badSource)).toThrow(/sources/);
  });

  it("throws when key_findings contains a non-string element (schema validation)", () => {
    const badFindings = JSON.stringify({
      summary: "x",
      key_findings: ["ok", { not: "a string" }],
      sources: [],
      warnings: "",
    });
    expect(() => parseResearchPackJson(badFindings)).toThrow(/key_findings/);
  });

  it("throws when key_findings is a string instead of an array (schema validation)", () => {
    const badFindings = JSON.stringify({
      summary: "x",
      key_findings: "should be an array",
      sources: [],
      warnings: "",
    });
    expect(() => parseResearchPackJson(badFindings)).toThrow(/key_findings/);
  });

  it("throws when sources is missing entirely (schema validation)", () => {
    const noSources = JSON.stringify({ summary: "x", key_findings: [], warnings: "" });
    expect(() => parseResearchPackJson(noSources)).toThrow(/sources/);
  });

  describe("LOW-confidence handling", () => {
    it("passes through an explicit LOW confidence unchanged", () => {
      const low = JSON.stringify({
        summary: "x",
        key_findings: [],
        sources: [],
        warnings: "",
        confidence: "LOW",
      });
      const result = parseResearchPackJson(low);
      expect(result.confidence).toBe("LOW");
      expect(result.confidenceInferred).toBe(false);
    });

    it("defaults to LOW and marks it inferred when confidence is missing", () => {
      const missing = JSON.stringify({ summary: "x", key_findings: [], sources: [], warnings: "" });
      const result = parseResearchPackJson(missing);
      expect(result.confidence).toBe("LOW");
      expect(result.confidenceInferred).toBe(true);
    });

    it("defaults to LOW when confidence is an invalid value — never silently upgraded", () => {
      const invalid = JSON.stringify({
        summary: "x",
        key_findings: [],
        sources: [],
        warnings: "",
        confidence: "VERY_SURE",
      });
      const result = parseResearchPackJson(invalid);
      expect(result.confidence).toBe("LOW");
      expect(result.confidenceInferred).toBe(true);
    });

    it("normalizes case (e.g. lowercase 'high')", () => {
      const lower = JSON.stringify({
        summary: "x",
        key_findings: [],
        sources: [],
        warnings: "",
        confidence: "high",
      });
      const result = parseResearchPackJson(lower);
      expect(result.confidence).toBe("HIGH");
      expect(result.confidenceInferred).toBe(false);
    });
  });
});

describe("groundSources — the anti-hallucination guarantee", () => {
  const realResults = [
    { title: "GOV.UK — eVisa", url: "https://www.gov.uk/example-evisa", pageAge: "2 months ago" },
    { title: "UKVI account guidance", url: "https://www.gov.uk/example-evisa-account", pageAge: null },
  ];

  it("keeps a claimed source that matches a real search result, carrying over its page age", () => {
    const { sources, droppedCount } = groundSources(
      [{ title: "GOV.UK — eVisa", url: "https://www.gov.uk/example-evisa", note: "n" }],
      realResults,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].pageAge).toBe("2 months ago");
    expect(droppedCount).toBe(0);
  });

  it("drops a fabricated source that was never actually searched", () => {
    const { sources, droppedCount } = groundSources(
      [
        { title: "GOV.UK — eVisa", url: "https://www.gov.uk/example-evisa", note: "n" },
        { title: "made up citation", url: "https://not-a-real-search-result.example/x", note: "n" },
      ],
      realResults,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe("https://www.gov.uk/example-evisa");
    expect(droppedCount).toBe(1);
  });

  it("drops everything when the model returns no real search results at all", () => {
    const { sources, droppedCount } = groundSources(
      [{ title: "invented", url: "https://invented.example", note: "n" }],
      [],
    );
    expect(sources).toHaveLength(0);
    expect(droppedCount).toBe(1);
  });

  it("matches urls regardless of trailing slash or case", () => {
    const { sources, droppedCount } = groundSources(
      [{ title: "x", url: "HTTPS://WWW.GOV.UK/example-evisa/", note: "n" }],
      realResults,
    );
    expect(sources).toHaveLength(1);
    expect(droppedCount).toBe(0);
  });

  it("does not match a URL that only differs by scheme (http vs https) — no false grounding", () => {
    const { sources, droppedCount } = groundSources(
      [{ title: "x", url: "http://www.gov.uk/example-evisa", note: "n" }],
      realResults,
    );
    expect(sources).toHaveLength(0);
    expect(droppedCount).toBe(1);
  });

  it("null page_age is preserved as null, not coerced to a string", () => {
    const { sources } = groundSources(
      [{ title: "x", url: "https://www.gov.uk/example-evisa-account", note: "n" }],
      realResults,
    );
    expect(sources[0].pageAge).toBeNull();
  });
});

describe("buildGroundedPack", () => {
  const realResults = [{ title: "GOV.UK", url: "https://www.gov.uk/example-evisa", pageAge: "1 week ago" }];

  it("appends a warning noting how many sources were dropped", () => {
    const pack = buildGroundedPack(
      {
        summary: "s",
        key_findings: ["f"],
        sources: [
          { title: "real", url: "https://www.gov.uk/example-evisa", note: "n" },
          { title: "fake", url: "https://fabricated.example", note: "n" },
        ],
        warnings: "",
        confidence: "MEDIUM",
        confidenceInferred: false,
      },
      realResults,
    );
    expect(pack.sources).toHaveLength(1);
    expect(pack.warnings).toMatch(/1/);
  });

  it("leaves warnings untouched when nothing was dropped and confidence was explicit", () => {
    const pack = buildGroundedPack(
      {
        summary: "s",
        key_findings: [],
        sources: [{ title: "real", url: "https://www.gov.uk/example-evisa", note: "n" }],
        warnings: "原始警告",
        confidence: "HIGH",
        confidenceInferred: false,
      },
      realResults,
    );
    expect(pack.warnings).toBe("原始警告");
  });

  it("carries the confidence level through to the grounded pack", () => {
    const pack = buildGroundedPack(
      {
        summary: "s",
        key_findings: [],
        sources: [],
        warnings: "",
        confidence: "LOW",
        confidenceInferred: false,
      },
      [],
    );
    expect(pack.confidence).toBe("LOW");
  });

  it("appends an explanatory note when confidence had to be defaulted", () => {
    const pack = buildGroundedPack(
      {
        summary: "s",
        key_findings: [],
        sources: [],
        warnings: "",
        confidence: "LOW",
        confidenceInferred: true,
      },
      [],
    );
    expect(pack.warnings).toMatch(/置信度/);
  });

  it("carries page_age through into the final grounded sources", () => {
    const pack = buildGroundedPack(
      {
        summary: "s",
        key_findings: [],
        sources: [{ title: "real", url: "https://www.gov.uk/example-evisa", note: "n" }],
        warnings: "",
        confidence: "HIGH",
        confidenceInferred: false,
      },
      realResults,
    );
    expect(pack.sources[0].pageAge).toBe("1 week ago");
  });
});

describe("buildResearchUserPrompt", () => {
  it("includes all provided topic fields", () => {
    const prompt = buildResearchUserPrompt({
      title: "老永居离境超过2年，身份还在吗？",
      question: "老永居离境超过2年，身份还在吗？",
      business: "永居 / ILR",
      audience: "持老式永居（ILR）并长期离境的申请人",
    });
    expect(prompt).toContain("老永居离境超过2年，身份还在吗？");
    expect(prompt).toContain("永居 / ILR");
  });

  it("omits empty optional fields instead of printing blank lines", () => {
    const prompt = buildResearchUserPrompt({
      title: "标题",
      question: "",
      business: "",
      audience: "",
    });
    expect(prompt).not.toContain("Question this content should answer:");
    expect(prompt).not.toContain("Business / practice area:");
  });
});
