/** Rotas da área editorial (sem dependências: o layout da Administração, no servidor, também as importa). */
export const PUBLICATIONS_PATH = "/admin/publicacoes"
export const newPublicationPath = `${PUBLICATIONS_PATH}/nova`
export const publicationPath = (id: string) => `${PUBLICATIONS_PATH}/${id}`
/** Leitura de um comunicado no ar por quem o recebe (link citado pela INIA no chat). */
export const publicationReadingPath = (id: string) => `/publicacoes/${id}`
/** Conferência de uma publicação de outra pessoa pela moderação (Administrador geral). */
export const moderationPath = (id: string) => `${PUBLICATIONS_PATH}/moderacao/${id}`
/** Alinhamento operacional novo, dentro de Publicações (aba Alinhamentos operacionais, já no formulário). */
export const newAlignmentPath = `${PUBLICATIONS_PATH}?tipo=alinhamentos&novo=1`
