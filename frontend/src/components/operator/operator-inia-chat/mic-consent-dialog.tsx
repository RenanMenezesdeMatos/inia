"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type MicConsentDialogProps = {
  showMicConsent: boolean
  setShowMicConsent: React.Dispatch<React.SetStateAction<boolean>>
  confirmMicConsent: () => void
}

/** Consentimento antes da primeira captura do microfone. */
export function MicConsentDialog({ showMicConsent, setShowMicConsent, confirmMicConsent }: MicConsentDialogProps) {
  return <Dialog open={showMicConsent} onOpenChange={setShowMicConsent}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Permitir uso do microfone</DialogTitle>
        <DialogDescription>Sua voz será capturada e enviada para processamento em tempo real enquanto o microfone estiver ativo. Um indicador fica visível durante toda a captura, e você pode encerrar a qualquer momento clicando no microfone ou desligando o avatar.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" onClick={() => setShowMicConsent(false)}>Cancelar</Button>
        <Button onClick={confirmMicConsent}>Permitir microfone</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
