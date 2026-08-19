import { describe, expect, it } from "vitest";
import { computeTopicScore } from "./scoring";
import type { TopicInput } from "./types";

const complete: TopicInput = {
  title: "老永居离境超过2年，身份还在吗？",
  question: "老永居离境超过2年，身份还在吗？",
  business: "永居 / ILR",
  audience: "持老式永居（ILR）并长期离境的申请人",
  content_pillar: "myth_busting",
  priority: "HIGH",
};

describe("computeTopicScore", () => {
  it("gives a fully-specified HIGH priority topic the maximum score", () => {
    const { total, breakdown } = computeTopicScore(complete);
    expect(breakdown.priority).toBe(60);
    expect(breakdown.completeness).toBe(40);
    expect(total).toBe(100);
  });

  it("scores priority alone for a bare-minimum LOW priority topic", () => {
    const { total, breakdown } = computeTopicScore({
      title: "x",
      question: "",
      business: "",
      audience: "",
      content_pillar: null,
      priority: "LOW",
    });
    expect(breakdown.priority).toBe(15);
    expect(breakdown.completeness).toBe(0);
    expect(total).toBe(15);
  });

  it("only counts completeness fields that are actually filled in", () => {
    const { breakdown } = computeTopicScore({
      ...complete,
      priority: "MEDIUM",
      audience: "   ",
      content_pillar: null,
    });
    expect(breakdown.priority).toBe(35);
    expect(breakdown.completeness).toBe(20); // business + question only
  });

  it("is deterministic for the same input", () => {
    expect(computeTopicScore(complete)).toEqual(computeTopicScore(complete));
  });
});
