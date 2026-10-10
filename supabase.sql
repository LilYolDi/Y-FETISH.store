create extension if not exists pgcrypto;

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null default '',
  price numeric(10,2) not null default 0 check (price >= 0),
  currency text not null default 'UAH'
    check (currency in ('UAH', 'EUR', 'USD')),
  thumbnail_url text,
  storage_path text,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null
    references public.videos(id) on delete restrict,
  contact text not null,
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'UAH'
    check (currency in ('UAH', 'EUR', 'USD')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'cancelled', 'refunded')),
  payment_provider text,
  payment_reference text,
  created_at timestamptz not null default now()
);

create index if not exists videos_published_created_idx
  on public.videos (published, created_at desc);

create index if not exists orders_created_idx
  on public.orders (created_at desc);

alter table public.videos enable row level security;
alter table public.orders enable row level security;

-- Создаём приватный bucket для платных видео.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'paid-videos',
  'paid-videos',
  false,
  500000000,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;