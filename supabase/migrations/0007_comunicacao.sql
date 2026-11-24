-- =====================================================================
-- Migration 0007: comunicação
--  1) Cada mensagem guarda o nome de quem enviou ("Hotelzinho" para a
--     administração, ou o nome do responsável), preenchido pelo banco.
--     Assim a mãe vê o nome do pai na mesma conversa sem precisar ler o
--     cadastro dele.
--  2) Função para marcar como lidas as mensagens de uma criança que
--     foram enviadas pela outra parte.
--  3) Mensagem nova avisa o outro lado (notificação).
-- =====================================================================

ALTER TABLE mensagem ADD COLUMN remetente_nome VARCHAR(150);

CREATE OR REPLACE FUNCTION public.preparar_mensagem() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.remetente_nome := CASE
    WHEN EXISTS (SELECT 1 FROM usuario WHERE id = NEW.remetente_id AND perfil = 'ADMIN') THEN 'Hotelzinho'
    ELSE COALESCE((SELECT nome FROM responsavel WHERE usuario_id = NEW.remetente_id), 'Responsável')
  END;
  NEW.enviada_em := now();
  NEW.lida_em := NULL;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_mensagem_preparar
BEFORE INSERT ON mensagem
FOR EACH ROW EXECUTE FUNCTION public.preparar_mensagem();

CREATE OR REPLACE FUNCTION public.ao_enviar_mensagem() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nome TEXT;
BEGIN
  SELECT split_part(nome_completo, ' ', 1) INTO v_nome FROM crianca WHERE id = NEW.crianca_id;
  IF NEW.remetente_nome = 'Hotelzinho' THEN
    PERFORM notificar_familia(NEW.crianca_id, 'MENSAGEM', 'Nova mensagem do hotelzinho.', '/familia/mensagens');
  ELSE
    PERFORM notificar_admins('MENSAGEM', left('Nova mensagem sobre ' || COALESCE(v_nome, 'uma criança'), 255),
                             '/admin/mensagens/' || NEW.crianca_id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_mensagem_notifica
AFTER INSERT ON mensagem
FOR EACH ROW EXECUTE FUNCTION public.ao_enviar_mensagem();

-- Marca como lidas as mensagens da conversa enviadas pela outra parte.
-- Respeita as mesmas regras de acesso: responsável só nas próprias crianças.
CREATE OR REPLACE FUNCTION public.marcar_mensagens_lidas(p_crianca BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin BOOLEAN := eh_admin();
  v_qtd INTEGER;
BEGIN
  IF p_crianca IS NULL OR (NOT v_admin AND NOT EXISTS (SELECT 1 FROM minhas_criancas() c WHERE c = p_crianca)) THEN
    RAISE EXCEPTION 'Sem acesso a esta conversa.' USING ERRCODE = '42501';
  END IF;
  UPDATE mensagem SET lida_em = now()
   WHERE crianca_id = p_crianca AND lida_em IS NULL
     AND (CASE WHEN v_admin THEN remetente_nome <> 'Hotelzinho' ELSE remetente_nome = 'Hotelzinho' END);
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;
END $$;

REVOKE EXECUTE ON FUNCTION public.preparar_mensagem(), public.ao_enviar_mensagem() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marcar_mensagens_lidas(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_mensagens_lidas(BIGINT) TO authenticated;
