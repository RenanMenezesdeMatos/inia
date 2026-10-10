import {
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type AuthCardHeaderProps = {
  title: string
  description: string
  badge?: string
}

export function AuthCardHeader({
  title,
  description,
  badge = "I",
}: AuthCardHeaderProps) {
  return (
    <CardHeader className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <span className="text-sm font-semibold">{badge}</span>
        </div>

        <div className="space-y-1">
          <CardTitle className="text-xl font-semibold tracking-tight">
            {title}
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            {description}
          </CardDescription>
        </div>
      </div>
    </CardHeader>
  )
}