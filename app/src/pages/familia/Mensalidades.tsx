import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import QRCode from 'qrcode'
import { botaoPrincipal, botaoSecundario } from '../../components/Campos'
import { Folha } from '../../components/Folha'
import { competenciaBR, dataBR, dinheiro, rotuloStatus } from '../../lib/formato'
import { codigoPix } from '../../lib/pix'
import { supabase } from '../../lib/supabase'
import type { StatusMensalidade } from '../../lib/tipos'

type Mens = {
  id: number
  crianca_id: number
  competencia: string
  valor_final: number
  data_vencimento: string
  valor_em_aberto: number
  status: StatusMensalidade
  observacao: string | null
}
type Recusa = { mensalidade_id: number; motivo_recusa: string | null; enviado_em: string; status: string }
type ConfigPix = { pix_chave: string | null; pix_nome: string | null; pix_cidade: string | null }

const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
const LIMITE_MB = 5

/**
 * Mensalidades da família. A lista vem só com as crianças vinculadas a quem está logado (RLS).
 * O pagamento é por Pix estático + envio de comprovante; quem confirma é a administração.
 */
export function FamiliaMensalidades() {
  const [lista, setLista] = useState<Mens[] | null>(null)
  const [nomes, setNomes] = useState<Map<number, string>>(new Map())
  const [recusas, setRecusas] = useState<Map<number, string>>(new Map())
  const [config, setConfig] = useState<ConfigPix | null>(null)
  const [pagando, setPagando] = useState<Mens | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!supabase) return
    const [rM, rC, rP, rR] = await Promise.all([
      supabase.from('vw_mensalidade_status').select('id, crianca_id, competencia, valor_final, data_vencimento, valor_em_aberto, status, observacao')
        .neq('status', 'CANCELADA').order('competencia', { ascending: false }),
      supabase.from('crianca').select('id, nome_completo'),
      supabase.from('configuracao').select('pix_chave, pix_nome, pix_cidade').maybeSingle(),
      supabase.from('comprovante').select('mensalidade_id, motivo_recusa, enviado_em, status').order('enviado_em', { ascending: false }),
    ])
    setLista((rM.data ?? []) as Mens[])
    setNomes(new Map(((rC.data ?? []) as { id: number; nome_completo: string }[]).map((c) => [c.id, c.nome_completo])))
    setConfig((rP.data ?? null) as ConfigPix | null)
    // Motivo da recusa mais recente, quando o último comprovante da mensalidade foi recusado
    const ultimo = new Map<number, Recusa>()
    for (const c of (rR.data ?? []) as Recusa[]) if (!ultimo.has(c.mensalidade_id)) ultimo.set(c.mensalidade_id, c)
    setRecusas(new Map([...ultimo].filter(([, c]) => c.status === 'RECUSADO').map(([id, c]) => [id, c.motivo_recusa ?? ''])))
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const abertas = (lista ?? []).filter((m) => m.status === 'PENDENTE' || m.status === 'ATRASADO')
  const totalAberto = abertas.reduce((s, m) => s + Number(m.valor_em_aberto), 0)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Mensalidades</h1>

      {aviso && <p role="status" className="rounded-xl bg-indigo-100 text-indigo-900 p-3 text-sm font-semibold">{aviso}</p>}

      {lista !== null && (
        <section className="bg-white rounded-2xl p-4">
          <p className="text-sm text-suave">Valor em aberto</p>
          <p className="text-3xl font-bold">{dinheiro(totalAberto)}</p>
        </section>
      )}

      {lista === null && <p className="text-suave">Carregando…</p>}
      {lista?.length === 0 && <p className="bg-white rounded-2xl p-4 text-suave">Nenhuma mensalidade ainda.</p>}

      <ul className="flex flex-col gap-3">
        {lista?.map((m) => {
          const podePagar = m.status === 'PENDENTE' || m.status === 'ATRASADO'
          return (
            <li key={m.id} className="bg-white rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <p className="font-bold">{competenciaBR(m.competencia)}</p>
                  <p className="text-sm text-suave">{nomes.get(m.crianca_id)} · vence {dataBR(m.data_vencimento)}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-bold">{dinheiro(m.valor_final)}</span>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${rotuloStatus[m.status].classe}`}>{rotuloStatus[m.status].texto}</span>
                </div>
              </div>
              {m.observacao && <p className="text-sm text-suave">Valor ajustado pela administração: {m.observacao}</p>}
              {m.status === 'EM_ANALISE' && <p className="text-sm text-suave">Comprovante enviado. A administração vai conferir e você recebe um aviso.</p>}
              {podePagar && recusas.has(m.id) && (
                <p className="text-sm text-red-800">Comprovante anterior recusado: {recusas.get(m.id)}</p>
              )}
              {podePagar && <button onClick={() => setPagando(m)} className={botaoPrincipal}>Pagar com Pix</button>}
            </li>
          )
        })}
      </ul>

      <FolhaPagar
        mensalidade={pagando}
        nomeCrianca={pagando ? nomes.get(pagando.crianca_id) ?? '' : ''}
        config={config}
        aoFechar={() => setPagando(null)}
        aoEnviar={() => {
          setPagando(null)
          setAviso('Comprovante enviado. A mensalidade está em análise até a administração confirmar.')
          carregar()
        }}
      />
    </div>
  )
}

