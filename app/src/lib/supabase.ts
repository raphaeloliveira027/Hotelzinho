import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** true quando o arquivo .env.local foi preenchido com os dados do projeto. */
export const supabaseConfigurado = Boolean(url && chave)

/**
 * Cliente único do Supabase. Usa apenas a chave pública (anon):
 * o que cada pessoa pode ver é decidido pelas políticas RLS do banco.
 */
export const supabase: SupabaseClient | null = supabaseConfigurado
  ? createClient(url!, chave!)
  : null
