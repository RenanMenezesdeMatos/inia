"use client"

import { useState } from "react"

import { ErrorScreen } from "@/components/error-states/error-screen"
import { CLIENT_ERROR_CODES } from "@/lib/errors/client-error-codes"
import { FAILURE_COPY, type Failure } from "@/lib/errors/failure"

/** 404 da interface: código estável, sem referência (nada foi registrado — o caminho pedido fica no log do IIS). */
export function NotFoundScreen() {
  const [failure] = useState<Failure>(() => ({ kind: "404", status: 404, code: CLIENT_ERROR_CODES.pageNotFound, reference: null, referenceScope: "local", occurredAt: new Date().toISOString(), needsReport: false }))
  return (
    <main className="min-h-screen bg-canvas text-foreground">
      <ErrorScreen failure={failure} action={{ label: FAILURE_COPY["404"].actionLabel, href: "/" }} />
    </main>
  )
}
