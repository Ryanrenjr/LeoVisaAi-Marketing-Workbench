import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAllProfiles,
  getComplianceReviews,
  getContentAssets,
  getLatestResearchPack,
  getResearchSources,
  getResearchSourcesForPacks,
  getTopicActivity,
  getTopicById,
  isDemoMode,
} from "@/lib/topics";
import { getContentImagesForTopic } from "@/lib/content-images";
import { getCurrentUser } from "@/lib/auth";
import {
  canApproveResearch,
  canArchiveTopic,
  canGenerateContent,
  canManageContentAssets,
  canRunCompliance,
  canRunResearch,
} from "@/lib/permissions";
import { canArchive, canStartResearch, isAtOrPastStage } from "@/lib/topic-workflow";
import { AdvanceButton } from "@/components/advance-button";
import { canApproveResearchFromStatus, canRunResearchFromStatus } from "@/lib/research-workflow";
import { getTaskModelOptions } from "@/lib/ai/task-model-options";
import { GenerateAction } from "@/components/ai/generate-action";
import { groupContentAssetsByLineage, groupSourcesByPackId } from "@/lib/content-versions";
import {
  CONTENT_PILLAR_LABEL,
  CONTENT_PLATFORM_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TOPIC_ACTIVITY_LABEL,
} from "@/lib/status";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { ResearchPackView } from "@/components/research-pack-view";
import { TopicTabs, type TabDef } from "@/components/content/topic-tabs";
import { VideoContentView } from "@/components/content/video-content-view";
import { XiaohongshuContentView } from "@/components/content/xiaohongshu-content-view";
import { WechatFullArticleView, WechatOutlineView } from "@/components/content/wechat-content-view";
import { ComplianceReviewResult } from "@/components/compliance-review-result";
import { archiveTopic, rescoreTopic, startResearch } from "../actions";
import { approveResearch, requestResearchChanges, runResearch } from "../research-actions";
import {
  generateContent,
  generateFullArticle,
  regeneratePlatformContent,
} from "../content-actions";
import { runComplianceReview } from "../compliance-actions";
import type { ContentPlatform, TopicActivity } from "@/lib/types";

function latestPlatformActivity(
  activity: TopicActivity[],
  platform: ContentPlatform,
): TopicActivity | null {
  return (
    activity.find(
      (a) =>
        (a.activity_type === "content_generated" ||
          a.activity_type === "content_regenerated" ||
          a.activity_type === "content_generation_failed") &&
        (a.detail as { platform?: string } | null)?.platform === platform,
    ) ?? null
  );
}

