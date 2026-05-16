-- ════════════════════════════════════════════════════════════════════
--  RAÍZES 360 — Schema do Banco de Dados (Supabase / PostgreSQL)
--  Execute no SQL Editor do Supabase na ordem abaixo.
-- ════════════════════════════════════════════════════════════════════

-- ─── EXTENSÃO UUID ───────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ════════════════════════════════════════════════════════════════════
--  TABELA 1 — USUÁRIOS (pacientes + profissionais unificados)
-- ════════════════════════════════════════════════════════════════════
create table users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null unique,
  password_hash text not null,
  role          text not null check (role in (
    'paciente','nutricionista','educador_fisico',
    'psicologo','medico','admin'
  )),
  phone         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ════════════════════════════════════════════════════════════════════
--  TABELA 2 — CHECKLIST (uma linha por hábito por dia por paciente)
-- ════════════════════════════════════════════════════════════════════
create table checklist_entries (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references users(id) on delete cascade,
  date        date not null,
  pilar       text not null check (pilar in (
    'nutri','ativ','sono','mente','social','vicios'
  )),
  habit_id    text not null,   -- ex: 'nutri_01', 'sono_03'
  habit_name  text not null,
  completed   boolean default false,
  points      int default 0,
  updated_at  timestamptz default now(),
  unique (patient_id, date, habit_id)
);

-- ════════════════════════════════════════════════════════════════════
--  TABELA 3 — RESUMO DIÁRIO (agregado por dia, alimenta gráficos)
-- ════════════════════════════════════════════════════════════════════
create table daily_summary (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references users(id) on delete cascade,
  date          date not null,
  total_points  int default 0,
  -- percentual por pilar
  nutri_pct     int default 0,
  ativ_pct      int default 0,
  sono_pct      int default 0,
  mente_pct     int default 0,
  social_pct    int default 0,
  vicios_pct    int default 0,
  -- itens concluídos por pilar
  nutri_done    int default 0,  nutri_total  int default 0,
  ativ_done     int default 0,  ativ_total   int default 0,
  sono_done     int default 0,  sono_total   int default 0,
  mente_done    int default 0,  mente_total  int default 0,
  social_done   int default 0,  social_total int default 0,
  vicios_done   int default 0,  vicios_total int default 0,
  updated_at    timestamptz default now(),
  unique (patient_id, date)
);

-- ════════════════════════════════════════════════════════════════════
--  TABELA 4 — PONTOS E DIAS SEM FALHAR (por paciente)
-- ════════════════════════════════════════════════════════════════════
create table patient_points (
  patient_id        uuid primary key references users(id) on delete cascade,
  total_points      int default 0,
  streak_days       int default 0,
  streak_saved_at   date,           -- última vez que usou o salva-sequência
  streak_saves_used int default 0,  -- saves usados na semana atual
  last_active_date  date,
  updated_at        timestamptz default now()
);

-- ════════════════════════════════════════════════════════════════════
--  TABELA 5 — CARDÁPIO (prescrito pelo nutricionista)
-- ════════════════════════════════════════════════════════════════════
create table menu_items (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references users(id) on delete cascade,
  date        date not null,
  meal_order  int not null,
  meal_name   text not null,   -- 'Café da manhã', 'Almoço', etc.
  meal_time   text,            -- '07:00'
  item_order  int not null,
  item_name   text not null,
  quantity    text,            -- '150g', '2 fatias'
  kcal        int,
  note        text,
  is_sub      boolean default false,  -- é uma substituição?
  created_by  uuid references users(id),
  created_at  timestamptz default now()
);

-- ════════════════════════════════════════════════════════════════════
--  TABELA 6 — EXAMES LABORATORIAIS
-- ════════════════════════════════════════════════════════════════════
create table exam_results (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references users(id) on delete cascade,
  exam_date    date not null,
  results      jsonb not null,
  -- Estrutura esperada do jsonb results:
  -- {
  --   "glicemia": 113, "vitamina_d": 23, "tsh": 1.36, "b12": 380,
  --   "pressao": "141/102", "hdl": 38, "ldl": 92,
  --   "triglicerideos": 120, "tgo": 28, "tgp": 24,
  --   "dinamometria": 30.5, "hemoglobina_glicada": 5.9
  -- }
  inserted_by  uuid references users(id),
  created_at   timestamptz default now()
);

