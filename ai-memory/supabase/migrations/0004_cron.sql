-- 복습 알림 스케줄: 5분마다 /cron/remind 를 호출한다 (서버가 서울 시각과 slots를 비교해 발송 여부 결정).
-- 이 파일은 Supabase(호스팅) 전용이다. pg_cron/pg_net 확장이 없는 일반 PostgreSQL에는 적용할 수 없다.
--
-- 적용 전에 운영자가 해야 할 일 (같은 값을 두 곳에 넣는다):
--   1) app_config 에 cron_secret 저장:   insert into app_config(key, value) values ('cron_secret', to_jsonb('<긴 무작위 문자열>'::text))
--                                         on conflict (key) do update set value = excluded.value;
--   2) Vault 에 같은 값과 프로젝트 주소 저장:
--        select vault.create_secret('<위와 같은 문자열>', 'ai_memory_cron_secret');
--        select vault.create_secret('https://<project-ref>.supabase.co', 'ai_memory_project_url');
-- app_config.cron_secret 이 없으면 /cron/remind 는 403 이다.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 다시 적용해도 중복되지 않게 기존 작업을 먼저 지운다
select cron.unschedule(jobid) from cron.job where jobname = 'ai-memory-remind';

select cron.schedule(
  'ai-memory-remind',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ai_memory_project_url')
           || '/functions/v1/api/cron/remind',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ai_memory_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
