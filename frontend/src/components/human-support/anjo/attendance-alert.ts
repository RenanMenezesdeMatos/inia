/**
 * AVISO DE ATENDIMENTO NOVO NA ÁREA DO ANJO (design_draft.md seção 14, D9): o som e o título piscando vêm de `lib/attention`, o mesmo
 * aviso de mensagem nova dos dois lados do apoio.
 */
export { blinkTabTitle, createChime as createAttendanceChime, newMessageTitle, type Chime as AttendanceChime } from "@/lib/attention/attention-alert"

export const NEW_ATTENDANCE_TITLE = "• Novo atendimento — INIA"
