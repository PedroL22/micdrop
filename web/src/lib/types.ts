export type SearchResult = {
  id: string
  title: string
  channel: string
  duration: number
  thumbnail: string
}

export type Job = {
  id: string
  video_id: string
  title: string
  channel: string
  duration: number
  thumbnail: string
  owner_name?: string
  status: "queued" | "running" | "error"
  stage: string
  progress: number
  error: string | null
  mine: boolean
}

export type LyricLine = { t: number | null; text: string; w?: [number, number][] }

export type Lyrics = {
  synced: boolean
  lines: LyricLine[]
  source: string
  words_source?: "lrc" | "align"
  align?: { status?: "queued" | "running" | "done" | "error"; progress?: number; stage?: string; error?: string } | null
}

export type Video = {
  source: string
  status: "downloading" | "ready" | "error"
  progress: number
  file: string | null
  title?: string
  duration?: number
  error: string | null
}

export type Settings = {
  mode: "original" | "instrumental"
  backing: number
  lead: number
  blur: number
  brightness: number
  bg: "cover" | "video"
  video_offset: number
}

export type Song = {
  id: string
  title: string
  artist: string
  channel: string
  video_title: string
  duration: number
  thumbnail: string
  cover: string | null
  cover_v?: number
  key: string
  scale: string
  lyrics: Lyrics | null
  video?: Video | null
  offset: number
  settings: Settings
  owner_name?: string
  mine: boolean
  created: number
}

export type Info = {
  session_url: string
  admin: boolean
  midi_device: string
  midi_devices: string[]
  notes: string[]
  scales: string[]
}

export type LyricsResult = {
  id: number
  track: string
  artist: string
  album: string
  duration: number
  synced: boolean
}

export type CoverResult = { thumb: string; full: string; album?: string; artist?: string }
