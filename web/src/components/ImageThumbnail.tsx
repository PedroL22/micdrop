import { ImageOff } from "lucide-react"
import { useEffect, useRef, useState, type CSSProperties } from "react"

import { cn } from "@/lib/utils"

type Props = {
  src: string
  alt?: string
  className?: string
  containerClassName?: string
  style?: CSSProperties
  loading?: "eager" | "lazy"
}

// Um fundo pulsando enquanto carrega e a imagem
// aparece com fade só depois de decodificada (sem "pintar" de cima para baixo).
function Content({ src, alt = "", className, containerClassName, style, loading = "lazy" }: Props) {
  const img = useRef<HTMLImageElement>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    const image = img.current
    if (!image) return
    let cancelled = false
    const onLoad = () => {
      image
        .decode()
        .then(() => !cancelled && setStatus("ready"))
        .catch(() => !cancelled && setStatus("error"))
    }
    const onError = () => !cancelled && setStatus("error")
    image.addEventListener("load", onLoad)
    image.addEventListener("error", onError)
    // imagens em cache podem terminar antes dos listeners
    if (image.complete) image.naturalWidth > 0 ? onLoad() : onError()
    return () => {
      cancelled = true
      image.removeEventListener("load", onLoad)
      image.removeEventListener("error", onError)
    }
  }, [])

  return (
    <div className={cn("relative overflow-hidden", containerClassName)} style={style} aria-busy={status === "loading"}>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 bg-muted transition-opacity duration-300 motion-reduce:transition-none",
          status === "loading" && "animate-pulse motion-reduce:animate-none",
          // o fundo espera a imagem terminar o fade antes de sumir
          status === "ready" && "opacity-0 delay-300",
        )}
      >
        {status === "error" && (
          <div className="grid size-full place-items-center">
            <ImageOff className="size-5 text-muted-foreground" />
          </div>
        )}
      </div>
      <img
        ref={img}
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        className={cn(
          "size-full object-cover transition-[opacity,scale,translate,transform] duration-300 motion-reduce:transition-none",
          className,
          status === "ready" ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  )
}

/** Um endereço novo começa do zero (mesmo reaproveitando o mesmo lugar na tela). */
export function ImageThumbnail(props: Props) {
  return <Content key={props.src} {...props} />
}
