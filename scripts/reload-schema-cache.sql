-- Force PostgREST to reload the schema cache
-- Run this if you see errors like "Could not find the 'column' in the schema cache"
NOTIFY pgrst, 'reload schema';
