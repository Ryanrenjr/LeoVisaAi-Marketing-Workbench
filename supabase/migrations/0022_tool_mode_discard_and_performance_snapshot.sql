-- LeoVisaAi 营销工作台 — "工具化"重构 Phase 0
-- Live user instruction (2026-09): 平台从"持续追踪的流水线系统"改成"用完即走
-- 的单任务向导工具"——淘汰或完成退出都真删除这条选题的一切，不留痕迹。见
-- CLAUDE.md 非协商规则第 4 条（改写后的版本）。

-- 1. topics 需要一个真正的 DELETE 权限——之前只有 select/insert/update 策略，
-- 从来没有人删过选题。discardTopic()（src/app/topics/actions.ts）在应用层
-- 已经用 canApproveResearch()（ADMIN 或 EXPERT）做了一次权限检查，这里把
-- 同样的规则在 RLS 层再落一遍，跟 research_approvals 的写入策略用同一个
-- 判断方式（见 0011_admin_can_approve_own_research.sql）。
create policy "topics are deletable by ADMIN or EXPERT"
  on public.topics for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('ADMIN', 'EXPERT')));

-- 2. publish_performance 从"必须关联一个还存在的 topics 行"改成"标题快照"。
-- 原因：新流程里，选题一旦走完向导（不管是被淘汰还是拿到最终内容下载）都
-- 会被真删除，但 Leo 上传发布表现截图通常发生在发布之后好几天/几周——那时
-- 对应的 topics 行早就没了。改成手填标题，不再依赖 topic_id 还存在。
alter table public.publish_performance add column topic_title text;

update public.publish_performance pp
set topic_title = t.title
from public.topics t
where pp.topic_id = t.id and pp.topic_title is null;

update public.publish_performance
set topic_title = '（历史记录，标题不详）'
where topic_title is null;

alter table public.publish_performance alter column topic_title set not null;
alter table public.publish_performance alter column topic_id drop not null;
