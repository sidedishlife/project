-- 후보 중복 방지의 DB 쪽 보루: 같은 해시가 since 이후에 없을 때만 삽입 (동시 호출은 해시 단위 잠금으로 직렬화)
create or replace function insert_candidate_if_new(
  p_source text, p_hash text, p_title text, p_note_md text, p_questions jsonb,
  p_field_hint text, p_proposal jsonb, p_created_at timestamptz, p_since timestamptz
) returns uuid
language plpgsql
as $$
declare new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_hash, 0));
  if exists (select 1 from candidates where content_hash = p_hash and created_at >= p_since) then
    return null;
  end if;
  insert into candidates (source, content_hash, title, note_md, questions, field_hint, proposal, created_at)
  values (p_source, p_hash, p_title, p_note_md, p_questions, p_field_hint, p_proposal, p_created_at)
  returning id into new_id;
  return new_id;
end $$;

revoke all on function insert_candidate_if_new(text, text, text, text, jsonb, text, jsonb, timestamptz, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function insert_candidate_if_new(text, text, text, text, jsonb, text, jsonb, timestamptz, timestamptz) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function insert_candidate_if_new(text, text, text, text, jsonb, text, jsonb, timestamptz, timestamptz) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function insert_candidate_if_new(text, text, text, text, jsonb, text, jsonb, timestamptz, timestamptz) to service_role;
  end if;
end $$;