function FolhaPagar({ mensalidade: m, nomeCrianca, config, aoFechar, aoEnviar }: {
  mensalidade: Mens | null
  nomeCrianca: string
  config: ConfigPix | null
  aoFechar: () => void
  aoEnviar: () => void
}) {
  const [qr, setQr] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const pixPronto = !!config?.pix_chave

  useEffect(() => {
    setQr(null); setCopiado(false); setArquivo(null); setErro(null)
    if (!m || !config?.pix_chave) return
    const c = codigoPix({
      chave: config.pix_chave, nome: config.pix_nome ?? '', cidade: config.pix_cidade ?? '',
      valor: Number(m.valor_em_aberto), identificador: `MENS${m.id}`,
    })
    setCodigo(c)
    QRCode.toDataURL(c, { margin: 1, width: 240 }).then(setQr)
  }, [m, config])

  const copiar = async () => {
    try { await navigator.clipboard.writeText(codigo); setCopiado(true) } catch { setErro('Não foi possível copiar. Selecione o código e copie manualmente.') }
  }

  const escolher = (e: ChangeEvent<HTMLInputElement>) => {
    setErro(null)
    const f = e.target.files?.[0] ?? null
    if (f && !TIPOS_ACEITOS.includes(f.type)) { setErro('Envie uma foto (JPG, PNG) ou PDF.'); setArquivo(null); return }
    if (f && f.size > LIMITE_MB * 1024 * 1024) { setErro(`O arquivo passa de ${LIMITE_MB} MB.`); setArquivo(null); return }
    setArquivo(f)
  }

  const enviar = async () => {
    if (!supabase || !m) return
    if (!arquivo) { setErro('Escolha a foto ou o PDF do comprovante.'); return }
    setEnviando(true)
    const { data: meuId, error: e1 } = await supabase.rpc('meu_responsavel_id')
    if (e1 || !meuId) { setEnviando(false); setErro('Seu cadastro de responsável não foi encontrado. Fale com a administração.'); return }
    const ext = (arquivo.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const caminho = `${meuId}/${m.id}-${Date.now()}.${ext}`
    const { error: e2 } = await supabase.storage.from('comprovantes').upload(caminho, arquivo, { contentType: arquivo.type })
    if (e2) { setEnviando(false); setErro('Não foi possível enviar o arquivo. Tente de novo.'); return }
    const { error: e3 } = await supabase.from('comprovante').insert({ mensalidade_id: m.id, responsavel_id: meuId, arquivo_path: caminho })
    setEnviando(false)
    if (e3) { setErro('O arquivo foi enviado, mas não foi possível registrar o comprovante. Tente de novo.'); return }
    aoEnviar()
  }

  if (!m) return null
  return (
    <Folha titulo={`Pagar ${competenciaBR(m.competencia)}`} aberta={!!m} aoFechar={aoFechar}>
      <div>
        <p className="text-sm text-suave">{nomeCrianca} · vence {dataBR(m.data_vencimento)}</p>
        <p className="text-3xl font-bold">{dinheiro(m.valor_em_aberto)}</p>
      </div>

      {!pixPronto ? (
        <p role="alert" className="rounded-xl bg-amber-100 text-amber-900 p-3 text-sm">
          A chave Pix do hotelzinho ainda não foi cadastrada. Fale com a administração.
        </p>
      ) : (
        <section className="flex flex-col gap-3">
          <p className="text-sm font-bold text-marca">1 · Pague pelo app do seu banco</p>
          {qr && <img src={qr} alt="QR Code Pix com o valor da mensalidade" className="self-center w-56 h-56 rounded-xl border border-borda" />}
          <button onClick={copiar} className={botaoSecundario}>{copiado ? 'Código copiado!' : 'Copiar código Pix (copia e cola)'}</button>
          <p className="text-xs text-suave">Confira no seu banco o nome do recebedor e o valor antes de confirmar.</p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <p className="text-sm font-bold text-marca">2 · Envie o comprovante</p>
        <label className="relative min-h-[72px] rounded-xl border-[1.5px] border-dashed border-marca flex flex-col items-center justify-center gap-1 text-sm font-bold text-marca cursor-pointer px-3 text-center">
          Escolher foto ou PDF
          <span className="text-xs font-normal text-suave">{arquivo ? arquivo.name : `JPG, PNG ou PDF até ${LIMITE_MB} MB`}</span>
          <input type="file" accept={TIPOS_ACEITOS.join(',')} onChange={escolher} className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
        {erro && <p role="alert" className="text-sm font-semibold text-red-800">{erro}</p>}
        <button onClick={enviar} disabled={enviando} className={botaoPrincipal}>{enviando ? 'Enviando…' : 'Enviar comprovante'}</button>
        <p className="text-xs text-suave text-center">A mensalidade só aparece como paga depois que a administração confirmar.</p>
      </section>
    </Folha>
  )
}
