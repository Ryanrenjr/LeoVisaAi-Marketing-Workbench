import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownText } from "./markdown-text";

describe("MarkdownText", () => {
  it("renders **bold** as real emphasis, not literal asterisks", () => {
    render(<MarkdownText text="Reform UK：**25%**" />);
    expect(screen.getByText("25%").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("splits \\n\\n-separated lines into separate paragraphs", () => {
    const { container } = render(<MarkdownText text={"第一行。\n\n第二行。\n\n第三行。"} />);
    expect(container.querySelectorAll("p")).toHaveLength(3);
  });

  it("keeps a single newline within one paragraph as a line break, not a new paragraph", () => {
    const { container } = render(<MarkdownText text={"一句。\n二句。"} />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("drops empty paragraphs from stray extra blank lines", () => {
    const { container } = render(<MarkdownText text={"一句。\n\n\n\n二句。"} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("renders a '## ' line as a bigger, bold heading distinct from body text, without the marker itself", () => {
    const { container } = render(<MarkdownText text={"## 01 一个标题\n\n普通正文一句。"} />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe("01 一个标题");
    expect(paragraphs[0].className).toContain("font-bold");
    expect(paragraphs[0].className).toContain("text-lg");
    expect(paragraphs[1].className).not.toContain("font-bold");
  });
});
