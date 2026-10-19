import { useEffect, useRef, useState } from "react"

/** Consulta o servidor a cada `ms` (mais devagar com a aba escondida) e só re-renderiza se mudou. */
export function usePolling<T>(fetcher: () => Promise<T>, ms = 1200): [T | undefined, () => void] {
  const [data, setData] = useState<T>()
  const last = useRef("")
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher
  const kick = useRef<() => void>(() => {})

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let alive = true
    const loop = async () => {
      clearTimeout(timer)
      try {
        const value = await fetchRef.current()
        const key = JSON.stringify(value)
        if (alive && key !== last.current) {
          last.current = key
          setData(value)
        }
      } catch {
        /* servidor reiniciando: tenta de novo */
      }
      if (alive) timer = setTimeout(loop, document.hidden ? 4000 : ms)
    }
    kick.current = loop
    loop()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [ms])

  return [data, () => kick.current()]
}
