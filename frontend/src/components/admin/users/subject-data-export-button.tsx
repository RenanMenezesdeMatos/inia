"use client"

import { useState } from "react"
import { FileDown } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { downloadSubjectDataExport } from "@/services/admin/subject-data-export-service"

/**
 * Pedido do titular (LGPD art. 18): baixa um JSON com tudo o que a INIA guarda ligado à pessoa (senhas e hashes omitidos; CPF,
 * telefone, e-mail e protocolo de clientes mascarados nas transcrições). A exportação fica auditada. O arquivo vai para o
 * Privacy conferir antes de entregar ao titular.
 */
export function SubjectDataExportButton({ personId, personName }: { personId: string; personName: string }) {
  const [pending, setPending] = useState(false)

  async function exportData() {
    setPending(true)
    try {
      await downloadSubjectDataExport(personId)
      toast.success(`Dados de ${personName} exportados. Confira o arquivo antes de entregar ao titular.`)
    } catch {
      toast.error("Não foi possível exportar os dados. Tente de novo.")
    } finally {
      setPending(false)
    }
  }

  return (
    <section aria-labelledby="subject-export-title" className="space-y-2 rounded-md border p-3" data-testid="subject-data-export">
      <h3 id="subject-export-title" className="text-sm font-medium">Pedido do titular (LGPD)</h3>
      <p className="text-xs text-muted-foreground">
        Gera um arquivo com tudo o que a INIA guarda ligado a esta pessoa, para responder a um pedido de acesso aos dados. Senhas e
        códigos de segurança ficam de fora e os dados de clientes nas transcrições saem mascarados. A exportação fica registrada na auditoria.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => void exportData()} disabled={pending}>
        <FileDown aria-hidden /> {pending ? "Exportando…" : "Exportar dados (LGPD)"}
      </Button>
    </section>
  )
}
