-- Migration: Add Invite Codes system for structured signups
-- Run this in your Supabase SQL Editor to update your existing schema

-- 1. Create the invite_codes table
create table if not exists public.invite_codes (
  id          uuid        primary key default gen_random_uuid(),
  code        text        not null unique,
  role        user_role   not null default 'admin',
  is_used     boolean     not null default false,
  used_by     uuid        references auth.users(id) on delete set null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

comment on table public.invite_codes is
  'Pre-generated invite codes for registering specific roles (like admin).';

-- 2. Update the existing handle_new_user trigger function
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_role user_role := 'cashier';
  v_invite_code text;
begin
  -- Check if an invite code was provided in the metadata
  v_invite_code := new.raw_user_meta_data->>'invite_code';
  
  if v_invite_code is not null then
    -- Verify if the code is valid, unused, and for the admin role
    if exists (
      select 1 from public.invite_codes
      where code = v_invite_code
        and is_used = false
        and role = 'admin'
    ) then
      v_role := 'admin';
      
      -- Mark the code as used immediately
      update public.invite_codes
      set is_used = true,
          used_by = new.id,
          used_at = now()
      where code = v_invite_code;
    else
      -- Raise an exception if the code is invalid so the user cannot sign up at all
      raise exception 'Invalid or expired invite code provided.';
    end if;
  end if;

  -- Insert profile
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    v_role
  );

  -- Insert notification preferences
  insert into public.notification_preferences (user_id)
  values (new.id);

  return new;
end;
$$;
