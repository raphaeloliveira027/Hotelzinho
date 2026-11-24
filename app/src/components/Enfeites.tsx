import { corDoAvatar } from '../lib/marca'
import { iniciais } from '../lib/formato'

/** Logo: casinha com telhado colorido e um solzinho (desenho original). */
export function Logo({ tamanho = 56 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="50" cy="14" r="8" fill="#FFD54A" />
      <g stroke="#FFD54A" strokeWidth="2.5" strokeLinecap="round">
        <path d="M50 1.5v3M50 23.5v3M37.5 14h3M59.5 14h3M41.2 5.2l2.1 2.1M56.7 20.7l2.1 2.1M58.8 5.2l-2.1 2.1" />
      </g>
      <path d="M8 30 32 11l24 19" fill="#FF8A78" stroke="#2B2A33" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <rect x="13" y="28" width="38" height="29" rx="4" fill="#FFFFFF" stroke="#2B2A33" strokeWidth="3" />
      <rect x="27" y="40" width="10" height="17" rx="2" fill="#1D6FB8" />
      <rect x="17.5" y="34" width="7" height="7" rx="1.5" fill="#A8D8F0" stroke="#2B2A33" strokeWidth="2" />
      <rect x="39.5" y="34" width="7" height="7" rx="1.5" fill="#A8D8F0" stroke="#2B2A33" strokeWidth="2" />
      <path d="M29 22.5c0-1.6 1.3-2.6 3-1.2 1.7-1.4 3-.4 3 1.2 0 2-3 3.6-3 3.6s-3-1.6-3-3.6z" fill="#FF8A78" />
    </svg>
  )
}

/** Fileira de bandeirinhas coloridas para o topo das telas de entrada. */
export function Bandeirinhas({ className = '' }: { className?: string }) {
  const cores = ['#FFD54A', '#FF8A78', '#A8D8F0', '#B5E3C2', '#D9C8F5']
  return (
    <svg viewBox="0 0 390 44" preserveAspectRatio="none" className={`w-full h-11 ${className}`} aria-hidden="true">
      <path d="M0 6 Q195 30 390 6" fill="none" stroke="#C9B89A" strokeWidth="1.5" />
      {Array.from({ length: 13 }, (_, i) => {
        const x = 8 + i * 30
        const t = x / 390
        const y = 6 + 24 * 4 * t * (1 - t) * 0.5 + 0.5
        return <path key={i} d={`M${x} ${y} L${x + 22} ${y} L${x + 11} ${y + 18} Z`} fill={cores[i % cores.length]} />
      })}
    </svg>
  )
}

/** Nuvenzinha decorativa. */
export function Nuvem({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 40" className={className} aria-hidden="true">
      <path d="M18 34h44a12 12 0 0 0 0-24 16 16 0 0 0-30-4 12 12 0 0 0-14 28z" fill="#FFFFFF" />
    </svg>
  )
}

/** Estrelinha decorativa. */
export function Estrela({ className = '', cor = '#FFD54A' }: { className?: string; cor?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 2.5l2.7 6 6.5.6-4.9 4.3 1.5 6.4L12 16.5l-5.8 3.3 1.5-6.4L2.8 9.1l6.5-.6z" fill={cor} stroke="#2B2A33" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

/** Avatar redondo da criança, cada uma com sua cor de giz de cera. */
export function Avatar({ id, nome, tamanho = 'md' }: { id: number; nome: string; tamanho?: 'md' | 'lg' }) {
  const t = tamanho === 'lg' ? 'w-14 h-14 text-lg' : 'w-11 h-11 text-sm'
  return (
    <div aria-hidden="true" className={`${t} ${corDoAvatar(id)} shrink-0 rounded-full text-tinta flex items-center justify-center font-extrabold border-2 border-white shadow-[0_2px_0_rgba(43,42,51,0.12)]`}>
      {iniciais(nome)}
    </div>
  )
}
