import { SessionDocumentBoundary } from "@/components/auth/session-document-boundary"

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <section className="min-h-screen w-full bg-background">
      <SessionDocumentBoundary />
      <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden p-6 md:p-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(102,0,153,0.08),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(235,60,125,0.10),transparent_28%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgba(255,255,255,0.35),transparent)] dark:bg-[linear-gradient(to_bottom,transparent,rgba(255,255,255,0.02),transparent)]" />

        <div className="relative flex w-full items-center justify-center">
          {children}
        </div>
      </div>
    </section>
  )
}