import Image from "next/image";
import { getCurrentUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/topics";
import { DIGITAL_EMPLOYEES, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeInstructions } from "@/lib/employee-instructions";
import { updateEmployeeInstructions } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { TOPIC_DISCOVERY_SYSTEM_PROMPT } from "@/lib/ai/topic-discovery";
import { EXTERNAL_RESEARCH_SYSTEM_PROMPT } from "@/lib/ai/research-external";
import {
  VIDEO_SYSTEM_PROMPT,
  XHS_SYSTEM_PROMPT,
  WECHAT_OUTLINE_SYSTEM_PROMPT,
} from "@/lib/ai/content-schemas";
import { COMPLIANCE_SYSTEM_PROMPT } from "@/lib/ai/compliance-schemas";
import { PERFORMANCE_EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/performance-schemas";
import type { EmployeeId } from "@/lib/boss-language";

/**
 * 数字员工手册 — one page, every employee's job spelled out: a fixed
 * safety core (code-only, never editable here) plus an ADMIN-editable
 * addendum (tone/style/extra guidance), appended after the core every
 * time that employee actually runs — see src/lib/ai/prompt-addendum.ts.
 * Live user instruction: "我可以随时更改".
 */
const CORE_SUMMARY: Record<EmployeeId, string> = {
  planner: "只能从真实检索到的新闻里提炼选题，不能编造没有真实新闻支持的候选。",
  researcher: "只能引用真实检索到的来源，不能编造网址或数据；只写通用营销研究，不针对具体个人案件；证据不够就必须诚实标「低置信度」。",
  "video-editor": "只能使用已批准研究成果里的结论，不能编造新的政策细节、数字或截止日期；禁止夸大/制造焦虑的措辞；引用的来源必须是真实提供的标签。",
  "xiaohongshu-editor": "只能使用已批准研究成果里的结论，不能编造新的政策细节、数字或截止日期；禁止夸大/制造焦虑的措辞；引用的来源必须是真实提供的标签。",
  "wechat-editor": "只能使用已批准研究成果里的结论，不能编造新的政策细节、数字或截止日期；禁止夸大/制造焦虑的措辞；引用的来源必须是真实提供的标签。",
  "image-designer": "封面图里不能出现虚构的政府机构官方标志、印章或证件；图片内容必须来自已经人工审核过的小红书文案。",
  compliance: "只做复核，不做认证——永远不会说内容「合规/通过」，只列出具体问题交给人判断。",
  analyst: "只能读取截图里真实可见的数字，看不清就留空，不能靠猜；不读取截图里的人名或评论内容。",
};

const RAW_PROMPT: Partial<Record<EmployeeId, string>> = {
  planner: TOPIC_DISCOVERY_SYSTEM_PROMPT,
  researcher: EXTERNAL_RESEARCH_SYSTEM_PROMPT,
  "video-editor": VIDEO_SYSTEM_PROMPT,
  "xiaohongshu-editor": XHS_SYSTEM_PROMPT,
  "wechat-editor": WECHAT_OUTLINE_SYSTEM_PROMPT,
  compliance: COMPLIANCE_SYSTEM_PROMPT,
  analyst: PERFORMANCE_EXTRACTION_SYSTEM_PROMPT,
};

export default async function HandbookPage() {
  const [demo, user, employeeInstructions] = await Promise.all([
    isDemoMode(),
    getCurrentUser(),
    getEmployeeInstructions(),
  ]);
  const canEdit = !demo && user?.role === "ADMIN";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">数字员工手册</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          每个员工工作时遵守两层规则：下面灰底的是写死在代码里的安全底线，谁都改不了；白底文本框是补充说明，
          {canEdit ? "你随时可以改。" : "只有管理员能改。"}
        </p>
      </div>

      {demo && (
        <p className="card px-4 py-3 text-sm text-[var(--muted)]">当前为演示数据（未连接 Supabase），编辑已禁用。</p>
      )}

      <div className="flex flex-col gap-6">
        {DIGITAL_EMPLOYEES.map((employee) => (
          <section key={employee.id} className="card flex flex-col gap-3 px-5 py-4">
            <div className="flex items-center gap-3">
              <Image
                src={`/employees/${employee.id}.png`}
                alt=""
                width={48}
                height={48}
                className="h-12 w-12 shrink-0 rounded-full object-cover"
              />
              <div>
                <p className="font-semibold">{resolveEmployeeDisplayName(employee.id, {})}</p>
                <p className="text-xs text-[var(--muted)]">{employee.responsibility}</p>
              </div>
            </div>

            <div className="rounded-[var(--radius-control)] bg-[var(--muted)]/8 px-3.5 py-3 text-sm">
              <p className="mb-1 text-xs font-semibold text-[var(--muted)]">安全底线（固定，不可修改）</p>
              {CORE_SUMMARY[employee.id]}
              {RAW_PROMPT[employee.id] && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-[var(--muted)]">查看完整系统规则原文（英文）</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-[var(--muted)]">
                    {RAW_PROMPT[employee.id]}
                  </pre>
                </details>
              )}
            </div>

            {canEdit ? (
              <form action={updateEmployeeInstructions} className="flex flex-col gap-2">
                <input type="hidden" name="employeeId" value={employee.id} />
                <label className="text-xs font-semibold text-[var(--muted)]">补充说明（语气、风格、额外注意事项）</label>
                <textarea
                  name="customInstructions"
                  defaultValue={employeeInstructions[employee.id] ?? ""}
                  rows={3}
                  placeholder="留空则不追加任何内容"
                  className="rounded-[var(--radius-control)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                />
                <div>
                  <Button type="submit" variant="secondary" className="text-sm">
                    保存
                  </Button>
                </div>
              </form>
            ) : (
              employeeInstructions[employee.id] && (
                <div className="rounded-[var(--radius-control)] border border-[var(--border)] px-3.5 py-3 text-sm">
                  <p className="mb-1 text-xs font-semibold text-[var(--muted)]">补充说明</p>
                  {employeeInstructions[employee.id]}
                </div>
              )
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
