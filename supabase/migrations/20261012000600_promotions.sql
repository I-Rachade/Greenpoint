-- Advertising popup shown when the app opens. Admins create and schedule the
-- ads in the backoffice (/admin/promotions); everybody, signed in or not, can
-- read the ones that are switched on and within their period.
-- See docs/BACKOFFICE.md.

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 120),
  body text not null default '' check (length(body) <= 1000),
  image_url text check (image_url is null or image_url ~* '^https?://'),
  link_url text check (link_url is null or link_url ~* '^https?://'),
  link_label text check (link_label is null or length(link_label) <= 40),
  is_active boolean not null default false,
  starts_at timestamptz,                     -- null = from now on
  ends_at timestamptz,                       -- null = until switched off
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index promotions_running_idx on public.promotions (is_active, starts_at, ends_at);

create function public.touch_promotion() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger promotions_touch before update on public.promotions
  for each row execute function public.touch_promotion();

-- Changes show up in the activity log like every other backoffice change.
create trigger audit_promotions after insert or update or delete on public.promotions
  for each row execute function public.audit_row();

alter table public.promotions enable row level security;

create policy "anyone reads running promotions" on public.promotions
  for select using (
    is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );

create policy "admins manage promotions" on public.promotions
  for all using (public.is_admin()) with check (public.is_admin());

-- Images: a public bucket everybody can read; only admins upload or delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('promotions', 'promotions', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "admins upload promotion images" on storage.objects
  for insert to authenticated with check (bucket_id = 'promotions' and public.is_admin());
create policy "admins change promotion images" on storage.objects
  for update to authenticated using (bucket_id = 'promotions' and public.is_admin());
create policy "admins delete promotion images" on storage.objects
  for delete to authenticated using (bucket_id = 'promotions' and public.is_admin());