export default async function TopicDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: initialTabKey } = await searchParams;
  const [topic, demo, user] = await Promise.all([
    getTopicById(id),
    isDemoMode(),
    getCurrentUser(),
  ]);

  if (!topic) notFound();

  const [activity, profiles, researchPack, contentAssets, complianceReviews, contentImages] = await Promise.all([
    getTopicActivity(topic.id),
    getAllProfiles(),
    getLatestResearchPack(topic.id),
    getContentAssets(topic.id),
    getComplianceReviews(topic.id),
    getContentImagesForTopic(topic.id),
  ]);
  const imagesByAssetId = new Map<string, typeof contentImages>();
  for (const image of contentImages) {
    if (!image.content_asset_id) continue;
    const list = imagesByAssetId.get(image.content_asset_id);
    if (list) list.push(image);
    else imagesByAssetId.set(image.content_asset_id, [image]);
  }
  const latestComplianceReviewByAssetId = new Map<string, (typeof complianceReviews)[number]>();
  for (const review of complianceReviews) {
    // reviews are sorted newest-first (getComplianceReviews), keep only the first (latest) per asset
    if (!latestComplianceReviewByAssetId.has(review.content_asset_id)) {
      latestComplianceReviewByAssetId.set(review.content_asset_id, review);
    }
  }
  const researchSources = researchPack ? await getResearchSources(researchPack.id) : [];
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  // Every content asset must resolve sources from the exact
  // research_pack_id stored on that row — never the topic's current
  // pack — so old versions stay traceable to the research that actually
  // produced them, even after the topic's research is re-run and
  // re-approved. See docs/phase-4-plan.md "Source traceability".
  const contentPackIds = Array.from(new Set(contentAssets.map((a) => a.research_pack_id)));
  const contentSources = await getResearchSourcesForPacks(contentPackIds);
  const contentSourcesByPackId = groupSourcesByPackId(contentSources);

  const canShowActions = !demo && user;
  const showStartResearch = canShowActions && canStartResearch(topic.status);
  const showArchive = canShowActions && canArchiveTopic(user.role) && canArchive(topic.status);

  const showRunResearch =
    canShowActions && canRunResearch(user.role) && canRunResearchFromStatus(topic.status);
  const showEditResearch = canShowActions && canRunResearch(user.role) && Boolean(researchPack);
  const showApproval =
    canShowActions &&
    canApproveResearch(user.role) &&
    canApproveResearchFromStatus(topic.status) &&
    Boolean(researchPack);

  // --- Content Agent -----------------------------------------------------
  const contentGateOpen = canGenerateContent(topic.status);
  const canManageContent = canShowActions && canManageContentAssets(user.role);
  const canRunComplianceHere = canShowActions && canRunCompliance(user.role);

  // Model Router options — only needed for the ADMIN who can actually run
  // these tasks. Each option set is independent (per task type), computed
  // without executing anything. See docs/model-router.md.
  const isAdmin = canShowActions && user.role === "ADMIN";
  const [researchOptions, videoOptions, xhsOptions, wechatOptions, wechatFullOptions, complianceOptions] = isAdmin
    ? await Promise.all([
        getTaskModelOptions("RESEARCH"),
        getTaskModelOptions("VIDEO_WRITING"),
        getTaskModelOptions("XIAOHONGSHU_WRITING"),
        getTaskModelOptions("WECHAT_WRITING"),
        getTaskModelOptions("WECHAT_FULL_ARTICLE"),
        getTaskModelOptions("COMPLIANCE"),
      ])
    : [null, null, null, null, null, null];

  const aiConfigured = Boolean(researchOptions?.models.some((m) => m.configured));
  const contentReady = Boolean(videoOptions?.models.some((m) => m.configured));
  const platformTaskOptions: Record<ContentPlatform, typeof videoOptions> = {
    VIDEO_CHANNEL: videoOptions,
    XIAOHONGSHU: xhsOptions,
    WECHAT_OFFICIAL_ACCOUNT: wechatOptions,
  };

  const lineages = groupContentAssetsByLineage(contentAssets);
  const videoLineage = lineages.find(
    (l) => l.platform === "VIDEO_CHANNEL" && l.contentType === "video_script",
  );
  const xhsLineage = lineages.find(
    (l) => l.platform === "XIAOHONGSHU" && l.contentType === "xiaohongshu_post",
  );
  const wechatOutlineLineage = lineages.find(
    (l) => l.platform === "WECHAT_OFFICIAL_ACCOUNT" && l.contentType === "wechat_outline",
  );
  const wechatFullArticleLineage = lineages.find(
    (l) => l.platform === "WECHAT_OFFICIAL_ACCOUNT" && l.contentType === "wechat_full_article",
  );

  function generateGateNotice() {
    if (!contentGateOpen) {
      return (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          研究尚未批准，需先完成「研究包」标签页中的批准流程才能生成内容。
        </p>
      );
    }
    if (!contentReady) {
      return (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          AI 未配置：请在 .env.local 设置至少一个 AI 供应商的 API Key（ANTHROPIC_API_KEY /
          GOOGLE_AI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY）后才能生成内容。
        </p>
      );
    }
    return null;
  }

  const PLATFORM_TASK_TYPE: Record<ContentPlatform, "VIDEO_WRITING" | "XIAOHONGSHU_WRITING" | "WECHAT_WRITING"> = {
    VIDEO_CHANNEL: "VIDEO_WRITING",
    XIAOHONGSHU: "XIAOHONGSHU_WRITING",
    WECHAT_OFFICIAL_ACCOUNT: "WECHAT_WRITING",
  };

  const platformTab = (
    platform: ContentPlatform,
    lineage: ReturnType<typeof groupContentAssetsByLineage>[number] | undefined,
    view: React.ReactNode,
  ) => {
    const failed = latestPlatformActivity(activity, platform);
    const showFailure =
      failed?.activity_type === "content_generation_failed" &&
      (!lineage || new Date(failed.created_at) > new Date(lineage.latest.created_at));
    const taskOptions = platformTaskOptions[platform];

    return (
      <div className="flex flex-col gap-4">
        {demo && (
          <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
            当前为演示数据（未连接 Supabase），以下内容为占位演示，非真实生成结果。
          </p>
        )}
        {lineage ? view : <p className="text-sm text-[var(--muted)]">尚未生成。</p>}
        {showFailure && (
          <p className="rounded-md border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-900 dark:text-red-200">
            最近一次生成失败：{String(failed?.detail?.error ?? "未知错误")}
          </p>
        )}
        {canManageContent && generateGateNotice()}
        {canManageContent && contentGateOpen && contentReady && taskOptions && (
          <div className="flex flex-wrap items-start gap-2">
            <GenerateAction
              action={regeneratePlatformContent.bind(null, topic.id, platform)}
              label={lineage ? "重新生成" : "生成"}
              variant={lineage ? "secondary" : "primary"}
              taskType={PLATFORM_TASK_TYPE[platform]}
              models={taskOptions.models}
              defaultModel={taskOptions.defaultModel}
              resolutionError={taskOptions.resolutionError}
            />
            {lineage && (
              <Link href={`/topics/${topic.id}/content/${lineage.latest.id}/edit`}>
                <Button variant="secondary">编辑</Button>
              </Link>
            )}
          </div>
        )}
      </div>
    );
  };

  const complianceSection = (platformLabel: string, asset: (typeof contentAssets)[number] | undefined) => {
    if (!asset) return null;
    const review = latestComplianceReviewByAssetId.get(asset.id);
    return (
      <div key={asset.id} className="border-b border-[var(--border)] pb-4 last:border-b-0">
        <p className="text-sm font-medium">{platformLabel}</p>
        {review && <ComplianceReviewResult review={review} />}
        {canRunComplianceHere && complianceOptions && (
          <div className="mt-2">
            <GenerateAction
              action={runComplianceReview.bind(null, asset.id)}
              label={review ? "重新审核" : "运行合规审核"}
              taskType="COMPLIANCE"
              className="w-full py-3"
              models={complianceOptions.models}
              defaultModel={complianceOptions.defaultModel}
              resolutionError={complianceOptions.resolutionError}
            />
          </div>
        )}
        {canManageContent && (
          <Link href={`/topics/${topic.id}/content/${asset.id}/edit`} className="mt-2 inline-block">
            <Button variant="secondary" className="text-sm">
              编辑
            </Button>
          </Link>
        )}
      </div>
    );
  };

  const tabs: TabDef[] = [
    {
      key: "research",
      label: "研究包",
      content:
        topic.status === "IDEA" ? (
          <p className="text-sm text-[var(--muted)]">选题尚在构思阶段，尚未开始研究。</p>
        ) : (
          <div className="flex flex-col gap-4">
            {researchPack ? (
              <ResearchPackView pack={researchPack} sources={researchSources} topic={topic} />
            ) : (
              <p className="text-sm text-[var(--muted)]">尚未运行研究。</p>
            )}
            {showRunResearch && !aiConfigured && (
              <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
                AI 未配置：请在 .env.local 设置至少一个支持联网研究的供应商（ANTHROPIC_API_KEY 或
                GOOGLE_AI_API_KEY）后才能运行研究。
              </p>
            )}
            <div className="flex flex-wrap items-start gap-2">
              {showRunResearch && researchOptions && (
                <GenerateAction
                  action={runResearch.bind(null, topic.id)}
                  label={researchPack ? "重新运行研究" : "运行研究"}
                  taskType="RESEARCH"
                  models={researchOptions.models}
                  defaultModel={researchOptions.defaultModel}
                  resolutionError={researchOptions.resolutionError}
                />
              )}
              {showEditResearch && (
                <Link href={`/topics/${topic.id}/research/edit`}>
                  <Button variant="secondary">编辑研究成果</Button>
                </Link>
              )}
            </div>
            {showApproval && researchPack && (
              <div className="flex flex-col gap-3 rounded-md border border-[var(--border)] px-4 py-3">
                <p className="text-sm font-medium">专家审批</p>
                <form action={approveResearch.bind(null, topic.id, researchPack.id)}>
                  <Button type="submit">批准研究</Button>
                </form>
                <form
                  action={requestResearchChanges.bind(null, topic.id, researchPack.id)}
                  className="flex flex-col gap-2"
                >
                  <textarea
                    name="note"
                    placeholder="请求修改的原因（可选）"
                    rows={2}
                    className="rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
                  />
                  <div>
                    <Button type="submit" variant="secondary">
                      请求修改
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>
        ),
    },
    {
      key: "video",
      label: "视频号",
      content: platformTab(
        "VIDEO_CHANNEL",
        videoLineage,
        videoLineage && (
          <VideoContentView
            history={videoLineage.history}
            sourcesByPackId={contentSourcesByPackId}
            images={imagesByAssetId.get(videoLineage.latest.id) ?? []}
          />
        ),
      ),
    },
    {
      key: "xiaohongshu",
      label: "小红书",
      content: platformTab(
        "XIAOHONGSHU",
        xhsLineage,
        xhsLineage && (
          <XiaohongshuContentView
            history={xhsLineage.history}
            sourcesByPackId={contentSourcesByPackId}
            images={imagesByAssetId.get(xhsLineage.latest.id) ?? []}
          />
        ),
      ),
    },
    {
      key: "wechat",
      label: "公众号",
      content: (
        <div className="flex flex-col gap-6">
          {platformTab(
            "WECHAT_OFFICIAL_ACCOUNT",
            wechatOutlineLineage,
            wechatOutlineLineage && (
              <WechatOutlineView
                history={wechatOutlineLineage.history}
                sourcesByPackId={contentSourcesByPackId}
                images={imagesByAssetId.get(wechatOutlineLineage.latest.id) ?? []}
              />
            ),
          )}
          {wechatOutlineLineage && (
            <div className="flex flex-col gap-4 border-t border-[var(--border)] pt-6">
              <h3 className="text-sm font-medium text-[var(--muted)]">完整文章</h3>
              {wechatFullArticleLineage ? (
                <WechatFullArticleView
                  history={wechatFullArticleLineage.history}
                  sourcesByPackId={contentSourcesByPackId}
                />
              ) : (
                <p className="text-sm text-[var(--muted)]">尚未生成完整文章。</p>
              )}
              {canManageContent && contentGateOpen && contentReady && wechatFullOptions && (
                <div className="flex flex-wrap items-start gap-2">
                  <GenerateAction
                    action={generateFullArticle.bind(null, topic.id)}
                    label="生成完整文章"
                    variant={wechatFullArticleLineage ? "secondary" : "primary"}
                    taskType="WECHAT_FULL_ARTICLE"
                    models={wechatFullOptions.models}
                    defaultModel={wechatFullOptions.defaultModel}
                    resolutionError={wechatFullOptions.resolutionError}
                  />
                  {wechatFullArticleLineage && (
                    <Link href={`/topics/${topic.id}/content/${wechatFullArticleLineage.latest.id}/edit`}>
                      <Button variant="secondary">编辑</Button>
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "compliance",
      label: "合规",
      content:
        !videoLineage && !xhsLineage && !wechatOutlineLineage && !wechatFullArticleLineage ? (
          <p className="text-sm text-[var(--muted)]">尚未生成任何内容草稿，暂无可审核的内容。</p>
        ) : (
          <div className="flex flex-col gap-4">
            {complianceSection(CONTENT_PLATFORM_LABEL.VIDEO_CHANNEL, videoLineage?.latest)}
            {complianceSection(CONTENT_PLATFORM_LABEL.XIAOHONGSHU, xhsLineage?.latest)}
            {complianceSection(`${CONTENT_PLATFORM_LABEL.WECHAT_OFFICIAL_ACCOUNT}大纲`, wechatOutlineLineage?.latest)}
            {complianceSection(
              `${CONTENT_PLATFORM_LABEL.WECHAT_OFFICIAL_ACCOUNT}完整文章`,
              wechatFullArticleLineage?.latest,
            )}
          </div>
        ),
    },
    {
      key: "activity",
      label: "记录",
      content:
        activity.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">暂无记录。</p>
        ) : (
          <ul>
            {activity.map((event) => (
              <li
                key={event.id}
                className="border-b border-[var(--border)] py-2 text-sm last:border-b-0"
              >
                <span className="text-[var(--muted)]">
                  {new Date(event.created_at).toLocaleString("zh-CN")}
                </span>{" "}
                — {profileById.get(event.actor_id)?.display_name ?? "未知用户"}{" "}
                {TOPIC_ACTIVITY_LABEL[event.activity_type]}
                {(event.activity_type === "research_run_failed" ||
                  event.activity_type === "content_generation_failed") &&
                event.detail?.error ? (
                  <span className="text-[var(--muted)]"> — {String(event.detail.error)}</span>
                ) : null}
                {event.activity_type === "research_run_completed" &&
                event.detail?.sourceCount !== undefined ? (
                  <span className="text-[var(--muted)]">
                    {" "}
                    — 找到 {String(event.detail.sourceCount)} 条来源
                  </span>
                ) : null}
                {(event.activity_type === "content_generated" ||
                  event.activity_type === "content_regenerated") &&
                event.detail?.platform ? (
                  <span className="text-[var(--muted)]">
                    {" "}
                    — {String(event.detail.platform)} v{String(event.detail.version ?? "")}
                  </span>
                ) : null}
                {canManageContent && event.detail?.usageLogFailed ? (
                  <span className="text-[var(--muted)]"> · AI 使用记录写入失败</span>
                ) : null}
              </li>
            ))}
          </ul>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-xs text-[var(--muted)]">{topic.code}</p>
        <h1 className="text-lg font-semibold">{topic.title}</h1>
        <div className="mt-2 flex items-center gap-2">
          <StatusBadge status={topic.status} />
          <span className="text-xs text-[var(--muted)]">{STATUS_LABEL[topic.status]}</span>
        </div>
      </div>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase），操作已禁用。
        </p>
      )}

      {topic.question && <p className="text-sm">{topic.question}</p>}

      <details className="group rounded-md border border-[var(--border)]">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
          更多信息（业务线、受众、评分等）
        </summary>
        <div className="flex flex-col gap-4 border-t border-[var(--border)] px-4 py-4">
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-[var(--muted)]">业务线</p>
              <p className="mt-0.5 text-sm">{topic.business || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)]">目标受众</p>
              <p className="mt-0.5 text-sm">{topic.audience || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)]">内容支柱</p>
              <p className="mt-0.5 text-sm">
                {topic.content_pillar ? CONTENT_PILLAR_LABEL[topic.content_pillar] : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)]">优先级</p>
              <p className="mt-0.5 text-sm">{PRIORITY_LABEL[topic.priority]}</p>
            </div>
          </section>

          <section>
            <p className="text-xs text-[var(--muted)]">选题评分</p>
            <p className="mt-1 text-2xl font-semibold">{topic.topic_score}</p>
            <div className="mt-1 flex gap-4 text-xs text-[var(--muted)]">
              <span>优先级权重 {topic.score_breakdown.priority}</span>
              <span>完整度 {topic.score_breakdown.completeness}</span>
            </div>
          </section>
        </div>
      </details>

      <section className="flex flex-wrap gap-2">
        {!demo && (
          <Link href={`/topics/${topic.id}/edit`}>
            <Button variant="secondary">编辑</Button>
          </Link>
        )}
        {!demo && (
          <form action={rescoreTopic.bind(null, topic.id)}>
            <Button type="submit" variant="secondary">
              重新评分
            </Button>
          </form>
        )}
        {showStartResearch && (
          <form action={startResearch.bind(null, topic.id, topic.status)}>
            <Button type="submit">开始研究</Button>
          </form>
        )}
        {showArchive && (
          <form action={archiveTopic.bind(null, topic.id, topic.status)}>
            <Button type="submit" variant="secondary">
              归档
            </Button>
          </form>
        )}
        {canShowActions && isAtOrPastStage(topic.status, "CONTENT_DRAFT") && <AdvanceButton topic={topic} />}
      </section>

      {canManageContent && contentGateOpen && contentAssets.length === 0 && (
        <section className="flex flex-col gap-3 rounded-md border border-[var(--border)] px-4 py-3">
          <div>
            <p className="text-sm font-medium">生成内容</p>
            <p className="text-sm text-[var(--muted)]">
              研究已批准 — 可基于已批准的研究包一次生成视频号 / 小红书 / 公众号三个平台的草稿。
            </p>
          </div>
          {!contentReady ? (
            <p className="text-sm text-[var(--muted)]">
              AI 未配置：请在 .env.local 设置至少一个 AI 供应商的 API Key 后才能生成内容。
            </p>
          ) : (
            <>
              <p className="text-xs text-[var(--muted)]">
                三个平台各自按「AI 模型配置」中的默认模型独立生成；如需为单个平台更换模型，请在生成后使用对应标签页的「重新生成」。
              </p>
              <form action={generateContent.bind(null, topic.id)}>
                <Button type="submit">生成内容</Button>
              </form>
            </>
          )}
        </section>
      )}

      {videoLineage && xhsLineage && wechatOutlineLineage && (
        <p className="card px-4 py-3 text-sm">
          三个平台的内容草稿都已就绪 →{" "}
          <Link href={`/topics/${topic.id}?tab=compliance`} className="font-medium text-[var(--accent)] hover:underline">
            去审核
          </Link>
        </p>
      )}

      <section>
        <TopicTabs tabs={tabs} initialTabKey={initialTabKey} />
      </section>
    </div>
  );
}
