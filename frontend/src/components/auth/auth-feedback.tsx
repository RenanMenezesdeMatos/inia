type AuthFeedbackProps = {
  type: "error" | "success"
  message: string
}

export function AuthFeedback({ type, message }: AuthFeedbackProps) {
  return (
    <div
      className={
        type === "error"
          ? "rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          : "rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary"
      }
    >
      {message}
    </div>
  )
}
