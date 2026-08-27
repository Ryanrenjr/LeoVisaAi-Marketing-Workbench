import Image from "next/image";
import { getCurrentUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/topics";
import { DIGITAL_EMPLOYEES, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeInstructions, getEmployeeInstructionVersions } from "@/lib/employee-instructions";
import type { EmployeeInstructionVersion } from "@/lib/employee-instructions";
import { getBrandConfig } from "@/lib/brand-config";
import { GLOBAL_SKILL, EMPLOYEE_DEFAULT_SKILL } from "@/lib/ai/skills";
import { updateEmployeeInstructions, restoreEmployeeInstructionVersion, updateBrandConfig } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import type { EmployeeId } from "@/lib/boss-language";

/**
 * 数字员工手册 — one page, every employee's job spelled out: a fixed
 * safety core (code-only, never editable here — GLOBAL_SKILL +
 * EMPLOYEE_DEFAULT_SKILL, see src/lib/ai/skills.ts) plus an ADMIN-editable
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
  reviser: "只修改合规审核员标出的具体问题，其余内容原样保留；不能为了改通顺而编造新的事实或数字；改不好就留给人工判断，不自称「已修好」。",
  integrator: "不生成、不修改任何内容——只把每个平台已经存在的最新文字和配图放在一起展示；缺文字或缺图就如实显示「待补充」，不自己生成来填补。",
  analyst: "只能读取截图里真实可见的数字，看不清就留空，不能靠猜；不读取截图里的人名或评论内容。",
  "xiaohongshu-image-planner": "只规划图文每一页写什么、怎么设计——不自己生成配图（那是图片设计员的工作），不写标题和发布文案（那是小红书标题文案员的工作）；不得直接把视频稿分页，不得编造未经研究支持的政策结论。",
};

const BRAND_CONFIG_FORM_FIELDS: Array<{ name: string; label: string; multiline?: boolean }> = [
  { name: "companyNameEn", label: "公司名（英文）" },
  { name: "companyNameZh", label: "公司名（中文）" },
  { name: "contentBrand", label: "内容品牌" },
  { name: "expertName", label: "专家 IP 名" },
  { name: "videoOutro", label: "视频号固定 Outro", multiline: true },
  { name: "wechatFooter", label: "公众号底部 Footer", multiline: true },
];

export default async function HandbookPage() {
  const [demo, user, employeeInstructions, brandConfig] = await Promise.all([
    isDemoMode(),
    getCurrentUser(),
    getEmployeeInstructions(),
    getBrandConfig(),
  ]);
  const canEdit = !demo && user?.role === "ADMIN";
  const versionsByEmployee: Partial<Record<EmployeeId, EmployeeInstructionVersion[]>> = canEdit
    ? Object.fromEntries(
        await Promise.all(
          DIGITAL_EMPLOYEES.map(async (e) => [e.id, await getEmployeeInstructionVersions(e.id)] as const),
        ),
      )
    : {};

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

      <details className="card px-5 py-4 text-sm">
        <summary className="cursor-pointer font-semibold">公司共同工作守则（Global Skill，全体员工共用，固定不可修改）</summary>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-[var(--muted)]">{GLOBAL_SKILL}</pre>
      </details>

      {canEdit && (
        <section className="card flex flex-col gap-3 px-5 py-4">
          <div>
            <p className="font-semibold">公司品牌配置</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              视频号/小红书/公众号生成后的品牌校验（见每篇内容下方的黄色提示）依据这里的值。留空的字段保持不变。
            </p>
          </div>
          <form action={updateBrandConfig} className="flex flex-col gap-3">
            {BRAND_CONFIG_FORM_FIELDS.map((field) => (
              <div key={field.name} className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-[var(--muted)]">{field.label}</label>
                {field.multiline ? (
                  <textarea
                    name={field.name}
                    defaultValue={brandConfig[field.name as keyof typeof brandConfig]}
                    rows={2}
                    className="rounded-[var(--radius-control)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                  />
                ) : (
                  <input
                    type="text"
                    name={field.name}
                    defaultValue={brandConfig[field.name as keyof typeof brandConfig]}
                    className="rounded-[var(--radius-control)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                  />
                )}
              </div>
            ))}
            <div>
              <Button type="submit" variant="secondary" className="text-sm">
                保存品牌配置
              </Button>
            </div>
          </form>
        </section>
      )}

      <div className="flex flex-col gap-6">
        {DIGITAL_EMPLOYEES.map((employee) => {
          const versions = versionsByEmployee[employee.id] ?? [];
          return (
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
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-[var(--muted)]">查看完整 Skill 原文</summary>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-[var(--muted)]">
                    {EMPLOYEE_DEFAULT_SKILL[employee.id]}
                  </pre>
                </details>
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
                  <label className="text-xs font-semibold text-[var(--muted)]">修改说明（可选，方便日后回顾这次改了什么）</label>
                  <input
                    type="text"
                    name="changeNote"
                    placeholder="例如：语气更简洁一些"
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

              {canEdit && versions.length > 0 && (
                <details className="rounded-[var(--radius-control)] border border-[var(--border)] px-3.5 py-3 text-sm">
                  <summary className="cursor-pointer text-xs font-semibold text-[var(--muted)]">
                    历史版本（{versions.length}）
                  </summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {versions.map((v) => (
                      <li key={v.id} className="rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-[var(--muted)]">
                            v{v.version} · {new Date(v.updated_at).toLocaleString("zh-CN")}
                            {v.change_note ? ` · ${v.change_note}` : ""}
                          </p>
                          {v.id !== versions[0].id && (
                            <form action={restoreEmployeeInstructionVersion}>
                              <input type="hidden" name="employeeId" value={employee.id} />
                              <input type="hidden" name="version" value={v.version} />
                              <Button type="submit" variant="secondary" className="text-xs">
                                恢复这个版本
                              </Button>
                            </form>
                          )}
                        </div>
                        {v.custom_instructions && (
                          <p className="mt-1 whitespace-pre-wrap text-xs">{v.custom_instructions}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
