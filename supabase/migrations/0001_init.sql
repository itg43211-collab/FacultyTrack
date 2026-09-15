-- ============================================================
-- نظام تحضير أعضاء هيئة التدريس — Supabase / PostgreSQL Schema
-- ============================================================
-- يشغَّل عبر: supabase db push   (أو supabase db reset محليًا)
-- كل المستخدمين في جدول profiles المرتبط مباشرة بـ auth.users
-- (لا يوجد password_hash هنا — كلمات المرور يديرها Supabase Auth).
-- ============================================================

-- ---------- Extensions ----------
create extension if not exists "pgcrypto";

-- ---------- updated_at helper ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============ الأقسام ============
create table if not exists public.departments (
  id        bigint generated always as identity primary key,
  name      text not null unique,
  name_en   text,
  created_at timestamptz not null default now()
);

-- ============ الفصول الدراسية ============
create table if not exists public.semesters (
  id         bigint generated always as identity primary key,
  name       text not null,
  start_date date not null,
  end_date   date not null,
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  constraint semesters_date_range check (start_date <= end_date)
);

-- ضمان فصل فعّال واحد فقط في كل وقت
create or replace function public.ensure_single_active_semester()
returns trigger
language plpgsql
as $$
begin
  if new.is_active then
    update public.semesters
       set is_active = false
     where is_active = true
       and id <> coalesce(new.id, -1);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_semesters_single_active on public.semesters;
create trigger trg_semesters_single_active
  before insert or update of is_active on public.semesters
  for each row
  execute function public.ensure_single_active_semester();

-- ============ المستخدمون (profiles مرتبط بـ auth.users) ============
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  employee_number   text not null unique,
  full_name         text not null,
  role              text not null check (role in ('admin', 'faculty', 'monitor')),
  department_id     bigint references public.departments (id),
  email             text unique,
  must_set_password boolean not null default true,
  status            text not null default 'active' check (status in ('active', 'disabled')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ============ المقررات ============
create table if not exists public.courses (
  id            bigint generated always as identity primary key,
  code          text,
  name          text not null,
  department_id bigint references public.departments (id),
  created_at    timestamptz not null default now(),
  unique (name, department_id)
);

-- ============ جدول محاضرات كل عضو ============
create table if not exists public.schedules (
  id           bigint generated always as identity primary key,
  faculty_id   uuid not null references public.profiles (id) on delete cascade,
  course_id    bigint not null references public.courses (id) on delete cascade,
  semester_id  bigint not null references public.semesters (id) on delete cascade,
  day_of_week  int not null check (day_of_week between 0 and 6), -- 0=الأحد ... 6=السبت
  start_time   text not null check (start_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  end_time     text not null check (end_time   ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  section      text,
  department_id bigint references public.departments (id),
  created_at   timestamptz not null default now()
);

create index if not exists idx_schedules_faculty   on public.schedules (faculty_id);
create index if not exists idx_schedules_semester  on public.schedules (semester_id);
create index if not exists idx_schedules_department on public.schedules (department_id);
create index if not exists idx_schedules_day      on public.schedules (day_of_week);

-- ============ سجل الحضور ============
create table if not exists public.attendance (
  id              bigint generated always as identity primary key,
  schedule_id     bigint not null references public.schedules (id) on delete cascade,
  faculty_id      uuid not null references public.profiles (id) on delete cascade,
  date            date not null,
  status          text not null default 'absent' check (status in ('present', 'excused', 'absent')),
  check_in_time   text check (check_in_time ~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' or check_in_time is null),
  lat             double precision,
  lng             double precision,
  distance_meters double precision,
  verified        boolean not null default false,
  marked_by       text not null default 'self', -- 'self' أو 'monitor:<profile_id>'
  created_at      timestamptz not null default now(),
  unique (schedule_id, date)
);

create index if not exists idx_attendance_faculty  on public.attendance (faculty_id);
create index if not exists idx_attendance_schedule on public.attendance (schedule_id, date);
create index if not exists idx_attendance_date     on public.attendance (date);

-- ============ الأعذار ============
create table if not exists public.excuses (
  id           bigint generated always as identity primary key,
  attendance_id bigint not null references public.attendance (id) on delete cascade,
  type         text not null check (type in ('health', 'family', 'other')),
  notes        text,
  excuse_date  date not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at   timestamptz not null default now()
);

create index if not exists idx_excuses_attendance on public.excuses (attendance_id);

-- ============ موقع الجامعة ============
create table if not exists public.university_location (
  id        bigint generated always as identity primary key,
  name      text default 'الموقع الرئيسي',
  lat       double precision not null,
  lng       double precision not null,
  radius_km real not null default 5,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_university_location_updated_at on public.university_location;
create trigger trg_university_location_updated_at
  before update on public.university_location
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- Row Level Security
-- كل الوصول الحساس يمر عبر Edge Function (service role يتجاوز RLS).
-- الواجهة تحتاج فقط قراءة profiles لتدفقة تسجيل الدخول.
-- ============================================================
alter table public.departments        enable row level security;
alter table public.semesters          enable row level security;
alter table public.profiles           enable row level security;
alter table public.courses            enable row level security;
alter table public.schedules          enable row level security;
alter table public.attendance         enable row level security;
alter table public.excuses            enable row level security;
alter table public.university_location enable row level security;

-- profiles: قراءة مجهولة (خطوة التحقق من الرقم الوظيفي في شاشة الدخول)
drop policy if exists "profiles anon select for login" on public.profiles;
create policy "profiles anon select for login"
  on public.profiles for select
  to anon
  using (true);

-- profiles: كل مستخدم مسجَّل يقرأ صفه الخاص فقط
drop policy if exists "profiles self select" on public.profiles;
create policy "profiles self select"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- بقية الجداول: لا سياسات => لا وصول من anon/authenticated عبر PostgREST.
-- الـ Edge Function تستخدم service role فتتجاوز RLS.

-- ============================================================
-- بيانات ابتدائية (الأقسام + موقع الجامعة الافتراضي)
-- ملاحظة: المستخدمون (بما فيهم الـ Admin) يُنشؤون عبر
-- Edge Function: POST /auth/bootstrap-admin
-- ============================================================
insert into public.departments (name, name_en)
select * from (values
  ('علوم الحاسب', 'Computer Science'),
  ('تقنية المعلومات', 'Information Technology'),
  ('الرياضيات', 'Mathematics')
) as t(name, name_en)
where not exists (select 1 from public.departments limit 1);

insert into public.university_location (name, lat, lng, radius_km)
select 'جامعة القصيم', 26.3260, 43.9750, 5
where not exists (select 1 from public.university_location limit 1);
