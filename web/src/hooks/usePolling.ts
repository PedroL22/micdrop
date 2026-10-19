import { useEffect, useRef, useState } from "react"

const cache = new Map<string, unknown>()

/**
 * Consulta o servidor a cada `ms` (mais devagar com a aba escondida) e só re-renderiza se mudou.
 * Com `key`, guarda o último resultado: ao voltar para a tela ela já aparece preenchida.
 */
export function usePolling<T>(fetcher: () => Promise<T>, ms = 1200, key?: string): [T | undefined, () => void] {
  const [data, setData] = useState<T | undefined>(() => (key ? (cache.get(key) as T | undefined) : undefined))
  const last = useRef(key && cache.has(key) ? JSON.stringify(cache.get(key)) : "")
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
        const json = JSON.stringify(value)
        if (alive && json !== last.current) {
          last.current = json
          if (key) cache.set(key, value)
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
  }, [ms, key])

  return [data, () => kick.current()]
}
