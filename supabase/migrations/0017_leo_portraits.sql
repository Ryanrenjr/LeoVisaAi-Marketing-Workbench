-- LeoVisaAi 营销工作台 — 李尔王特写照片
-- Live user instruction: 小红书/视频号封面需要能带李尔王本人特写，而且要让 AI
-- 直接把真实长相融合进设计里，不是事后硬拼接。AI 生成模型没法凭空画出一个
-- 具体真人的长相，所以做法是：真实照片由 ADMIN 上传保存，生成封面时把这张
-- 真实照片作为参考图，连同文字提示一起交给 Images 编辑接口（见
-- generateOpenAIImageEdit，src/lib/ai/providers/openai-provider.ts），从不
-- 让 AI 只凭文字描述凭空猜他的脸。
--
-- 这是 docs/security-boundaries.md "no upload feature anywhere in this
-- app" 的第二个明确例外（第一个是 Employee E 的发布数据截图）——同样由
-- 显式的现场用户指令开的口子，同样只做一件窄的事：存 ADMIN 自己上传的、
-- 公司自己人物的品牌照片，不是客户资料，不涉及任何客户身份数据边界。
create table public.leo_portraits (
  id uuid primary key default gen_random_uuid(),
  image_path text not null,
  label text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index leo_portraits_created_at_idx on public.leo_portraits (created_at desc);

alter table public.leo_portraits enable row level security;

create policy "leo_portraits are readable by any signed-in staff member"
  on public.leo_portraits for select to authenticated using (true);

create policy "leo_portraits are insertable by ADMIN only"
  on public.leo_portraits for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

create policy "leo_portraits are deletable by ADMIN only"
  on public.leo_portraits for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

-- Private bucket — same posture as content-images/publish-screenshots.
insert into storage.buckets (id, name, public)
values ('leo-portraits', 'leo-portraits', false)
on conflict (id) do nothing;

create policy "leo-portraits are readable by any signed-in staff member"
  on storage.objects for select to authenticated
  using (bucket_id = 'leo-portraits');

create policy "leo-portraits are uploadable by ADMIN only"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'leo-portraits'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN')
  );

create policy "leo-portraits are deletable by ADMIN only"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'leo-portraits'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN')
  );
