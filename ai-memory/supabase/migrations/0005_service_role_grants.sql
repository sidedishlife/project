-- Edge Function(service role)이 public 스키마의 모든 테이블을 읽고 쓸 수 있게 한다.
-- 직접 접근(anon/authenticated)은 RLS로 계속 막혀 있다.
do $$
begin -- Supabase의 service_role이 있을 때만(일반 Postgres에는 없음)
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant select, insert, update, delete on all tables in schema public to service_role;
  end if;
end $$;
