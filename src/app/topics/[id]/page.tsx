import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAllProfiles,
  getContentAssets,
  getLatestResearchPack,
  getResearchSources,
  getResearchSourcesForPacks,
  getTopicActivity,
  getTopicById,
  isDemoMode,
} from "@/lib/topics";
import { getCurrentUser } from "@/lib/auth";
import {
  canApproveResearch,
  canArchiveTopic,
  canGenerateContent,
  canManageContentAssets,
  canRunResearch,
} from "@/lib/permissions";
import { canArchive, canStartResearch } from "@/lib/topic-workflow";
import { canApproveResearchFromStatus, canRunResearchFromStatus } from "@/lib/research-workflow";
import { isResearchAgentConfigured } from "@/lib/ai/research-agent";
import { isContentAgentConfigured } from "@/lib/ai/content-agent";
import { groupContentAssetsByLineage, groupSourcesByPackId } from "@/lib/content-versions";
import {
  CONTENT_PILLAR_LABEL,
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
import { archiveTopic, rescoreTopic, startResearch } from "../actions";
import { approveResearch, requestResearchChanges, runResearch } from "../research-actions";
import {
  generateContent,
  generateFullArticle,
  regeneratePlatformContent,
} from "../content-actions";
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

  const [activity, profiles, researchPack, contentAssets] = await Promise.all([
    getTopicActivity(topic.id),
    getAllProfiles(),
    getLatestResearchPack(topic.id),
    getContentAssets(topic.id),
  ]);
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

  const aiConfigured = isResearchAgentConfigured();
  const showRunResearch =
    canShowActions && canRunResearch(user.role) && canRunResearchFromStatus(topic.status);
  const showEditResearch = canShowActions && canRunResearch(user.role) && Boolean(researchPack);
  const showApproval =
    canShowActions &&
    canApproveResearch(user.role) &&
    canApproveResearchFromStatus(topic.status) &&
    Boolean(researchPack);

  // --- Content Agent -----------------------------------------------------
  const contentReady = isContentAgentConfigured();
  const contentGateOpen = canGenerateContent(topic.status);
  const canManageContent = canShowActions && canManageContentAssets(user.role);

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
          AI 未配置：请在 .env.local 设置 ANTHROPIC_API_KEY 后才能生成内容。
        </p>
      );
    }
    return null;
  }

  const platformTab = (
    platform: ContentPlatform,
    lineage: ReturnType<typeof groupContentAssetsByLineage>[number] | undefined,
    view: React.ReactNode,
  ) => {
    const failed = latestPlatformActivity(activity, platform);
    const showFailure =
      failed?.activity_type === "content_generation_failed" &&
      (!lineage || new Date(failed.created_at) > new Date(lineage.latest.created_at));

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
        {canManageContent && contentGateOpen && contentReady && (
          <div className="flex flex-wrap gap-2">
            <form action={regeneratePlatformContent.bind(null, topic.id, platform)}>
              <Button type="submit" variant={lineage ? "secondary" : "primary"}>
                {lineage ? "重新生成" : "生成"}
              </Button>
            </form>
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
              <ResearchPackView pack={researchPack} sources={researchSources} />
            ) : (
              <p className="text-sm text-[var(--muted)]">尚未运行研究。</p>
            )}
            {showRunResearch && !aiConfigured && (
              <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
                AI 未配置：请在 .env.local 设置 ANTHROPIC_API_KEY 后才能运行研究。
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {showRunResearch && (
                <form action={runResearch.bind(null, topic.id)}>
                  <Button type="submit" disabled={!aiConfigured}>
                    {researchPack ? "重新运行研究" : "运行研究"}
                  </Button>
                </form>
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
          <VideoContentView history={videoLineage.history} sourcesByPackId={contentSourcesByPackId} />
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
          <XiaohongshuContentView history={xhsLineage.history} sourcesByPackId={contentSourcesByPackId} />
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
              {canManageContent && contentGateOpen && contentReady && (
                <div className="flex flex-wrap gap-2">
                  <form action={generateFullArticle.bind(null, topic.id)}>
                    <Button type="submit" variant={wechatFullArticleLineage ? "secondary" : "primary"}>
                      生成完整文章
                    </Button>
                  </form>
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
      disabled: true,
      content: <p className="text-sm text-[var(--muted)]">合规审核功能将在下一阶段开放。</p>,
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

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-[var(--muted)]">选题问题</p>
          <p className="mt-0.5 text-sm">{topic.question || "—"}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)]">Business（业务线）</p>
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

      <section className="rounded-md border border-[var(--border)] px-4 py-3">
        <p className="text-xs text-[var(--muted)]">选题评分</p>
        <p className="mt-1 text-3xl font-semibold">{topic.topic_score}</p>
        <div className="mt-2 flex gap-4 text-xs text-[var(--muted)]">
          <span>优先级权重 {topic.score_breakdown.priority}</span>
          <span>完整度 {topic.score_breakdown.completeness}</span>
        </div>
      </section>

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
              AI 未配置：请在 .env.local 设置 ANTHROPIC_API_KEY 后才能生成内容。
            </p>
          ) : (
            <form action={generateContent.bind(null, topic.id)}>
              <Button type="submit">生成内容</Button>
            </form>
          )}
        </section>
      )}

      <section>
        <TopicTabs tabs={tabs} initialTabKey={initialTabKey} />
      </section>
    </div>
  );
}
