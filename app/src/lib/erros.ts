import type { PostgrestError } from '@supabase/supabase-js'

/** Traduz erros do banco para mensagens simples, sem detalhes técnicos. */
export function mensagemDeErro(erro: PostgrestError | null | undefined): string | null {
  if (!erro) return null
  switch (erro.code) {
    case '23514': // check_violation: regra da tabela (horário, fim de semana, feriado...)
      if (/feriado/i.test(erro.message)) return 'Hoje é feriado: o hotelzinho não funciona.'
      if (/hora_saida/i.test(erro.message)) return 'A saída precisa ser depois da entrada.'
      if (/isodow/i.test(erro.message)) return 'O hotelzinho só funciona de segunda a sexta.'
      return 'Algum dado está fora das regras. Confira os horários e tente de novo.'
    case '23505': // unique_violation
      return 'Este registro já existe.'
    case '42501': // permissão (RLS)
      return 'Você não tem permissão para esta ação.'
    default:
      return 'Não foi possível salvar. Verifique a conexão e tente de novo.'
  }
}
