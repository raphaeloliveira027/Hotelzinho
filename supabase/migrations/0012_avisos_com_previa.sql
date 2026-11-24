-- =====================================================================
-- 0012 — Avisos com prévia do conteúdo
-- A notificação (no app e no celular) passa a mostrar um trecho do que chegou:
--   * comunicado:  "Feriado: Olá, famílias! Passando para avisar que amanhã…"
--   * mensagem:    "Lara · Hotelzinho: A Lara vai sair às 15h amanhã."
--   * ocorrência e recado da rotina: "Lara: Bateu o joelho no parquinho…"
-- =====================================================================

-- Trecho curto de um texto: junta espaços e quebras de linha e corta com "…"
CREATE OR REPLACE FUNCTION public.previa(p_texto TEXT, p_max INT DEFAULT 140)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN length(t) <= p_max THEN t ELSE rtrim(left(t, p_max - 1)) || '…' END
  FROM (SELECT trim(regexp_replace(COALESCE(p_texto, ''), '\s+', ' ', 'g')) AS t) s
$$;

-- Comunicado: título + começo do texto
CREATE OR REPLACE FUNCTION public.ao_publicar_comunicado() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_texto TEXT := left(previa(NEW.titulo || ': ' || NEW.conteudo, 200), 255);
BEGIN
  IF NEW.crianca_id IS NULL THEN
    INSERT INTO notificacao (usuario_id, tipo, texto, link)
    SELECT id, 'COMUNICADO', v_texto, '/familia'
    FROM usuario WHERE perfil = 'RESPONSAVEL' AND ativo;
  ELSE
    PERFORM notificar_familia(NEW.crianca_id, 'COMUNICADO', v_texto, '/familia');
  END IF;
  RETURN NEW;
END $$;

-- Mensagem: quem mandou + começo da mensagem
CREATE OR REPLACE FUNCTION public.ao_enviar_mensagem() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nome TEXT;
BEGIN
  SELECT split_part(nome_completo, ' ', 1) INTO v_nome FROM crianca WHERE id = NEW.crianca_id;
  IF NEW.remetente_nome = 'Hotelzinho' THEN
    PERFORM notificar_familia(NEW.crianca_id, 'MENSAGEM',
      left(COALESCE(v_nome || ' · ', '') || 'Hotelzinho: ' || previa(NEW.conteudo, 160), 255),
      '/familia/mensagens');
  ELSE
    PERFORM notificar_admins('MENSAGEM',
      left(COALESCE(split_part(NEW.remetente_nome, ' ', 1), 'Responsável')
           || ' (' || COALESCE(v_nome, 'criança') || '): ' || previa(NEW.conteudo, 160), 255),
      '/admin/mensagens/' || NEW.crianca_id);
  END IF;
  RETURN NEW;
END $$;

-- Ocorrência e recado visíveis à família: nome da criança + descrição
CREATE OR REPLACE FUNCTION public.ao_registrar_rotina() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nome TEXT;
BEGIN
  IF NEW.visivel_pais AND NEW.tipo IN ('OCORRENCIA', 'RECADO') THEN
    SELECT split_part(nome_completo, ' ', 1) INTO v_nome FROM crianca WHERE id = NEW.crianca_id;
    PERFORM notificar_familia(NEW.crianca_id, NEW.tipo::text,
      left(COALESCE(v_nome || ': ', '') || previa(NEW.descricao, 180), 255), '/familia/rotina');
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.previa(TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ao_publicar_comunicado(), public.ao_enviar_mensagem(), public.ao_registrar_rotina()
  FROM PUBLIC, anon, authenticated;
