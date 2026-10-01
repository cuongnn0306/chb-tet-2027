-- Baseline migration (INF-005).
-- Foundation only: shared helpers. Business tables arrive with E01+ (see docs/delivery/IMPLEMENTATION_INFRA_PLAN_v1.0.md).
-- Invariants to preserve in later migrations:
--   * inventory_movements is the stock source of truth; inventory_balances is derived cache.
--   * business transactions are never hard-deleted (void/soft-delete + audit).
--   * RLS is enabled together with every new table.

-- Keeps updated_at current; attach with a BEFORE UPDATE trigger on each table that has the column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is 'Generic BEFORE UPDATE trigger: sets updated_at = now().';
