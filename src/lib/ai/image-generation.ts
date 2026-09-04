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
  highlights: string[] = [],
  contentBrand?: string,
  orientation: "portrait" | "landscape" = "portrait",
): string {
  const portraitInstruction = includePortrait
    ? `\n\n附带的参考图是李尔王本人的真实照片。请把他自然地融合进这张封面里——保留他的真实长相、发型、体态，不要改变成另一个人，也不要卡通化/插画化他的脸；但周围的背景、色调、光影、构图可以按封面主题重新设计，让他看起来像是"站在/出现在"这个设计好的场景里，而不是一张原始照片被直接贴上去。整体版式：他固定占画面右侧或右下方（半身或胸像），左侧或上方留给品牌标签、主标题、数据行。整体背景使用深色、英伦主题的场景/纹理（深蓝、深墨绿、近黑、黑金一类，可暗示英国相关的抽象元素如护照封面色、地图轮廓、建筑剪影），呼应参考照片本身的深色背景，让人物和背景融为一体，不要出现人物区域和背景区域明显割裂、拼接的痕迹。`
    : "";

  const brandBadge = contentBrand
    ? `\n\n如果构图还有余量，可以在画面顶部或左上角放一个不起眼的小栏目标签（文字为"${contentBrand}"，字号明显小于主标题）——这是锦上添花，不是必须元素，真实发布的封面很多并不带这个标签，主标题和视觉焦点永远优先于它。`
    : "";

  const highlightRows =
    highlights.length > 0
      ? `\n\n画面中下方放置 ${highlights.length} 行简短的要点行，每行一个小图标 + 一小段文字，逐行竖直排列，风格统一、对齐工整（类似信息卡片里的条目，不是正文段落）。这些要点行有两种可能的内容，取决于下面提供的原文本身是哪一种——不需要你判断，原样呈现即可：可能是"标签：数值"式的数据要点，也可能是设问句（比如"没有大选，他怎么直接上台？"，这种情况下图标就配合问题主题选取，比如皇冠、脚步、时钟等）。文字内容严格使用下面提供的原文，不要改写、不要合并、不要新增：\n${highlights.map((h, i) => `${i + 1}. ${h}`).join("\n")}\n每个图标应是与该行内容相关的简单线性/剪影小图标，不要使用真实政府徽章或官方印章。`
      : "";

  return `为${platformLabel}设计一张封面图。

标题：${content.title}
正文摘要（仅供理解主题背景，不要把里面的分点/清单/多条内容搬到封面上）：${content.text}
所属选题：${topic.title}（${topic.business}）

${STYLE_RULES}

封面版式：一个粗体、多行排列的主标题（可以拆成两三行短句，字号大、颜色为白色或金色，确保在深色背景上清晰可读），是画面里最主要的视觉焦点；最多再加一句更小字号的副标题。${brandBadge}${highlightRows}

如果上面没有提供数据/要点行，就不要在封面上编造编号列表、步骤清单或提示框——封面只做"一个吸引点"，不是内容摘要；只有在明确提供了数据行时，才按上面的格式呈现。可以点缀 1-2 个与主题相关的小型装饰性图标（不占主要视觉空间），增加设计感。${portraitInstruction}

构图：${orientation === "landscape" ? "横版通栏构图（宽大于高，适合作为文章顶部横幅图）" : "竖版构图"}。`;
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

在画面左上角放一个小的页码标签（如"第 ${page.pageNumber} 页"或"P${page.pageNumber}"），字号小、不抢主标题的视觉焦点，方便读者知道自己看到了这组图文的第几页。

构图：竖版构图，与同一篇笔记里的其他页保持一致的视觉风格（配色、字体气质、排版逻辑），让人一眼看出这是同一组图文的第 ${page.pageNumber} 页。`;
}
