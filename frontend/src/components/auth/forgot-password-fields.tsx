"use client"

import Link from "next/link"
import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

import { AuthFeedback } from "@/components/auth/auth-feedback"

export function ForgotPasswordFields() {
  const [email, setEmail] = useState("")
  const [feedback, setFeedback] = useState<{
    type: "error" | "success"
    message: string
  } | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!email.trim()) {
      setFeedback({
        type: "error",
        message: "Informe um e-mail para continuar.",
      })
      return
    }

    setFeedback({
      type: "success",
      message:
        "Solicitação de teste enviada. Se o e-mail existir, você receberá instruções para redefinir a senha.",
    })
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="recovery-email">E-mail corporativo</Label>
        <Input
          id="recovery-email"
          type="email"
          placeholder="voce@empresa.com"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={feedback?.type === "error" ? true : undefined}
        />
      </div>

      {feedback ? (
        <AuthFeedback type={feedback.type} message={feedback.message} />
      ) : null}

      <Button type="submit" className="w-full">
        Enviar instruções
      </Button>

      <div className="my-6">
        <Separator />
      </div>

      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">Lembrou da senha?</p>
        <Link
          href="/auth/login"
          className="font-medium text-primary transition-colors hover:opacity-90"
        >
          Voltar para login
        </Link>
      </div>
    </form>
  )
}