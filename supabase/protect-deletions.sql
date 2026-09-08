-- Optional hardening for obsolete clients and concurrent saves.
-- Run once in Supabase SQL Editor. No existing project is deleted or modified.
create or replace function public.preserve_project_deletion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.payload->>'deletedAt' is not null then
    if TG_OP = 'DELETE' then
      return null;
    end if;
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_project_deletion on public.projects;
create trigger preserve_project_deletion
before update or delete on public.projects
for each row execute function public.preserve_project_deletion();
