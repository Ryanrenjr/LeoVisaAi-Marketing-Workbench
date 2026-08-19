import { describe, expect, it } from "vitest";
import {
  VideoChannelContentSchema,
  WechatFullArticleSchema,
  WechatOutlineSchema,
  XiaohongshuContentSchema,
  buildEvidenceContextBlock,
  buildForbiddenPhraseNotes,
  buildSourceManifest,
  groundContentSources,
  scanForbiddenPhrases,
} from "./content-schemas";
import type { ResearchSource } from "../types";

const SOURCES: ResearchSource[] = [
  {
    id: "src-1",
    research_pack_id: "pack-1",
    title: "GOV.UK — eVisa",
    url: "https://www.gov.uk/example-evisa",
    note: "官方说明",
    page_age: "3 个月前",
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "src-2",
    research_pack_id: "pack-1",
    title: "UKVI 指引",
    url: "https://www.gov.uk/example-evisa-account",
    note: "",
    page_age: null,
    created_at: "2026-01-01T00:00:00Z",
  },
];

describe("VideoChannelContentSchema", () => {
  const valid = {
    title: "标题",
    hook: "钩子",
    cover_text: "封面字",
    target_duration_seconds: 90,
    full_script: "完整口播",
    evidence_visuals: ["画面一"],
    cta: "行动号召",
    source_references: ["S1"],
    expert_review_notes: [],
  };

  it("accepts a well-formed video content object", () => {
    expect(VideoChannelContentSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a duration outside 30-180 seconds", () => {
    expect(VideoChannelContentSchema.safeParse({ ...valid, target_duration_seconds: 10 }).success).toBe(
      false,
    );
    expect(VideoChannelContentSchema.safeParse({ ...valid, target_duration_seconds: 300 }).success).toBe(
      false,
    );
  });

  it("rejects an expert_review_note with an invalid reason (malformed AI output)", () => {
    const bad = {
      ...valid,
      expert_review_notes: [{ claim: "x", reason: "not_a_valid_reason", note: "y" }],
    };
    expect(VideoChannelContentSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing full_script (unsupported/malformed AI output)", () => {
    const missing: Record<string, unknown> = { ...valid };
    delete missing.full_script;
    expect(VideoChannelContentSchema.safeParse(missing).success).toBe(false);
  });
});

describe("XiaohongshuContentSchema", () => {
  const valid = {
    title_options: ["A", "B", "C"],
    cover_title: "封面标题",
    pages: Array.from({ length: 6 }, (_, i) => `第${i + 1}页`),
    caption: "正文",
    keywords: ["关键词"],
    source_references: [],
    expert_review_notes: [],
  };

  it("accepts a well-formed Xiaohongshu content object", () => {
    expect(XiaohongshuContentSchema.safeParse(valid).success).toBe(true);
  });

  it("requires exactly 3 title options", () => {
    expect(XiaohongshuContentSchema.safeParse({ ...valid, title_options: ["A", "B"] }).success).toBe(
      false,
    );
  });

  it("rejects fewer than 6 pages", () => {
    expect(XiaohongshuContentSchema.safeParse({ ...valid, pages: ["only one"] }).success).toBe(false);
  });

  it("rejects more than 10 pages", () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `page ${i}`);
    expect(XiaohongshuContentSchema.safeParse({ ...valid, pages: tooMany }).success).toBe(false);
  });
});

