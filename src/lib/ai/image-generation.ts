/**
 * Pure prompt-building logic for the 图片设计员 (Image Designer) — no
 * network calls, no "server-only" import, mirrors topic-discovery.ts's
 * split from router.ts. Every image is generated from an already
 * human-reviewed text draft, never from raw research directly — the
 * image designer only ever sees content a human has already looked at
 * once. Two prompt builders, covering three distinct capabilities:
 *   1. buildCoverImagePrompt — one cover/thumbnail, shared logic for
 *      视频号封面 and 公众号封面 (same kind of stylized title-card graphic,
 *      just built from whichever platform's draft). Never called for
 *      XIAOHONGSHU — its P1 carousel image IS its 首图, no separate cover.
 *   2. buildCarouselImagePrompt — one image per 小红书 page (图文), so a
 *      post gets a real multi-page visual set instead of a single cover.
 *
 * includePortrait (视频号封面 only) attaches a real, ADMIN-uploaded
 * reference photo of Leo (see src/lib/leo-portraits.ts) to the actual
 * image-generation call (the Images EDIT endpoint, not text-only
 * generation — see generateOpenAIImageEdit in openai-provider.ts) and
 * asks the model to design the cover AROUND that reference, working his
 * real likeness into the scene itself — not a separate pixel-compositing
 * step glued on afterwards.
 *
 * STYLE_RULES below is IMAGE_DESIGNER_VISUAL_RULES (src/lib/ai/skills.ts)
 * — the compact, image-prompt-appropriate subset of E｜图片设计员's formal
 * Skill (EMPLOYEE_DEFAULT_SKILL["image-designer"]). Every other content-
 * generation task routes through buildSkillPrompt() so its Skill actually
 * reaches the model; this file previously hand-rolled its own separate
 * rules text that had already started drifting from the real Skill (e.g.
 * still describing a shared 小红书/视频号 cover well after that was
 * removed from the product) — importing the canonical export instead of
 * duplicating it is what keeps this from happening again.
 */
import { IMAGE_DESIGNER_VISUAL_RULES } from "./skills";

const STYLE_RULES = IMAGE_DESIGNER_VISUAL_RULES;

/**
 * The only place this app can honestly put Leo's real likeness is
 * includePortrait's reference-image path (视频号封面, when a portrait has
 * been uploaded) — that's the one case the model is actually given his
 * real photo to work from. Every other image (公众号封面, and every 小红书
 * carousel page — neither has ever had reference-image support) has
 * nothing to base a likeness on, so a face the model draws there can only
 * ever be an invented one. This used to be left to a single unconditional
 * "if you draw him, use the real photo, don't invent a face" line shared
 * across every prompt (IMAGE_DESIGNER_VISUAL_RULES) — sound advice when a
 * reference photo is attached, but toothless without one, since the model
 * sometimes drew an invented face anyway (live incident, 2026-09-16: a
 * 公众号封面 and one 小红书 page each came back with a clearly-wrong face).
 * Forbidding a real-looking face outright, rather than conditioning
 * compliance on the model choosing to follow "don't invent one", is the
 * only way to make the no-reference case actually safe.
 */
const NO_REAL_FACE_INSTRUCTION =
  '\n\n这张图没有附带李尔王本人的参考照片，所以不能画出他的写实肖像或任何看起来像是他本人特写的人脸——这项"使用真实照片"的能力目前只在视频号封面里、确实附带参考图时才启用。如果画面确实需要人物元素，只能用完全抽象化/图标化的剪影或插画风格人形（不呈现具体五官、不构成对任何真实人物的写实描绘），不要凭空创作一张"像是他"的脸。';

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
    : NO_REAL_FACE_INSTRUCTION;

  const brandBadge = contentBrand
    ? `\n\n如果构图还有余量，可以在画面顶部或左上角放一个不起眼的小栏目标签（文字为"${contentBrand}"，字号明显小于主标题）——这是锦上添花，不是必须元素，真实发布的封面很多并不带这个标签，主标题和视觉焦点永远优先于它。`
    : "";

  const highlightRows =
    highlights.length > 0
      ? `\n\n画面中下方放置 ${highlights.length} 行简短的要点行，每行一个小图标 + 一小段文字，逐行竖直排列，风格统一、对齐工整（类似信息卡片里的条目，不是正文段落）。这些要点行有两种可能的内容，取决于下面提供的原文本身是哪一种——不需要你判断，原样呈现即可：可能是"标签：数值"式的数据要点，也可能是设问句（比如"没有大选，他怎么直接上台？"，这种情况下图标就配合问题主题选取，比如皇冠、脚步、时钟等）。文字内容严格使用下面提供的原文，不要改写、不要合并、不要新增：\n${highlights.map((h, i) => `${i + 1}. ${h}`).join("\n")}\n每个图标应是与该行内容相关的简单线性/剪影小图标，不要使用真实政府徽章或官方印章。`
      : "";

  const landscapeSafeArea =
    orientation === "landscape"
      ? "\n\n最终图片会居中裁切为 1922×818（约 2.35:1）的超宽横幅。所有主标题、副标题、标签和核心视觉元素必须放在画面垂直方向中央约 60% 的安全区内，顶部和底部只放可被裁掉的背景，不得放文字、人物脸部或关键图形。"
      : "";

  return `为${platformLabel}设计一张封面图。

标题：${content.title}
正文摘要（仅供理解主题背景，不要把里面的分点/清单/多条内容搬到封面上）：${content.text}
所属选题：${topic.title}（${topic.business}）

${STYLE_RULES}

封面版式：一个粗体、多行排列的主标题（可以拆成两三行短句，字号大、颜色为白色或金色，确保在深色背景上清晰可读），是画面里最主要的视觉焦点；最多再加一句更小字号的副标题。${brandBadge}${highlightRows}

如果上面没有提供数据/要点行，就不要在封面上编造编号列表、步骤清单或提示框——封面只做"一个吸引点"，不是内容摘要；只有在明确提供了数据行时，才按上面的格式呈现。可以点缀 1-2 个与主题相关的小型装饰性图标（不占主要视觉空间），增加设计感。${portraitInstruction}

构图：${orientation === "landscape" ? "横版通栏构图（宽大于高，适合作为文章顶部横幅图）" : "竖版构图"}。${landscapeSafeArea}`;
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

构图：竖版构图，与同一篇笔记里的其他页保持一致的视觉风格（配色、字体气质、排版逻辑），让人一眼看出这是同一组图文的第 ${page.pageNumber} 页。${NO_REAL_FACE_INSTRUCTION}`;
}
