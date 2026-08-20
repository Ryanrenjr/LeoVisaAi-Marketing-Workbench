import Link from "next/link";
import { getAllPublishPerformance } from "@/lib/analytics";
import { getAllTopics, isDemoMode } from "@/lib/topics";
import { getEmployeeNames } from "@/lib/employee-names";
import { resolveEmployeeDisplayName } from "@/lib/boss-language";
import { computePillarPerformance } from "@/lib/performance-analytics";
import { CONTENT_PILLAR_LABEL, CONTENT_PLATFORM_LABEL } from "@/lib/status";
import { UploadPerformanceForm } from "@/components/upload-performance-form";
import type { ContentPillar, ContentPlatform } from "@/lib/types";

export default async function AnalystPage() {
  const [demo, allTopics, performance, employeeNames] = await Promise.all([
    isDemoMode(),
    getAllTopics(),
    getAllPublishPerformance(),
    getEmployeeNames(),
  ]);

  const publishedTopics = allTopics.filter((t) => t.status === "PUBLISHED");
  const topicsById = new Map(allTopics.map((t) => [t.id, t]));
  const pillarPerformance = computePillarPerformance(performance, topicsById);
  const employeeName = resolveEmployeeDisplayName("analyst", employeeNames);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-sm font-semibold">
            E
          </span>
          <h1 className="text-lg font-semibold">{employeeName}</h1>
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">
          发布之后，把数据截图传给我，我帮你读数字、算平均，告诉你哪类选题表现更好。
        </p>
      </div>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase），截图上传已禁用。
        </p>
      )}

      {!demo && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-[var(--muted)]">上传发布数据截图</h2>
          <UploadPerformanceForm publishedTopics={publishedTopics} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-[var(--muted)]">哪类选题表现更好</h2>
        {pillarPerformance.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">还没有足够的发布数据，上传几张截图后会显示在这里。</p>
        ) : (
          <ul>
            {pillarPerformance.map((p) => (
              <li
                key={p.pillar}
                className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-2 text-sm last:border-b-0"
              >
                <span>
                  {p.pillar === "unset" ? "未分类" : CONTENT_PILLAR_LABEL[p.pillar as ContentPillar]}
                  <span className="ml-2 text-[var(--muted)]">{p.postCount} 篇</span>
                </span>
                <span className="text-[var(--muted)]">
                  平均阅读 {p.avgViews ?? "—"} · 平均点赞 {p.avgLikes ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-[var(--muted)]">最近上传</h2>
        {performance.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">暂无记录。</p>
        ) : (
          <ul>
            {performance.slice(0, 20).map((row) => {
              const topic = topicsById.get(row.topic_id);
              const metrics = row.extracted_metrics as {
                views?: number | null;
                likes?: number | null;
                comments?: number | null;
                saves?: number | null;
              };
              return (
                <li key={row.id} className="border-b border-[var(--border)] py-2 text-sm last:border-b-0">
                  <div className="flex items-center justify-between gap-4">
                    <Link href={topic ? `/topics/${topic.id}` : "#"} className="min-w-0 truncate hover:underline">
                      {topic?.title ?? "（选题已删除）"}
                    </Link>
                    <span className="shrink-0 text-[var(--muted)]">
                      {CONTENT_PLATFORM_LABEL[row.platform as ContentPlatform] ?? row.platform}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[var(--muted)]">
                    阅读 {metrics.views ?? "—"} · 点赞 {metrics.likes ?? "—"} · 评论 {metrics.comments ?? "—"} ·
                    收藏 {metrics.saves ?? "—"} · {new Date(row.created_at).toLocaleDateString("zh-CN")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
