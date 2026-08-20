import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getAllProfiles, getRecentStatusEvents, getResearchIntegrityIssues, isDemoMode } from "@/lib/topics";
import { STATUS_LABEL } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { inviteStaff, updateEmployeeName, updateUserRole } from "./actions";
import { DIGITAL_EMPLOYEES, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";

const INTEGRITY_ISSUE_LABEL = {
  missing_research_pack: "状态显示研究已完成，但没有真实的研究成果记录",
  missing_content_asset: "状态显示已生成内容，但没有真实的内容草稿记录",
};

const ROLE_LABEL = { ADMIN: "管理员", EXPERT: "专员" };

export default async function AdminPage() {
  const demo = await isDemoMode();
  const user = await getCurrentUser();

  if (!demo) {
    if (!user) redirect("/login");
    if (user.role !== "ADMIN") redirect("/");
  }

  const [profiles, events, integrityIssues, employeeNames] = await Promise.all([
    getAllProfiles(),
    getRecentStatusEvents(),
    getResearchIntegrityIssues(),
    getEmployeeNames(),
  ]);
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-lg font-semibold">管理</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">员工账号、AI 模型、审批记录都在这里。</p>
      </div>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase），角色管理与邀请功能已禁用。
        </p>
      )}

      <section className="rounded-md border border-[var(--border)] px-5 py-5">
        <h2 className="text-base font-medium">AI 模型配置</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          管理员唯一需要经常操作的地方：给每个数字员工的每项任务选一个 AI 供应商与模型。内容的质量和安全边界由系统固定规则自动把关，不需要手动管。
        </p>
        <Link href="/admin/ai-models" className="mt-3 inline-block">
          <Button>打开 AI 模型配置</Button>
        </Link>
      </section>

      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-[var(--muted)]">
          更多管理功能（员工账号、改名、记录）
        </summary>

        <div className="mt-6 flex flex-col gap-10">
          <section>
            <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">数字员工姓名</h2>
            <p className="mb-2 text-sm text-[var(--muted)]">
              给每个数字员工起个名字，方便记忆和交流。留空则恢复默认名称。
            </p>
            <ul>
              {DIGITAL_EMPLOYEES.map((employee) => (
                <li
                  key={employee.id}
                  className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-3 last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-sm font-semibold">
                      {employee.letter}
                    </span>
                    <div>
                      <p className="font-medium">{resolveEmployeeDisplayName(employee.id, employeeNames)}</p>
                      <p className="text-sm text-[var(--muted)]">{employee.responsibility}</p>
                    </div>
                  </div>
                  {demo ? null : (
                    <form action={updateEmployeeName} className="flex items-center gap-2">
                      <input type="hidden" name="employeeId" value={employee.id} />
                      <input
                        name="customName"
                        type="text"
                        placeholder={employee.name}
                        defaultValue={employeeNames[employee.id] ?? ""}
                        className="w-32 rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                      />
                      <Button type="submit" variant="secondary" className="text-xs">
                        保存
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">员工与角色</h2>
            <p className="mb-2 text-sm text-[var(--muted)]">改角色一选就生效，不用再点保存。</p>
            <ul>
              {profiles.map((profile) => (
                <li
                  key={profile.id}
                  className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-3 last:border-b-0"
                >
                  <div>
                    <p className="font-medium">{profile.display_name}</p>
                    <p className="text-sm text-[var(--muted)]">{profile.email}</p>
                  </div>
                  {demo ? (
                    <span className="text-sm text-[var(--muted)]">{ROLE_LABEL[profile.role]}</span>
                  ) : (
                    <AutoSubmitSelect
                      action={updateUserRole}
                      hiddenFields={{ userId: profile.id }}
                      name="role"
                      defaultValue={profile.role}
                      options={[
                        { value: "EXPERT", label: ROLE_LABEL.EXPERT },
                        { value: "ADMIN", label: ROLE_LABEL.ADMIN },
                      ]}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">邀请新员工</h2>
            <form action={inviteStaff} className="flex gap-2">
              <input
                name="email"
                type="email"
                placeholder="邮箱地址"
                required
                disabled={demo}
                className="flex-1 rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm disabled:opacity-50"
              />
              <Button type="submit" disabled={demo}>
                发送邀请
              </Button>
            </form>
          </section>

          {integrityIssues.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">数据完整性提醒</h2>
              <p className="mb-2 text-sm text-[var(--muted)]">
                以下选题的流水线状态与实际的研究/内容记录不一致（通常来自演示/种子数据，而非真实运行的研究或生成结果）。
              </p>
              <ul>
                {integrityIssues.map((issue) => (
                  <li
                    key={`${issue.topicId}-${issue.issue}`}
                    className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-2 text-sm last:border-b-0"
                  >
                    <span>
                      <Link href={`/topics/${issue.topicId}`} className="underline-offset-2 hover:underline">
                        {issue.code}
                      </Link>{" "}
                      {issue.title} — {INTEGRITY_ISSUE_LABEL[issue.issue]}
                    </span>
                    <span className="text-[var(--muted)]">{STATUS_LABEL[issue.status]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">审批记录</h2>
            {events.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">暂无记录。</p>
            ) : (
              <ul>
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="border-b border-[var(--border)] py-2 text-sm last:border-b-0"
                  >
                    <span className="text-[var(--muted)]">
                      {new Date(event.created_at).toLocaleString("zh-CN")}
                    </span>{" "}
                    — {profileById.get(event.approved_by)?.display_name ?? "未知用户"} 将选题标记为{" "}
                    {STATUS_LABEL[event.to_status]}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </details>
    </div>
  );
}
