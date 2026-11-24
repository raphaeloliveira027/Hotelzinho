import { useState } from 'react'
import { useAvisos } from '../lib/push'
import { botaoSecundario } from './Campos'

const CHAVE_DISPENSA = 'hotelzinho-avisos-dispensado'
const lerDispensa = () => { try { return localStorage.getItem(CHAVE_DISPENSA) === '1' } catch { return false } }
const gravarDispensa = () => { try { localStorage.setItem(CHAVE_DISPENSA, '1') } catch { /* sem armazenamento */ } }

function Sino() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2B2A33" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9z" /><path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  )
}

/**
 * modo "convite": cartão que aparece só enquanto os avisos estão desligados (pode ser dispensado).
 * modo "ajuste": mostra o estado e permite ligar ou desligar (tela Mais).
 */
export function AvisosNoCelular({ modo, texto }: { modo: 'convite' | 'ajuste'; texto: string }) {
  const { estado, ativar, desativar, ocupado, erro } = useAvisos()
  const [dispensado, setDispensado] = useState(lerDispensa)

  if (modo === 'convite') {
    if (estado !== 'desligado' || dispensado) return null
    return (
      <section aria-label="Avisos no celular" className="relative rounded-2xl bg-sol p-4 flex gap-3 items-start shadow-[0_3px_0_rgba(43,42,51,0.10)]">
        <span className="w-11 h-11 shrink-0 rounded-xl bg-white flex items-center justify-center"><Sino /></span>
        <div className="flex-1 flex flex-col gap-2 pr-6">
          <p className="font-extrabold leading-tight">Receba avisos no celular</p>
          <p className="text-sm">{texto}</p>
          {erro && <p role="alert" className="text-sm font-semibold text-red-800">{erro}</p>}
          <button onClick={ativar} disabled={ocupado} className="self-start min-h-[44px] px-4 rounded-xl bg-marca text-white font-bold disabled:opacity-60">
            {ocupado ? 'Ativando…' : 'Ativar avisos'}
          </button>
        </div>
        <button onClick={() => { gravarDispensa(); setDispensado(true) }} aria-label="Agora não"
          className="absolute top-1 right-1 w-11 h-11 flex items-center justify-center text-tinta text-xl">×</button>
      </section>
    )
  }

  return (
    <section className="bg-white rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-sol flex items-center justify-center"><Sino /></span>
        <h2 className="font-bold">Avisos no celular</h2>
      </div>
      {estado === 'carregando' && <p className="text-sm text-suave">Carregando…</p>}
      {estado === 'ativo' && (
        <>
          <p role="status" className="text-sm font-semibold text-green-900">Avisos ativados neste celular.</p>
          <p className="text-sm text-suave">{texto}</p>
          <button onClick={desativar} disabled={ocupado} className={botaoSecundario}>{ocupado ? 'Desativando…' : 'Desativar avisos neste celular'}</button>
        </>
      )}
      {estado === 'desligado' && (
        <>
          <p className="text-sm text-suave">{texto}</p>
          <button onClick={ativar} disabled={ocupado} className="min-h-[48px] rounded-xl bg-marca text-white font-bold disabled:opacity-60">
            {ocupado ? 'Ativando…' : 'Ativar avisos'}
          </button>
        </>
      )}
      {estado === 'bloqueado' && (
        <p className="text-sm">Os avisos estão <strong>bloqueados</strong> neste celular. Para liberar, abra os ajustes do
          celular (ou do navegador) › Notificações › Hotelzinho, e permita.</p>
      )}
      {estado === 'instalar-primeiro' && (
        <p className="text-sm">No iPhone, os avisos só funcionam com o app instalado: no Safari, toque em
          <strong> Compartilhar › Adicionar à Tela de Início</strong> e abra o Hotelzinho pelo ícone.</p>
      )}
      {estado === 'sem-suporte' && <p className="text-sm text-suave">Este navegador não recebe avisos. Use o Chrome no Android ou o app instalado no iPhone.</p>}
      {erro && <p role="alert" className="text-sm font-semibold text-red-800">{erro}</p>}
    </section>
  )
}
