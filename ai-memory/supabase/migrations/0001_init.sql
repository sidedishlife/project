-- AI 기억장 초기 스키마. 모든 테이블 RLS 활성 + 정책 없음 (Edge Function의 service role만 접근)

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  password_hash text not null
);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null
);

create table app_config (
  key text primary key,
  value jsonb not null
);

create table fields (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table concepts (
  id uuid primary key default gen_random_uuid(),
  field_id uuid references fields(id) on delete set null,
  title text not null,
  note_md text not null default '',
  stage int not null default 0,
  due_at timestamptz,
  reviews int not null default 0,
  lapses int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index concepts_due_at_idx on concepts (due_at);
create index concepts_field_id_idx on concepts (field_id);

create table concept_versions (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references concepts(id) on delete cascade,
  note_md text not null,
  created_at timestamptz not null default now()
);
create index concept_versions_concept_id_idx on concept_versions (concept_id);

create table questions (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references concepts(id) on delete cascade,
  kind text not null check (kind in ('explain','apply','compare')),
  prompt text not null,
  last_asked_at timestamptz
);
create index questions_concept_id_idx on questions (concept_id);

create table pairs (
  id uuid primary key default gen_random_uuid(),
  concept_a uuid not null references concepts(id) on delete cascade,
  concept_b uuid not null references concepts(id) on delete cascade,
  question text not null,
  stage int not null default 0,
  due_at timestamptz,
  reviews int not null default 0,
  lapses int not null default 0,
  check (concept_a < concept_b),
  unique (concept_a, concept_b)
);
create index pairs_due_at_idx on pairs (due_at);

create table candidates (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('claude','chatgpt','paste')),
  content_hash text not null,
  title text not null,
  note_md text not null default '',
  questions jsonb not null default '[]'::jsonb,
  field_hint text,
  proposal jsonb,
  status text not null default 'pending' check (status in ('pending','done','discarded')),
  created_at timestamptz not null default now()
);
create index candidates_hash_idx on candidates (content_hash, created_at);
create index candidates_status_idx on candidates (status);

create table review_log (
  id uuid primary key default gen_random_uuid(),
  unit_type text not null check (unit_type in ('concept','pair')),
  unit_id uuid not null,
  grade text not null,
  mode text not null check (mode in ('quick','deep')),
  answer text,
  feedback jsonb,
  at timestamptz not null default now()
);
create index review_log_at_idx on review_log (at);
create index review_log_unit_idx on review_log (unit_type, unit_id);

create table mask_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null unique,
  alias text not null
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  keys jsonb not null
);

alter table users enable row level security;
alter table sessions enable row level security;
alter table app_config enable row level security;
alter table fields enable row level security;
alter table concepts enable row level security;
alter table concept_versions enable row level security;
alter table questions enable row level security;
alter table pairs enable row level security;
alter table candidates enable row level security;
alter table review_log enable row level security;
alter table mask_terms enable row level security;
alter table push_subscriptions enable row level security;
