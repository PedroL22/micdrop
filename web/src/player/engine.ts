import type { Settings } from "@/lib/types"

export const STEMS = ["instrumental", "backing", "lead", "original"] as const
type Stem = (typeof STEMS)[number]

/** Toca as 4 faixas da música juntas (Web Audio), em sincronia perfeita. */
export class AudioEngine {
  private ctx = new AudioContext()
  private master = this.ctx.createGain()
  private gains = {} as Record<Stem, GainNode>
  private buffers: Partial<Record<Stem, AudioBuffer>> = {}
  private sources: AudioBufferSourceNode[] = []
  private startedAt = 0 // ctx.currentTime em que startPos começou a tocar
  private startPos = 0
  private listeners = new Set<() => void>()
  playing = false
  duration = 0

  constructor() {
    this.master.connect(this.ctx.destination)
    for (const s of STEMS) {
      this.gains[s] = this.ctx.createGain()
      this.gains[s].gain.value = 0
      this.gains[s].connect(this.master)
    }
  }

  private loading?: Promise<void>

  /** Baixa e decodifica as 4 faixas (uma vez só, mesmo se chamado de novo). */
  load(songId: string, onProgress?: (done: number, total: number) => void) {
    this.loading ??= this.fetchStems(songId, onProgress)
    return this.loading
  }

  private async fetchStems(songId: string, onProgress?: (done: number, total: number) => void) {
    let done = 0
    await Promise.all(
      STEMS.map(async s => {
        const res = await fetch(`/media/${songId}/${s}.flac`)
        if (!res.ok) throw new Error(`faixa ${s} não encontrada`)
        this.buffers[s] = await this.ctx.decodeAudioData(await res.arrayBuffer())
        onProgress?.(++done, STEMS.length)
      }),
    )
    this.duration = Math.max(...STEMS.map(s => this.buffers[s]!.duration))
  }

  position() {
    return this.playing ? Math.min(this.duration, this.startPos + (this.ctx.currentTime - this.startedAt)) : this.startPos
  }

  play() {
    if (this.playing || !this.duration) return
    this.ctx.resume()
    if (this.startPos >= this.duration - 0.05) this.startPos = 0
    const when = this.ctx.currentTime + 0.05
    this.sources = STEMS.filter(s => this.buffers[s]).map(s => {
      const src = this.ctx.createBufferSource()
      src.buffer = this.buffers[s]!
      src.connect(this.gains[s])
      src.start(when, this.startPos)
      return src
    })
    this.startedAt = when
    this.playing = true
    this.emit()
  }

  pause() {
    if (!this.playing) return
    this.startPos = this.position()
    for (const src of this.sources) {
      try {
        src.stop()
      } catch {
        /* já parou */
      }
    }
    this.sources = []
    this.playing = false
    this.emit()
  }

  toggle() {
    this.playing ? this.pause() : this.play()
  }

  seek(t: number) {
    const was = this.playing
    this.pause()
    this.startPos = Math.max(0, Math.min(this.duration, t))
    if (was) this.play()
    this.emit()
  }

  /** Para no fim da música (chamado pelo laço de animação). */
  checkEnd() {
    if (this.playing && this.position() >= this.duration) {
      this.pause()
      this.startPos = this.duration
    }
  }

  setMix(st: Settings) {
    const orig = st.mode === "original"
    const target: Record<Stem, number> = {
      original: orig ? 1 : 0,
      instrumental: orig ? 0 : 1,
      backing: orig ? 0 : st.backing,
      lead: orig ? 0 : st.lead,
    }
    for (const s of STEMS) this.gains[s].gain.setTargetAtTime(target[s], this.ctx.currentTime, 0.03)
  }

  setVolume(v: number) {
    this.master.gain.value = v
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit() {
    this.listeners.forEach(l => l())
  }

  close() {
    this.pause()
    this.ctx.close()
  }
}
