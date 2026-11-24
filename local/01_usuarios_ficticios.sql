-- SOMENTE LOCAL: cria os usuários fictícios no auth.users simulado.
-- No Supabase, crie-os em Authentication > Users (com senha).
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'admin@exemplo.com'),
  ('00000000-0000-0000-0000-000000000001', 'juliana@exemplo.com'),
  ('00000000-0000-0000-0000-000000000002', 'rafael@exemplo.com'),
  ('00000000-0000-0000-0000-000000000003', 'patricia@exemplo.com'),
  ('00000000-0000-0000-0000-000000000004', 'marcos@exemplo.com');
