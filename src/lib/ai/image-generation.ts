/**
 * Pure prompt-building logic for the 图片设计员 (Image Designer) — no
 * network calls, no "server-only" import, mirrors topic-discovery.ts's
 * split from router.ts. Every image is generated from an already
 * human-reviewed text draft, never from raw research directly — the
 * image designer only ever sees content a human has already looked at
 * once. Three distinct capabilities (live user instruction):
 *   1. buildCoverImagePrompt — one cover/thumbnail, shared logic for
 *      小红书/视频号封面 and 公众号封面 (same kind of stylized title-card
 *      graphic, just built from whichever platform's draft).
 *   2. buildCarouselImagePrompt — one image per 小红书 page (图文), so a
 *      post gets a real multi-page visual set instead of a single cover.
 *
 * includePortrait (小红书/视频号封面 only) attaches a real, ADMIN-uploaded
 * reference photo of Leo (see src/lib/leo-portraits.ts) to the actual
 * image-generation call (the Images EDIT endpoint, not text-only
 * generation — see generateOpenAIImageEdit in openai-provider.ts) and
 * asks the model to design the cover AROUND that reference, working his
 * real likeness into the scene itself — not a separate pixel-compositing
 * step glued on afterwards.
 */

const STYLE_RULES = `风格要求：简洁清晰，突出核心信息；如果画面里出现文字，必须简短且不依赖精确拼写；避免蓝紫 AI 科技风、机器人、廉价商务图库、过度光效、夸张移民广告风。

严格禁止：不得伪造 GOV.UK 页面、Home Office 信件、签证、护照、真实客户材料、官方文件截图或真实案例证据——不得生成任何看起来像真实政府文件、证件或官方印章的图像。如果内容需要表现这些，只能用明显的、风格化的解释性图形（如示意图标、抽象图形），绝不能模拟成看似真实的官方文档。`;

export function buildCoverImagePrompt(
  topic: { title: string; business: string },
  content: { title: string; text: string },
  platformLabel: string,
  includePortrait = false,
): string {
  const portraitInstruction = includePortrait
    ? `\n\n附带的参考图是李尔王本人的真实照片。请把他自然地融合进这张封面里——保留他的真实长相、发型、体态，不要改变成另一个人，也不要卡通化/插画化他的脸；但周围的背景、色调、光影、构图可以按封面主题重新设计，让他看起来像是"站在/出现在"这个设计好的场景里，而不是一张原始照片被直接贴上去。整体版式：他通常占画面右侧或右下方，左侧或上方留给栏目标签、主标题、副标题（文字用白色或金色，确保在深色背景上清晰可读）。整体背景使用深色调（深蓝、深墨绿、近黑、黑金一类），呼应参考照片本身的深色背景，让人物和背景融为一体，不要出现人物区域和背景区域明显割裂、拼接的痕迹。`
    : "";

  return `为${platformLabel}设计一张封面图。

标题：${content.title}
正文摘要（仅供理解主题背景，不要把里面的分点/清单/多条内容搬到封面上）：${content.text}
所属选题：${topic.title}（${topic.business}）

${STYLE_RULES}

封面只做"一个吸引点"，不是内容摘要：主标题（一句话，不超过约12个字）+ 最多一句副标题，仅此而已。绝对不要在封面上出现编号列表、步骤清单、多个图标+文字条目、提示框——那些是小红书图文内页才该有的东西，封面塞太多信息反而没人看得清、也没人想点进去。${portraitInstruction}

构图：竖版构图。`;
}

export function buildCarouselImagePrompt(
  topic: { title: string; business: string },
  post: { title: string },
  page: { text: string; pageNumber: number; totalPages: number },
): string {
  return `为小红书图文笔记设计第 ${page.pageNumber}/${page.totalPages} 页的配图。

笔记标题：${post.title}
本页文字内容：${page.text}
所属选题：${topic.title}（${topic.business}）

${STYLE_RULES}

构图：竖版构图，与同一篇笔记里的其他页保持一致的视觉风格（配色、字体气质、排版逻辑），让人一眼看出这是同一组图文的第 ${page.pageNumber} 页。`;
}
