import { Loader2, Play, Square } from "lucide-react"
import type { ReactNode } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { togglePreview, usePreview } from "@/lib/preview"
import { cn } from "@/lib/utils"

/** Botão de ícone com dica ao passar o mouse. */
export function IconButton({
  label,
  children,
  className,
  variant = "ghost",
  size = "icon",
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size={size} aria-label={label} className={className} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** ▶ / ■ que toca 5 segundos da música. */
export function PreviewButton({
  id,
  src,
  start = null,
  variant = "secondary",
  className,
}: {
  id: string
  src: string
  start?: number | null
  variant?: React.ComponentProps<typeof Button>["variant"]
  className?: string
}) {
  const p = usePreview()
  const mine = p.key === id
  return (
    <IconButton
      label={mine ? "Parar a prévia" : "Ouvir 5 segundos"}
      variant={variant}
      className={className}
      onClick={e => {
        e.stopPropagation()
        togglePreview(id, src, start)
      }}
    >
      {mine && p.loading ? <Loader2 className="animate-spin" /> : mine ? <Square className="fill-current" /> : <Play className="fill-current" />}
    </IconButton>
  )
}

/** Pede confirmação antes de uma ação destrutiva. children deve ser um <Button>. */
export function Confirm({
  title,
  description,
  action = "Apagar",
  label,
  onConfirm,
  children,
  open,
  onOpenChange,
}: {
  title: string
  description?: string
  action?: string
  label?: string
  onConfirm: () => void
  children?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const trigger = children ? <AlertDialogTrigger asChild>{children}</AlertDialogTrigger> : null
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger && label ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Miniatura com proporção fixa. */
export function Thumb({ src, className, alt = "" }: { src: string; className?: string; alt?: string }) {
  return <img src={src} alt={alt} loading="lazy" className={cn("shrink-0 rounded-md bg-muted object-cover", className)} />
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">{children}</h2>
      {aside}
    </div>
  )
}
