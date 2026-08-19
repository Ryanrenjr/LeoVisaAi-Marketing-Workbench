import { describe, expect, it } from "vitest";
import { validateTopicInput } from "./topic-validation";

describe("validateTopicInput", () => {
  it("accepts a fully-specified topic", () => {
    const result = validateTopicInput({
      title: "老永居离境超过2年，身份还在吗？",
      question: "老永居离境超过2年，身份还在吗？",
      business: "永居 / ILR",
      audience: "持ILR人士",
      content_pillar: "myth_busting",
      priority: "HIGH",
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("rejects a missing title", () => {
    const result = validateTopicInput({ title: "", question: "问题" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("标题不能为空。");
  });

  it("rejects a title that is only whitespace", () => {
    const result = validateTopicInput({ title: "   ", question: "问题" });
    expect(result.valid).toBe(false);
  });

  it("rejects a missing question", () => {
    const result = validateTopicInput({ title: "标题", question: "" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("选题问题不能为空。");
  });

  it("collects multiple errors at once", () => {
    const result = validateTopicInput({ title: "", question: "" });
    expect(result.errors).toHaveLength(2);
  });
});
