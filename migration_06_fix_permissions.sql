-- Migration: Grant API access to public schema tables
-- Run this in your Supabase SQL Editor to fix the 42501 permission denied error

-- Grant usage on schemas
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- Grant access to all tables 
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- Grant access to all functions and sequences
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- Make sure future tables automatically get these permissions too
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;