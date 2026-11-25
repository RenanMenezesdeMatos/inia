import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

/** Câmera desligada: a foto dela no centro, como numa chamada sem vídeo. `compact`: só a foto (o texto fica para leitor de tela). */
export function IniaCameraOff({ image, compact = false }: { image: string; compact?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 bg-[radial-gradient(circle_at_50%_38%,#3d2a5c,#1b1426_72%)] p-4 pb-12 text-center text-white">
      <Avatar className={compact ? "aspect-square size-auto h-[min(3.5rem,82%)] ring-2 ring-white/20" : "size-16 ring-2 ring-white/20"}>
        <AvatarImage src={image} alt="" />
        <AvatarFallback className="bg-primary text-primary-foreground">IA</AvatarFallback>
      </Avatar>
      <p className={compact ? "sr-only" : "text-xs text-white/70"}>Câmera desligada — você continua falando com ela.</p>
    </div>
  )
}
