-- Set a user as admin
-- Replace 'user-email@example.com' with the actual admin user's email

UPDATE users
SET role = 'admin'
WHERE email = 'user-email@example.com';

-- You can also check all users and their roles:
-- SELECT id, email, full_name, role FROM users;
