/**
 * Pure prompt-building logic for the 小红书图片设计员 (Image Designer) —
 * no network calls, no "server-only" import, mirrors topic-discovery.ts's
 * split from router.ts. The image itself is generated from the already-
 * approved 小红书 post draft, never from raw research — so the image
 * designer only ever sees content a human has already reviewed once
 * (the xiaohongshu_post content_asset).
 */
export function buildImagePrompt(
  topic: { title: string; business: string },
  post: { title: string; content: string },
): string {
  return `为小红书笔记设计一张封面配图。

笔记标题：${post.title}
笔记正文：${post.content}
所属选题：${topic.title}（${topic.business}）

风格要求：小红书封面风格，简洁清晰，突出核心信息；如果画面里出现文字，必须简短且不依赖精确拼写；不要虚构任何真实机构、政府部门的官方标志、印章或证件；竖版构图。`;
}
