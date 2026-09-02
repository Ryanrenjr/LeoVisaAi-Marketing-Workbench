-- LeoVisaAi 营销工作台 — "工具化"重构 Phase 0（续）
-- 0022 把 publish_performance 从"必须关联一个还存在的 topics 行"改成标题
-- 快照，但漏了一件事：computePillarPerformance()（"哪类选题表现更好"）是靠
-- topicsById 联查 topics.content_pillar 算出来的——选题被删除以后这个联查
-- 永远查不到。补一个同样的快照列，上传时跟标题一起手填（可选），不再依赖
-- topics 行是否还存在。
alter table public.publish_performance add column content_pillar public.content_pillar;
