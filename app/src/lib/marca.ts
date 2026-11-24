/** Nome que aparece no app. Troque aqui pelo nome do hotelzinho (vale para as telas, a aba do navegador e o ícone no celular). */
export const NOME_HOTELZINHO = 'Hotelzinho'
/** Nome curto que aparece embaixo do ícone no celular (até 12 letras para não cortar). */
export const NOME_CURTO = 'Hotelzinho'
export const FRASE_HOTELZINHO = 'Rotina, recados e mensalidades em um só lugar.'

/** Cores de giz de cera para os avatares (sempre com texto escuro por cima). */
export const CORES_AVATAR = ['bg-sol', 'bg-coral', 'bg-ceu', 'bg-folha', 'bg-lilas'] as const
export const corDoAvatar = (id: number) => CORES_AVATAR[Math.abs(id) % CORES_AVATAR.length]
