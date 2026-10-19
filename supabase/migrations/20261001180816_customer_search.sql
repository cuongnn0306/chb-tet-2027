-- CUS-004 / CUS-006: customer search and duplicate suggestion.
-- Accent-insensitive ("nguyen" finds "Nguyễn"), matches name, company, contact, tax code, email
-- and phone (any format). SECURITY INVOKER: row level security still decides what the caller sees.

create extension if not exists unaccent with schema extensions;

-- unaccent() is only STABLE; this wrapper is safe to call from queries (not used in indexes).
create or replace function private.fold_text(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select extensions.unaccent(lower(coalesce(p_text, '')))
$$;

revoke all on function private.fold_text(text) from public, anon;
grant execute on function private.fold_text(text) to authenticated, service_role;

create or replace function public.search_customers(
  p_query text default '',
  p_customer_type text default null,
  p_include_archived boolean default false,
  p_limit int default 50,
  p_offset int default 0
)
returns setof public.customers
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select
      private.fold_text(btrim(coalesce(p_query, ''))) as text_q,
      public.normalize_phone(p_query) as phone_q
  )
  select c.*
  from public.customers c, q
  where (p_include_archived or not c.is_archived)
    and (p_customer_type is null or c.customer_type = p_customer_type)
    and (
      q.text_q = ''
      or strpos(private.fold_text(c.name), q.text_q) > 0
      or strpos(private.fold_text(c.company_name), q.text_q) > 0
      or strpos(private.fold_text(c.contact_name), q.text_q) > 0
      or strpos(private.fold_text(c.email), q.text_q) > 0
      or strpos(coalesce(c.tax_code, ''), q.text_q) > 0
      or (q.phone_q is not null and length(q.phone_q) >= 3
          and strpos(coalesce(c.phone_normalized, ''), q.phone_q) > 0)
    )
  order by c.created_at desc, c.id
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0)
$$;

-- Duplicate suggestion: customers with the same phone (any format) or the same tax code.
-- Never blocks anything; the caller decides whether to reuse a customer or create a new one.
create or replace function public.find_similar_customers(
  p_phone text default null,
  p_tax_code text default null,
  p_exclude_id uuid default null
)
returns setof public.customers
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.customers c
  where not c.is_archived
    and (p_exclude_id is null or c.id <> p_exclude_id)
    and (
      (public.normalize_phone(p_phone) is not null
        and length(public.normalize_phone(p_phone)) >= 8
        and c.phone_normalized = public.normalize_phone(p_phone))
      or (nullif(btrim(coalesce(p_tax_code, '')), '') is not null
        and c.tax_code = btrim(p_tax_code))
    )
  order by c.created_at desc, c.id
  limit 10
$$;

revoke all on function public.search_customers(text, text, boolean, int, int) from public, anon;
revoke all on function public.find_similar_customers(text, text, uuid) from public, anon;
grant execute on function public.search_customers(text, text, boolean, int, int) to authenticated;
grant execute on function public.find_similar_customers(text, text, uuid) to authenticated;
