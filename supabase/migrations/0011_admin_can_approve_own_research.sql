-- LeoVisaAi 营销工作台 — Admin can approve their own research (RLS catch-up)
-- src/lib/permissions.ts's canApproveResearch() was already widened to
-- ADMIN || EXPERT (single-operator reality — see that file's comment),
-- but this table's RLS policy was never updated to match: it still only
-- allowed EXPERT to insert a row, so an ADMIN clicking "批准研究" /
-- "请求修改" had the insert silently rejected by RLS (research-actions.ts
-- checks `if (approvalError) return;` with no error surfaced — the
-- reported symptom was "clicked, nothing happened"). This migration is
-- the missing half of that change.
drop policy "research_approvals are insertable by EXPERT only, as self-attribution" on public.research_approvals;

create policy "research_approvals are insertable by ADMIN or EXPERT, as self-attribution"
  on public.research_approvals for insert to authenticated
  with check (
    decided_by = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('ADMIN', 'EXPERT'))
  );
