-- =====================================================================
-- Migration 0004: liga automaticamente o cadastro do responsável ao login
--
-- Fluxo: a administradora cadastra o responsável com o e-mail dele e cria
-- o login (Authentication > Users) com o MESMO e-mail. A ordem não importa:
-- quando os dois existirem, o banco faz o vínculo sozinho.
-- Só vale para perfil RESPONSAVEL e só se o login ainda não estiver ligado
-- a outro responsável.
-- =====================================================================

-- Novo login criado -> procura responsável com o mesmo e-mail
CREATE OR REPLACE FUNCTION public.vincular_responsavel_ao_login() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.perfil = 'RESPONSAVEL' THEN
    UPDATE responsavel SET usuario_id = NEW.id
     WHERE id = (SELECT r.id FROM responsavel r
                 WHERE r.usuario_id IS NULL AND lower(r.email) = lower(NEW.email)
                 ORDER BY r.id LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM responsavel WHERE usuario_id = NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_usuario_vincula_responsavel
AFTER INSERT ON usuario
FOR EACH ROW EXECUTE FUNCTION public.vincular_responsavel_ao_login();

-- Responsável cadastrado (ou e-mail corrigido) -> procura login com o mesmo e-mail
CREATE OR REPLACE FUNCTION public.vincular_login_ao_responsavel() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.usuario_id IS NULL AND NEW.email IS NOT NULL THEN
    SELECT u.id INTO NEW.usuario_id
    FROM usuario u
    WHERE lower(u.email) = lower(NEW.email) AND u.perfil = 'RESPONSAVEL'
      AND NOT EXISTS (SELECT 1 FROM responsavel r WHERE r.usuario_id = u.id AND r.id IS DISTINCT FROM NEW.id)
    LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_responsavel_vincula_login
BEFORE INSERT OR UPDATE OF email ON responsavel
FOR EACH ROW EXECUTE FUNCTION public.vincular_login_ao_responsavel();

REVOKE EXECUTE ON FUNCTION public.vincular_responsavel_ao_login(), public.vincular_login_ao_responsavel()
  FROM PUBLIC, anon, authenticated;
