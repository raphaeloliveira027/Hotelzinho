-- =====================================================================
-- Migration 0009: avisos no celular (notificações push do app instalado).
--
-- Como funciona:
--  1) No celular, a pessoa toca em "Ativar avisos". O navegador cria uma
--     "inscrição" (endereço secreto do serviço de push do Google/Apple) e o app
--     guarda em push_inscricao, ligada ao login dela.
--  2) Sempre que o banco cria uma linha em notificacao (cadastro novo, mensagem,
--     comunicado, comprovante...), um gatilho chama a função "enviar-push"
--     do Supabase (pg_net, depois do COMMIT).
--  3) A função lê a notificação, marca como enviada (uma vez só) e manda o
--     aviso para os aparelhos daquela pessoa.
-- O texto do aviso vem sempre do banco: quem chama a função não consegue inventar avisos.
-- =====================================================================

-- pg_net faz chamadas HTTP de dentro do banco (já disponível no Supabase)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  END IF;
END $$;

-- Endereço da função no Supabase (troque SEU-PROJETO se usar outro projeto)
CREATE TABLE IF NOT EXISTS config_sistema (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
ALTER TABLE config_sistema ENABLE ROW LEVEL SECURITY;   -- sem políticas: ninguém do app lê ou altera
REVOKE ALL ON config_sistema FROM anon, authenticated;
INSERT INTO config_sistema (chave, valor)
VALUES ('url_funcao_push', 'https://SEU-PROJETO.supabase.co/functions/v1/enviar-push')
ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;

-- Aparelhos que aceitaram receber avisos
CREATE TABLE IF NOT EXISTS push_inscricao (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1000),
  p256dh      TEXT NOT NULL CHECK (length(p256dh) BETWEEN 40 AND 200),
  auth        TEXT NOT NULL CHECK (length(auth) BETWEEN 10 AND 100),
  aparelho    VARCHAR(120),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_push_inscricao_usuario ON push_inscricao (usuario_id);
ALTER TABLE push_inscricao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON push_inscricao FROM anon, authenticated;
GRANT SELECT (id, usuario_id, endpoint, aparelho, criado_em) ON push_inscricao TO authenticated;
DROP POLICY IF EXISTS dono_le ON push_inscricao;
CREATE POLICY dono_le ON push_inscricao FOR SELECT TO authenticated USING (usuario_id = auth.uid());

-- Liga este aparelho ao login atual. Se o aparelho estava ligado a outra pessoa
-- (ex.: celular compartilhado), passa a ser só de quem está logado agora.
CREATE OR REPLACE FUNCTION public.registrar_push(p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT, p_aparelho TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM usuario WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Entre no app para ativar os avisos.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM push_inscricao WHERE endpoint = p_endpoint;
  INSERT INTO push_inscricao (usuario_id, endpoint, p256dh, auth, aparelho)
  VALUES (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_aparelho, 120));
  -- no máximo 10 aparelhos por pessoa: remove os mais antigos
  DELETE FROM push_inscricao WHERE id IN (
    SELECT id FROM push_inscricao WHERE usuario_id = auth.uid() ORDER BY criado_em DESC OFFSET 10);
END $$;

-- Desliga os avisos deste aparelho (ao desativar ou ao sair da conta)
CREATE OR REPLACE FUNCTION public.remover_push(p_endpoint TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM push_inscricao WHERE endpoint = p_endpoint AND usuario_id = auth.uid()
$$;

-- Cada notificação vira aviso uma vez só
ALTER TABLE notificacao ADD COLUMN IF NOT EXISTS push_enviado_em TIMESTAMPTZ;

-- Usada SÓ pela função enviar-push (chave secreta): pega a notificação ainda não
-- enviada, marca como enviada e devolve o texto e os aparelhos de destino.
CREATE OR REPLACE FUNCTION public.reivindicar_push(p_notificacao BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n notificacao%ROWTYPE;
BEGIN
  UPDATE notificacao SET push_enviado_em = now()
   WHERE id = p_notificacao AND push_enviado_em IS NULL AND criada_em > now() - interval '15 minutes'
  RETURNING * INTO n;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'titulo', CASE n.tipo
                WHEN 'CADASTRO'    THEN 'Cadastro'
                WHEN 'MENSAGEM'    THEN 'Nova mensagem'
                WHEN 'COMUNICADO'  THEN 'Comunicado'
                WHEN 'COMPROVANTE' THEN 'Mensalidade'
                WHEN 'OCORRENCIA'  THEN 'Ocorrência'
                WHEN 'RECADO'      THEN 'Recado'
                ELSE 'Hotelzinho' END,
    'texto', n.texto,
    'link', COALESCE(n.link, '/'),
    'tag', n.tipo || '-' || n.id,
    'inscricoes', COALESCE((SELECT jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth))
                              FROM push_inscricao WHERE usuario_id = n.usuario_id), '[]'::jsonb));
END $$;

-- Aparelho que o serviço de push disse que não existe mais (desinstalou, bloqueou)
CREATE OR REPLACE FUNCTION public.remover_push_vencida(p_endpoint TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM push_inscricao WHERE endpoint = p_endpoint
$$;

-- Gatilho: notificação nova de quem tem aparelho inscrito → chama a função.
-- Se a chamada falhar, a notificação continua gravada (o aviso no app não depende do push).
CREATE OR REPLACE FUNCTION public.ao_criar_notificacao_push() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM push_inscricao WHERE usuario_id = NEW.usuario_id) THEN
    SELECT valor INTO v_url FROM config_sistema WHERE chave = 'url_funcao_push';
    IF v_url IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(url := v_url, body := jsonb_build_object('notificacao', NEW.id),
                              headers := '{"Content-Type": "application/json"}'::jsonb);
      EXCEPTION WHEN others THEN
        RAISE WARNING 'Aviso no celular não disparado: %', SQLERRM;
      END;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notificacao_push ON notificacao;
CREATE TRIGGER trg_notificacao_push
AFTER INSERT ON notificacao
FOR EACH ROW EXECUTE FUNCTION public.ao_criar_notificacao_push();

-- O aviso de comprovante levava a uma tela que não existe: agora abre o Financeiro
CREATE OR REPLACE FUNCTION public.ao_enviar_comprovante() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM notificar_admins('COMPROVANTE', 'Novo comprovante de Pix para analisar.', '/admin/financeiro');
  RETURN NEW;
END $$;

-- Permissões
REVOKE EXECUTE ON FUNCTION public.registrar_push(TEXT, TEXT, TEXT, TEXT), public.remover_push(TEXT),
  public.reivindicar_push(BIGINT), public.remover_push_vencida(TEXT), public.ao_criar_notificacao_push()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_push(TEXT, TEXT, TEXT, TEXT), public.remover_push(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reivindicar_push(BIGINT), public.remover_push_vencida(TEXT) TO service_role;
