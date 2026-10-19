import type { Song } from "./types"

// Identifica este navegador, para cada um só poder apagar as próprias músicas.
export const TOKEN: string =
  localStorage.karaokeToken ||
  (localStorage.karaokeToken = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now())

type Options = { method?: string; body?: Record<string, unknown> }

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const url = path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(TOKEN)
  const init: RequestInit = { method: opts.method || "GET", headers: {} }
  if (opts.body !== undefined) {
    init.headers = { "Content-Type": "application/json" }
    init.body = JSON.stringify({ token: TOKEN, ...opts.body })
  }
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
  return data as T
}

export function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

export function pct(v: number) {
  return `${Math.round(v * 100)}%`
}

// "Somewhere I Belong – Linkin Park" + "Linkin Park" -> "Somewhere I Belong"
export function cleanTitle(title: string, artist?: string) {
  const norm = (s?: string) => (s || "").toLowerCase().replace(/vevo/g, "").replace(/[^a-z0-9]/g, "")
  const parts = (title || "").split(/\s+[-–—|]\s+/)
  if (parts.length >= 2 && artist) {
    if (norm(parts[parts.length - 1]) === norm(artist)) return parts.slice(0, -1).join(" - ").trim()
    if (norm(parts[0]) === norm(artist)) return parts.slice(1).join(" - ").trim()
  }
  return (title || "").trim()
}

export function songTitle(s: Song) {
  return cleanTitle(s.title, s.artist)
}

export function songArt(s: Song) {
  return s.cover ? `/media/${s.id}/cover.jpg?v=${s.cover_v || 0}` : `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`
}

const SCALE_PT: Record<string, string> = { Major: "maior", Minor: "menor", Chromatic: "cromática" }
export function keyLabel(key: string, scale: string) {
  return `${key} ${SCALE_PT[scale] || scale}`
}

export function wordsReady(s: Song) {
  const l = s.lyrics
  return !!(l && l.synced && l.words_source && l.align?.status !== "error")
}
