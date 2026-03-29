-- Fix for "Database error creating new user"
-- Run this in the Supabase SQL Editor

-- 1. Safely recreate the trigger with improved null handling and fallbacks
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_role public.user_role := 'cashier';
  v_invite_code text;
  v_name text;
begin
  -- 1. Safely extract values only if metadata exists
  if new.raw_user_meta_data is not null then
    v_invite_code := new.raw_user_meta_data->>'invite_code';
    v_name := new.raw_user_meta_data->>'name';
  end if;

  -- 2. Process invite code if provided
  if v_invite_code is not null and v_invite_code != '' then
    if exists (
      select 1 from public.invite_codes
      where code = v_invite_code
        and is_used = false
    ) then
      v_role := 'admin';
      
      update public.invite_codes
      set is_used = true,
          used_by = new.id,
          used_at = now()
      where code = v_invite_code;
    else
      -- If the user provided a bad code, reject the whole registration
      raise exception 'Invalid or expired invite code provided.';
    end if;
  end if;

  -- 3. Fallback for Name (when creating from dashboard, metadata is empty)
  if v_name is null or v_name = '' then
    v_name := coalesce(split_part(new.email, '@', 1), 'User');
  end if;

  -- 4. Insert Profile
  insert into public.profiles (id, name, role)
  values (new.id, v_name, v_role);

  -- 5. Insert Notification Prefs
  insert into public.notification_preferences (user_id)
  values (new.id);

  return new;
end;
$$;