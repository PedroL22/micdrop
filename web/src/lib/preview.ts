import { useSyncExternalStore } from "react"
import { toast } from "sonner"

// Prévia de 5 segundos: um único <audio> para o app todo, para nunca tocarem duas juntas.
const audio = new Audio()
let state: { key: string | null; loading: boolean } = { key: null, loading: false }
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function set(next: typeof state) {
  state = next
  listeners.forEach(l => l())
}

export function stopPreview() {
  audio.pause()
  clearTimeout(timer)
  if (state.key) set({ key: null, loading: false })
}
audio.onended = stopPreview

/** key: identifica o botão; src: áudio; start: segundo inicial (null = o áudio já é o trecho). */
export async function togglePreview(key: string, src: string, start: number | null = null, seconds = 5) {
  if (state.key === key) return stopPreview()
  stopPreview()
  set({ key, loading: true })
  audio.src = src
  try {
    if (start !== null) {
      await new Promise((ok, fail) => {
        audio.onloadedmetadata = ok
        audio.onerror = fail
      })
      audio.currentTime = start
    }
    await audio.play()
    if (state.key !== key) return
    set({ key, loading: false })
    timer = setTimeout(stopPreview, seconds * 1000 + 300)
  } catch {
    if (state.key === key) {
      toast.error("Não deu para tocar a prévia")
      stopPreview()
    }
  }
}

export function usePreview() {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}
