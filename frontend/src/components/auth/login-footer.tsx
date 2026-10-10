import { CardFooter } from "@/components/ui/card"

export function LoginFooter() {
  return (
    <CardFooter className="flex flex-col items-start gap-3 pt-0">
      <p className="text-xs text-muted-foreground">
       
      </p>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-full bg-primary" />
        <span className="inline-block h-2 w-2 rounded-full bg-accent" />
        <span className="inline-block h-2 w-2 rounded-full bg-secondary" />
      </div>
    </CardFooter>
  )
}