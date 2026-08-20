import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/topics";
import { getModelRoutingConfig } from "@/lib/ai/model-config";
import { isDevelopmentMode } from "@/lib/ai/router";
import { listModelsForTask, isProviderConfigured, providerEnvVarName } from "@/lib/ai/providers/registry";
import { AI_PROVIDER_IDS, PRICING_LABEL, TASK_TYPES, TASK_TYPE_EMPLOYEE, TASK_TYPE_LABEL } from "@/lib/ai/providers/types";
import { listSearchProviders, isSearchProviderConfigured, searchProviderEnvVarName } from "@/lib/search/registry";
import { DIGITAL_EMPLOYEES, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";
import { ProviderHealthCheck } from "@/components/ai/provider-health-check";
import { SearchProviderHealthCheck } from "@/components/ai/search-provider-health-check";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { setTaskModelDefault } from "../actions";

export default async function AiModelsPage() {
  const demo = await isDemoMode();
  const user = await getCurrentUser();

  if (!demo) {
    if (!user) redirect("/login");
    if (user.role !== "ADMIN") redirect("/");
  }

  const [config, employeeNames] = demo
    ? [{}, {}]
    : await Promise.all([getModelRoutingConfig(), getEmployeeNames()]);
  const devMode = isDevelopmentMode();

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-lg font-semibold">AI 模型配置</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          每个数字员工的每项任务可以独立选择供应商与模型 — 数字员工本身不绑定任何一个模型。
        </p>
      </div>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase），模型配置已禁用。
        </p>
      )}

      <section className="rounded-md border border-[var(--border)] px-4 py-3 text-sm">
        <p className="font-medium">
          {devMode ? "当前处于开发模式（AI_DEVELOPMENT_MODE=true）" : "当前为生产模式"}
        </p>
        <p className="mt-1 text-[var(--muted)]">
          {devMode
            ? "未单独配置默认模型的任务，会优先选择标记为「免费层」且推荐用于开发的模型；没有可用的免费模型时不会自动改用付费模型，而是提示需要人工选择。"
            : "未单独配置默认模型的任务将无法运行，需要先在下方为该任务选择一个默认模型。"}
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">搜索服务连接状态</h2>
        <p className="mb-2 text-sm text-[var(--muted)]">
          搜索资料 ≠ 分析资料：政策研究员先通过搜索服务检索真实来源，再交给下方的分析模型阅读整理 —
          两者是独立的两个环节，各自可以单独配置。
        </p>
        <ul>
          {listSearchProviders().map((provider) => (
            <li
              key={provider.provider}
              className="flex flex-col gap-2 border-b border-[var(--border)] py-2 text-sm last:border-b-0"
            >
              <div className="flex items-center justify-between">
                <span>
                  {provider.displayName}
                  {provider.pricingType === "FREE" && " · 免费开发模式默认"}
                  {provider.pricingType === "PAID" && " · 付费（未启用为开发默认）"}
                </span>
                <span className={isSearchProviderConfigured(provider.provider) ? "" : "text-[var(--muted)]"}>
                  {isSearchProviderConfigured(provider.provider)
                    ? "已连接"
                    : `未配置（设置 .env.local 中的 ${searchProviderEnvVarName(provider.provider)}）`}
                </span>
              </div>
              {!demo && <SearchProviderHealthCheck provider={provider.provider} />}
            </li>
          ))}
        </ul>
        {!isSearchProviderConfigured("TAVILY") && (
          <p className="mt-2 text-sm text-[var(--muted)]">
            配置 Tavily 后，政策研究员可以联网查找官方资料。未配置时，研究任务会自动改用 AI 模型自带的联网检索能力（如
            Google/Anthropic 的原生联网搜索）。
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">供应商连接状态</h2>
        <ul>
          {AI_PROVIDER_IDS.map((provider) => (
            <li
              key={provider}
              className="flex flex-col gap-2 border-b border-[var(--border)] py-2 text-sm last:border-b-0"
            >
              <div className="flex items-center justify-between">
                <span>{provider}</span>
                <span className={isProviderConfigured(provider) ? "" : "text-[var(--muted)]"}>
                  {isProviderConfigured(provider)
                    ? "已连接"
                    : `未配置（设置 .env.local 中的 ${providerEnvVarName(provider)}）`}
                </span>
              </div>
              {!demo && (provider === "GOOGLE" || provider === "GROQ") && (
                <ProviderHealthCheck provider={provider} />
              )}
            </li>
          ))}
        </ul>
      </section>

      {DIGITAL_EMPLOYEES.map((employee) => {
        const tasks = TASK_TYPES.filter((t) => TASK_TYPE_EMPLOYEE[t] === employee.id);
        if (tasks.length === 0) return null;

        return (
          <section key={employee.id} className="flex flex-col gap-4">
            <h2 className="text-sm font-medium">
              {employee.letter}｜{resolveEmployeeDisplayName(employee.id, employeeNames)}
            </h2>

            {!employee.enabled ? (
              <p className="text-sm text-[var(--muted)]">尚未启用。</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {tasks.map((taskType) => {
                  const models = listModelsForTask(taskType);
                  const current = config[taskType];
                  const currentValue = current ? `${current.provider}::${current.modelId}` : "";

                  return (
                    <li key={taskType} className="flex flex-col gap-2 rounded-md border border-[var(--border)] px-4 py-3">
                      <p className="text-sm font-medium">{TASK_TYPE_LABEL[taskType]}</p>
                      {taskType === "RESEARCH" && (
                        <p className="text-xs text-[var(--muted)]">
                          搜索服务：Tavily Search（{isSearchProviderConfigured("TAVILY") ? "已连接" : "未配置"}） ·
                          下方选择的是分析模型 — 搜索网页 ≠ 分析网页
                        </p>
                      )}
                      {demo ? (
                        <p className="text-sm text-[var(--muted)]">
                          {current ? `${current.provider} / ${current.modelId}` : "未设置默认模型（使用开发模式免费优先）"}
                        </p>
                      ) : (
                        <>
                          <p className="text-xs text-[var(--muted)]">一选就生效，不用再点保存。</p>
                          <AutoSubmitSelect
                            action={setTaskModelDefault}
                            hiddenFields={{ taskType }}
                            name="modelChoice"
                            defaultValue={currentValue}
                            options={[
                              { value: "", label: "使用开发模式免费优先（未单独配置）" },
                              ...models.map((m) => ({
                                value: `${m.provider}::${m.modelId}`,
                                label: `${m.displayName} · ${m.provider} · ${PRICING_LABEL[m.pricingType]}${m.supportsWebSearch ? " · 支持联网研究" : ""}${!isProviderConfigured(m.provider) ? "（未配置）" : ""}`,
                              })),
                            ]}
                          />
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <section className="rounded-md border border-[var(--border)] px-4 py-3 text-sm">
        <p className="font-medium">数据隐私提醒</p>
        <p className="mt-1 text-[var(--muted)]">
          免费模型仅用于公开政策研究、选题和营销内容实验。禁止上传真实客户敏感信息，例如：护照、出生日期、地址、银行资料、拒签信、案件编号、真实客户文件。
        </p>
      </section>
    </div>
  );
}