-- ════════════════════════════════════════════════════════════════════
--  TABELA 7 — FOTOS DE REFEIÇÕES
-- ════════════════════════════════════════════════════════════════════
create table meal_photos (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references users(id) on delete cascade,
  meal_name       text,
  photo_url       text not null,   -- URL do Supabase Storage
  sent_at         timestamptz default now(),
  source          text default 'app' check (source in ('app','whatsapp')),
  status          text default 'pending' check (status in ('pending','reviewed')),
  feedback_text   text,
  tags            text[],          -- ['Proteína ok', 'Vegetais presentes']
  feedback_by     uuid references users(id),
  feedback_at     timestamptz
);

-- ════════════════════════════════════════════════════════════════════
--  TABELA 8 — NOTIFICAÇÕES
-- ════════════════════════════════════════════════════════════════════
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references users(id) on delete cascade,
  from_user   uuid references users(id),
  type        text not null check (type in (
    'feedback_foto','cardapio_atualizado','treino_atualizado',
    'sessao_confirmada','resultado_exame','conquista','zoom','lembrete'
  )),
  title       text not null,
  message     text not null,
  read        boolean default false,
  created_at  timestamptz default now()
);

-- ════════════════════════════════════════════════════════════════════
--  TABELA 9 — NOTAS CLÍNICAS (por profissional)
-- ════════════════════════════════════════════════════════════════════
create table clinical_notes (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references users(id) on delete cascade,
  author_id    uuid not null references users(id),
  author_role  text not null,
  note         text not null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ════════════════════════════════════════════════════════════════════
--  ÍNDICES (performance)
-- ════════════════════════════════════════════════════════════════════
create index idx_checklist_patient_date  on checklist_entries (patient_id, date);
create index idx_daily_summary_patient   on daily_summary (patient_id, date desc);
create index idx_menu_patient_date       on menu_items (patient_id, date);
create index idx_photos_patient_status   on meal_photos (patient_id, status);
create index idx_notif_patient_read      on notifications (patient_id, read);
create index idx_exams_patient_date      on exam_results (patient_id, exam_date desc);

-- ════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY (RLS) — Supabase
--  Garante que paciente só acessa os próprios dados.
-- ════════════════════════════════════════════════════════════════════

alter table checklist_entries enable row level security;
alter table daily_summary      enable row level security;
alter table patient_points     enable row level security;
alter table menu_items         enable row level security;
alter table exam_results       enable row level security;
alter table meal_photos        enable row level security;
alter table notifications      enable row level security;

-- Política: paciente lê/escreve apenas os próprios dados
-- (o service_role key do back-end bypassa o RLS automaticamente)
create policy "patient_own_data" on checklist_entries
  for all using (auth.uid()::text = patient_id::text);

create policy "patient_own_summary" on daily_summary
  for all using (auth.uid()::text = patient_id::text);

create policy "patient_own_points" on patient_points
  for all using (auth.uid()::text = patient_id::text);

-- ════════════════════════════════════════════════════════════════════
--  TRIGGER — atualiza updated_at automaticamente
-- ════════════════════════════════════════════════════════════════════
create or replace function set_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

create trigger trg_checklist_updated_at
  before update on checklist_entries
  for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════
--  DADOS INICIAIS — Usuário admin e paciente de teste
-- ════════════════════════════════════════════════════════════════════
-- ATENÇÃO: troque os hashes por bcrypt reais antes de usar em produção.
-- Hash abaixo corresponde à senha "Raizes360@2026"

insert into users (name, email, password_hash, role) values
  ('Juan Carlos',     'juan@raizes360.com',    '$2a$12$PLACEHOLDER_HASH_NUTRI',  'nutricionista'),
  ('Carlos Silva',    'carlos@raizes360.com',  '$2a$12$PLACEHOLDER_HASH_EDFI',   'educador_fisico'),
  ('Dra. Lúcia',      'lucia@raizes360.com',   '$2a$12$PLACEHOLDER_HASH_PSICO',  'psicologo'),
  ('Dr. Pedro',       'pedro@raizes360.com',   '$2a$12$PLACEHOLDER_HASH_MEDICO', 'medico'),
  ('Ana Beatriz',     'ana@raizes360.com',     '$2a$12$PLACEHOLDER_HASH_ANA',    'paciente');

-- Inicializa pontos da paciente de teste
insert into patient_points (patient_id, total_points, streak_days, last_active_date)
select id, 1840, 18, current_date from users where email = 'ana@raizes360.com';
