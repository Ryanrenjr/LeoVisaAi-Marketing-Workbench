import { Fragment } from "react";

/**
 * The minimal markdown this app's AI-generated content actually uses:
 * `\n\n`-separated short lines/paragraphs (the WeChat-native "one
 * sentence per line" reading style, see WECHAT_ARTICLE_SYSTEM_PROMPT),
 * `**bold**` for emphasis, and a line starting with "## " for a section
 * heading (rendered bigger/bolder with more room around it, not just
 * another same-size line — live user instruction: font size and line
 * spacing need real visual hierarchy, not everything flattened into
 * uniform-size bullet lines). Field's plain-text rendering doesn't parse
 * any of this, so this is a real, if tiny, renderer rather than pulling
 * in a markdown library for three constructs.
 */

function renderInline(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}

export function MarkdownText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return (
    <div className="flex flex-col gap-5">
      {paragraphs.map((paragraph, i) => {
        const trimmed = paragraph.trim();
        if (trimmed.startsWith("## ")) {
          return (
            <p key={i} className="text-lg leading-snug font-bold">
              {renderInline(trimmed.slice(3), `${i}`)}
            </p>
          );
        }

        const lines = paragraph.split("\n");
        return (
          <p key={i} className="leading-loose">
            {lines.map((line, j) => (
              <Fragment key={j}>
                {renderInline(line, `${i}-${j}`)}
                {j < lines.length - 1 && <br />}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
