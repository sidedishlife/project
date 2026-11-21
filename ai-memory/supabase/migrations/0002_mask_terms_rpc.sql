-- 가리기 목록을 한 트랜잭션에서 통째로 교체
create or replace function replace_mask_terms(terms jsonb) returns void
language plpgsql as $$
begin
  delete from mask_terms where true; -- WHERE 없는 DELETE는 pg_safeupdate가 막음
  insert into mask_terms (term, alias)
    select t->>'term', t->>'alias' from jsonb_array_elements(terms) as t;
end;
$$;
revoke all on function replace_mask_terms(jsonb) from public;
do $$
begin -- Supabase의 API 역할(anon, authenticated)이 있을 때만(일반 Postgres에는 없음)
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function replace_mask_terms(jsonb) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function replace_mask_terms(jsonb) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function replace_mask_terms(jsonb) to service_role;
  end if;
end $$;

-- 사용자는 한 명만: 상수 식에 유니크 인덱스
create unique index users_single on users ((true));
