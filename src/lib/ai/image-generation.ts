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

风格要求：小红书封面风格，简洁清晰，突出核心信息；如果画面里出现文字，必须简短且不依赖精确拼写；竖版构图；避免蓝紫 AI 科技风、机器人、廉价商务图库、过度光效、夸张移民广告风。

严格禁止：不得伪造 GOV.UK 页面、Home Office 信件、签证、护照、真实客户材料、官方文件截图或真实案例证据——不得生成任何看起来像真实政府文件、证件或官方印章的图像。如果内容需要表现这些，只能用明显的、风格化的解释性图形（如示意图标、抽象图形），绝不能模拟成看似真实的官方文档。`;
}
