import { useSyncExternalStore } from "react"
import { toast } from "sonner"

// Prévia de 5 segundos: um único <audio> para o app todo, para nunca tocarem duas juntas.
// O volume entra e sai suave (fade in/out) por um GainNode do Web Audio: no iPhone
// o `audio.volume` é ignorado, mas o ganho do Web Audio funciona.

const FADE_IN = 0.8 // segundos
const FADE_OUT = 1.2 // antes do fim da prévia
const FADE_STOP = 0.25 // ao parar ou trocar de música no meio

const audio = new Audio()
let graph: { ctx: AudioContext; gain: GainNode } | null = null
let state: { key: string | null; loading: boolean } = { key: null, loading: false }
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0 // cada prévia nova invalida as anteriores (fades e timers atrasados)
const listeners = new Set<() => void>()

function set(next: typeof state) {
  state = next
  listeners.forEach(l => l())
}

// Criado no primeiro clique (o navegador só libera áudio depois de um gesto do usuário)
function getGraph() {
  if (!graph) {
    const ctx = new AudioContext()
    const gain = ctx.createGain()
    gain.gain.value = 0
    ctx.createMediaElementSource(audio).connect(gain)
    gain.connect(ctx.destination)
    graph = { ctx, gain }
  }
  graph.ctx.resume()
  return graph
}

/** Leva o volume até `to` em `seconds`, a partir do valor atual. */
function ramp(to: number, seconds: number) {
  if (!graph) return
  const g = graph.gain.gain
  const now = graph.ctx.currentTime
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  g.linearRampToValueAtTime(to, now + seconds)
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Para a prévia com um fade rápido. */
export function stopPreview() {
  clearTimeout(timer)
  const gen = ++generation
  if (state.key) set({ key: null, loading: false })
  if (audio.paused) return
  ramp(0, FADE_STOP)
  wait(FADE_STOP * 1000 + 30).then(() => gen === generation && audio.pause())
}

audio.onended = () => {
  generation++
  clearTimeout(timer)
  if (state.key) set({ key: null, loading: false })
}

/** key: identifica o botão; src: áudio; start: segundo inicial (null = o áudio já é o trecho). */
export async function togglePreview(key: string, src: string, start: number | null = null, seconds = 5) {
  if (state.key === key) return stopPreview()
  const g = getGraph()
  const wasPlaying = !audio.paused
  stopPreview()
  const gen = generation
  set({ key, loading: true })
  if (wasPlaying) await wait(FADE_STOP * 1000 + 40) // deixa a anterior sumir antes de trocar
  if (gen !== generation) return
  audio.pause()
  g.gain.gain.cancelScheduledValues(g.ctx.currentTime)
  g.gain.gain.setValueAtTime(0, g.ctx.currentTime)
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
    if (gen !== generation) return
    set({ key, loading: false })
    ramp(1, FADE_IN)
    // começa a sumir FADE_OUT segundos antes do fim
    timer = setTimeout(() => {
      if (gen !== generation) return
      ramp(0, FADE_OUT)
      timer = setTimeout(() => gen === generation && stopPreview(), FADE_OUT * 1000 + 50)
    }, (seconds - FADE_OUT) * 1000)
  } catch {
    if (gen === generation) {
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
