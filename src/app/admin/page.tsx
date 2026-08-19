import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getAllProfiles, getRecentStatusEvents, isDemoMode } from "@/lib/topics";
import { STATUS_LABEL } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { inviteStaff, updateUserRole } from "./actions";

export default async function AdminPage() {
  const demo = await isDemoMode();
  const user = await getCurrentUser();

  if (!demo) {
    if (!user) redirect("/login");
    if (user.role !== "ADMIN") redirect("/");
  }

  const [profiles, events] = await Promise.all([getAllProfiles(), getRecentStatusEvents()]);
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-lg font-semibold">管理</h1>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase），角色管理与邀请功能已禁用。
        </p>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">员工与角色</h2>
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
                <span className="text-sm text-[var(--muted)]">{profile.role}</span>
              ) : (
                <form action={updateUserRole} className="flex items-center gap-2">
                  <input type="hidden" name="userId" value={profile.id} />
                  <select
                    name="role"
                    defaultValue={profile.role}
                    className="rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                  >
                    <option value="EXPERT">EXPERT</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
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
  );
}
