-- Migration: Fix orphaned auth profiles
INSERT INTO public.profiles (id, name, role)
SELECT 
  au.id, 
  COALESCE(au.raw_user_meta_data->>'name', split_part(au.email, '@', 1), 'User'),
  CASE 
    WHEN (au.raw_user_meta_data->>'role') = 'admin' THEN 'admin'::public.user_role
    WHEN (au.raw_user_meta_data->>'role') = 'super_admin' THEN 'super_admin'::public.user_role
    ELSE 'cashier'::public.user_role
  END
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE p.id IS NULL;
