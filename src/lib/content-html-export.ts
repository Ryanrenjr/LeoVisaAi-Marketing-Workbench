/**
 * Turns a plain title+content pair (exactly what's stored in
 * content_assets.title/content — see content-mapping.ts's
 * deriveTitleAndContent) into a standalone, double-click-openable HTML
 * file for the integrator's download zip. Live user instruction: the
 * downloaded .txt showed literal "**" characters and no visual structure
 * — the content itself already follows a "一句一行，空一行" rhythm with
 * **bold** emphasis and "一、二、三..." section headings (see
 * WECHAT_ARTICLE_SYSTEM_PROMPT), this just renders that convention as
 * real bold/headings/spacing instead of raw markdown syntax. No new
 * dependency, no server round-trip — pure string templating, opens in any
 * browser, and a rendered page still copy-pastes as clean text into
 * downstream platforms.
 */

const HEADING_RE = /^[一二三四五六七八九十百]+、/;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Converts **bold** markdown spans to <strong> — the only inline markdown this app's content ever uses. */
function renderInline(escapedLine: string): string {
  return escapedLine.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderBlocks(content: string): string {
  const blocks = content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return blocks
    .map((block) => {
      const lines = block.split("\n").map((line) => renderInline(escapeHtml(line)));
      const tag = HEADING_RE.test(block) ? "h2" : "p";
      return `<${tag}>${lines.join("<br>")}</${tag}>`;
    })
    .join("\n");
}

function wrapHtmlPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
    max-width: 720px;
    margin: 48px auto;
    padding: 0 24px 64px;
    line-height: 1.9;
    color: #1a1a1a;
    font-size: 16px;
  }
  h1 { font-size: 1.6em; font-weight: 700; margin: 0 0 0.9em; line-height: 1.4; }
  h2 { font-size: 1.2em; font-weight: 700; margin: 1.8em 0 0.5em; }
  p { margin: 0 0 1.1em; }
  strong { font-weight: 700; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${bodyHtml}
</body>
</html>
`;
}

export function renderContentAsHtml(title: string, content: string): string {
  return wrapHtmlPage(title, renderBlocks(content));
}

/**
 * Same page shell as renderContentAsHtml, but for a final package that
 * needs several explicitly-labeled sections rather than one flowing body
 * — e.g. 视频号内容.html (发布标题/发布内容/口播稿) and 小红书发布文案.html
 * (发布标题/发布内容). Each section renders as an `<h2>` heading followed
 * by its own body's paragraphs (same block-splitting as renderBlocks); a
 * section with an empty body is skipped rather than rendering an empty
 * heading.
 */
export function renderSectionsAsHtml(title: string, sections: { heading: string; body: string }[]): string {
  const bodyHtml = sections
    .filter((s) => s.body.trim().length > 0)
    .map((s) => `<h2>${escapeHtml(s.heading)}</h2>\n${renderBlocks(s.body)}`)
    .join("\n");
  return wrapHtmlPage(title, bodyHtml);
}
