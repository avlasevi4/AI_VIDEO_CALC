-- Выполните этот файл в Supabase SQL Editor.
-- Никогда не добавляйте service_role key в браузерное приложение.
-- Единственный разрешённый владелец: ee7d2005-b775-46a0-835a-3974563eb597.

create table if not exists public.projects (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_updated_idx
  on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

revoke all on public.projects from anon;
grant select, insert, update, delete on public.projects to authenticated;

drop policy if exists "Owner can read projects" on public.projects;
create policy "Owner can read projects"
  on public.projects for select
  to authenticated
  using (
    auth.uid() = user_id
    and auth.uid() = 'ee7d2005-b775-46a0-835a-3974563eb597'::uuid
  );

drop policy if exists "Owner can create projects" on public.projects;
create policy "Owner can create projects"
  on public.projects for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and auth.uid() = 'ee7d2005-b775-46a0-835a-3974563eb597'::uuid
  );

drop policy if exists "Owner can update projects" on public.projects;
create policy "Owner can update projects"
  on public.projects for update
  to authenticated
  using (
    auth.uid() = user_id
    and auth.uid() = 'ee7d2005-b775-46a0-835a-3974563eb597'::uuid
  )
  with check (
    auth.uid() = user_id
    and auth.uid() = 'ee7d2005-b775-46a0-835a-3974563eb597'::uuid
  );

drop policy if exists "Owner can delete projects" on public.projects;
create policy "Owner can delete projects"
  on public.projects for delete
  to authenticated
  using (
    auth.uid() = user_id
    and auth.uid() = 'ee7d2005-b775-46a0-835a-3974563eb597'::uuid
  );