describe("WechatOutlineSchema / WechatFullArticleSchema", () => {
  it("accepts a well-formed outline", () => {
    const valid = {
      title_options: ["A", "B", "C"],
      summary: "摘要",
      detailed_outline: ["第一部分", "第二部分"],
      key_claims: ["主张一"],
      faq: [{ question: "问题", answer: "答案" }],
      source_references: ["S1"],
      expert_review_notes: [],
    };
    expect(WechatOutlineSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a full article missing the article body", () => {
    const missing = { title: "标题", source_references: [], expert_review_notes: [] };
    expect(WechatFullArticleSchema.safeParse(missing).success).toBe(false);
  });
});

describe("buildSourceManifest", () => {
  it("labels sources sequentially and maps labels back to real ids", () => {
    const { entries, labelToId, manifestText } = buildSourceManifest(SOURCES);
    expect(entries.map((e) => e.label)).toEqual(["S1", "S2"]);
    expect(labelToId.get("S1")).toBe("src-1");
    expect(labelToId.get("S2")).toBe("src-2");
    expect(manifestText).toContain("https://www.gov.uk/example-evisa");
  });

  it("produces a clear manifest when there are no sources at all", () => {
    const { entries, manifestText } = buildSourceManifest([]);
    expect(entries).toHaveLength(0);
    expect(manifestText).toContain("没有可用的真实来源");
  });
});

describe("groundContentSources — source references can only use verified Research Sources", () => {
  const { labelToId } = buildSourceManifest(SOURCES);

  it("resolves a real label to its real source id", () => {
    const { sourceIds, droppedCount } = groundContentSources(["S1"], labelToId);
    expect(sourceIds).toEqual(["src-1"]);
    expect(droppedCount).toBe(0);
  });

  it("drops a label the model invented that was never in the manifest", () => {
    const { sourceIds, droppedCount } = groundContentSources(["S1", "S99"], labelToId);
    expect(sourceIds).toEqual(["src-1"]);
    expect(droppedCount).toBe(1);
  });

  it("drops everything when the model references only invented labels", () => {
    const { sourceIds, droppedCount } = groundContentSources(["made-up"], labelToId);
    expect(sourceIds).toHaveLength(0);
    expect(droppedCount).toBe(1);
  });

  it("de-duplicates repeated valid references to the same source", () => {
    const { sourceIds } = groundContentSources(["S1", "S1", "S1"], labelToId);
    expect(sourceIds).toEqual(["src-1"]);
  });

  it("tolerates surrounding whitespace in a label", () => {
    const { sourceIds, droppedCount } = groundContentSources([" S1 "], labelToId);
    expect(sourceIds).toEqual(["src-1"]);
    expect(droppedCount).toBe(0);
  });
});

describe("forbidden phrase safety net", () => {
  it("flags a known fear-based phrase", () => {
    expect(scanForbiddenPhrases("窗口马上关闭，赶紧申请！")).toEqual(
      expect.arrayContaining(["窗口马上关闭", "赶紧申请"]),
    );
  });

  it("finds nothing in calm, restrained text", () => {
    expect(scanForbiddenPhrases("根据现行规定，建议在到期前完成相关手续。")).toHaveLength(0);
  });

  it("builds one expert_review_note per distinct flagged phrase across multiple texts, not per occurrence", () => {
    const notes = buildForbiddenPhraseNotes(["重磅消息！", "这是重磅内容。", "请赶紧申请。"]);
    const claims = notes.map((n) => n.claim).sort();
    expect(claims).toEqual(["赶紧申请", "重磅"]);
    expect(notes.every((n) => n.reason === "expert_review_required")).toBe(true);
  });

  it("returns no notes when nothing is flagged", () => {
    expect(buildForbiddenPhraseNotes(["平稳的说明文字"])).toHaveLength(0);
  });
});

describe("buildEvidenceContextBlock", () => {
  it("includes the research summary, confidence, and the source manifest", () => {
    const block = buildEvidenceContextBlock(
      {
        title: "老永居离境超过2年，身份还在吗？",
        question: "老永居离境超过2年，身份还在吗？",
        business: "永居 / ILR",
        audience: "持老式永居的申请人",
        content_pillar: "myth_busting",
      },
      { summary: "研究摘要内容", key_findings: ["发现一"], warnings: "", confidence: "HIGH" },
      "[S1] GOV.UK — https://www.gov.uk/example",
    );
    expect(block).toContain("研究摘要内容");
    expect(block).toContain("HIGH");
    expect(block).toContain("[S1]");
    expect(block).toContain("老永居离境超过2年，身份还在吗？");
  });

  it("omits empty optional topic fields", () => {
    const block = buildEvidenceContextBlock(
      { title: "标题", question: "", business: "", audience: "", content_pillar: null },
      { summary: "s", key_findings: [], warnings: "", confidence: "LOW" },
      "（无来源）",
    );
    expect(block).not.toContain("业务线：");
    expect(block).not.toContain("目标受众：");
  });
});
