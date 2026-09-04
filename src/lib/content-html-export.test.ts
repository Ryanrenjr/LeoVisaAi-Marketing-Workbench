import { describe, expect, it } from "vitest";
import { renderContentAsHtml } from "./content-html-export";

describe("renderContentAsHtml", () => {
  it("wraps the title in an h1", () => {
    const html = renderContentAsHtml("标题", "正文。");
    expect(html).toContain("<h1>标题</h1>");
  });

  it("renders **bold** spans as <strong>", () => {
    const html = renderContentAsHtml("t", "旧护照上的贴纸，**不代表**身份还在。");
    expect(html).toContain("<strong>不代表</strong>");
    expect(html).not.toContain("**");
  });

  it("splits blank-line-separated blocks into separate paragraphs", () => {
    const html = renderContentAsHtml("t", "第一段。\n\n第二段。");
    expect(html).toContain("<p>第一段。</p>");
    expect(html).toContain("<p>第二段。</p>");
  });

  it("renders a Chinese-numeral section line as an h2 heading, not a paragraph", () => {
    const html = renderContentAsHtml("t", "一、说结果：工党输了什么？\n\n正文内容。");
    expect(html).toContain("<h2>一、说结果：工党输了什么？</h2>");
    expect(html).not.toContain("<p>一、");
  });

  it("keeps multiple lines within one block joined by <br>, not separate paragraphs", () => {
    const html = renderContentAsHtml("t", "第一行\n第二行");
    expect(html).toContain("<p>第一行<br>第二行</p>");
  });

  it("escapes HTML special characters so raw content can never break the page", () => {
    const html = renderContentAsHtml("t", "A<script>alert(1)</script>B & C");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });
});
