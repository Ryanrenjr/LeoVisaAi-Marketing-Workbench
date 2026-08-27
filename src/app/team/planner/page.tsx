import { isDemoMode } from "@/lib/topics";
import { getEmployee, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";
import { EmployeeHeader } from "@/components/employee-header";
import { TopicDiscoveryPanel } from "@/components/topic-discovery-panel";

/**
 * Live user instruction: this page is used by a non-technical employee who
 * doesn't know software or AI — one job, one button. Everything that isn't
 * "搜索当日选题 → ✓/✗ each candidate" was removed: the 查看选题/新建想法
 * links (no replacement entry point — /topics and /topics/new are URL-only
 * now, same as the other pipeline-stage pages since 运营列表 was dropped),
 * and the three redundant topic lists that mostly repeated the same
 * handful of topics under different headers. Live user instruction
 * (follow-up): the model is locked here for everyone, ADMIN included —
 * "用户不能更改，我到时候在后台更改就行了" — so `modelOptions` is always null
 * (never fetched via getTaskModelOptions), which makes TopicDiscoveryPanel
 * render its plain-button fallback with no "更换本次模型"/"测试这个模型"
 * controls. The task still runs on whatever model ADMIN has configured as
 * TOPIC_DISCOVERY's default in /admin/ai-models — only the picker is
 * hidden, not the underlying Model Router behavior.
 */
export default async function PlannerPage() {
  const employee = getEmployee("planner");
  const [demo, employeeNames] = await Promise.all([isDemoMode(), getEmployeeNames()]);
  const employeeName = resolveEmployeeDisplayName("planner", employeeNames);

  return (
    <div className="flex flex-col gap-8">
      <EmployeeHeader avatarId="planner" letter={employee.letter} name={employeeName} subtitle="今天值得做什么？" />

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase），选题搜索已禁用。
        </p>
      )}

      {!demo && <TopicDiscoveryPanel modelOptions={null} />}
    </div>
  );
}
