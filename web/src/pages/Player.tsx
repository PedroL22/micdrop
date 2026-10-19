import {
  ArrowLeft,
  Clapperboard,
  Crosshair,
  FileText,
  Image,
  Loader2,
  Maximize,
  Mic2,
  Minimize,
  Monitor,
  Music,
  Pause,
  Play,
  Type,
  Volume2,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { IconButton } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, cleanTitle, fmtTime, pct, wordsReady } from "@/lib/api"
import type { Info, Settings, Song } from "@/lib/types"
import { cn } from "@/lib/utils"
import { AudioEngine } from "@/player/engine"
import { LyricsView } from "@/player/LyricsView"
import { Pickers, type PickerTab } from "@/player/Pickers"

const DEFAULTS: Settings = { mode: "instrumental", backing: 1, lead: 0, blur: 0.5, brightness: 0.85, bg: "cover", video_offset: 0 }

function SliderRow({ label, value, onChange, min = 0, disabled }: { label: string; value: number; onChange: (v: number) => void; min?: number; disabled?: boolean }) {
  return (
    <div className={cn("space-y-2", disabled && "opacity-50")}>
      <div className="flex items-center justify-between text-sm">
        <Label>{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">{pct(value)}</span>
      </div>
      <Slider value={[Math.round(value * 100)]} min={min * 100} max={100} step={5} disabled={disabled} onValueChange={([v]) => onChange(v / 100)} />
    </div>
  )
}

function Panel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

function Stepper({ value, onShift, small }: { value: number; onShift: (d: number) => void; small?: boolean }) {
  const size = small ? "xs" : "sm"
  return (
    <div className="flex items-center gap-1">
      <Button size={size} variant="secondary" onClick={() => onShift(-0.5)}>-0,5s</Button>
      <Button size={size} variant="secondary" onClick={() => onShift(-0.1)}>-0,1s</Button>
      <span className="w-12 text-center text-xs tabular-nums">{(value > 0 ? "+" : "") + value.toFixed(1).replace(".", ",")}s</span>
      <Button size={size} variant="secondary" onClick={() => onShift(0.1)}>+0,1s</Button>
      <Button size={size} variant="secondary" onClick={() => onShift(0.5)}>+0,5s</Button>
    </div>
  )
}

export default function Player({ songId }: { songId: string }) {
  const [song, setSong] = useState<Song | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const [engine] = useState(() => new AudioEngine())
  const [loaded, setLoaded] = useState(0) // faixas carregadas (0-4)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [seeking, setSeeking] = useState<number | null>(null)
  const [volume, setVolume] = useState(1)
  const [fs, setFs] = useState(false)
  const [showControls, setShowControls] = useState(false)
  const [armed, setArmed] = useState(false)
  const [picker, setPicker] = useState<{ open: boolean; tab: PickerTab }>({ open: false, tab: "lyrics" })
  const offsetRef = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const [glow, setGlow] = useState("transparent")

  const settings: Settings = { ...DEFAULTS, ...(song?.settings || {}) }
  offsetRef.current = song?.offset || 0

  // ------------------------------------------------------------ carregar
  useEffect(() => {
    let alive = true
    Promise.all([api<Song>(`/api/songs/${songId}`), api<Info>("/api/info")])
      .then(([s, i]) => {
        if (!alive) return
        setSong(s)
        setInfo(i)
        document.title = `${cleanTitle(s.title, s.artist)} · MicDrop`
        const pick = new URLSearchParams(location.search).get("pick") as PickerTab | null
        if (pick) setPicker({ open: true, tab: pick })
        else if (!s.lyrics) setPicker({ open: true, tab: "lyrics" })
        api(`/api/songs/${songId}/midi`, { method: "POST", body: {} }).catch(() => {})
      })
      .catch(e => setLoadError(e.message))
    engine
      .load(songId, n => alive && setLoaded(n))
      .then(() => alive && setReady(true))
      .catch(e => alive && setLoadError("Erro ao carregar o áudio: " + e.message))
    const unsub = engine.subscribe(() => setPlaying(engine.playing))
    return () => {
      alive = false
      unsub()
      engine.pause()
    }
  }, [engine, songId])

  // mixagem
  useEffect(() => {
    if (song) engine.setMix(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, song?.settings])

  // tempo na tela (4x por segundo) + fim da música + clipe sincronizado
  useEffect(() => {
    const id = setInterval(() => {
      engine.checkEnd()
      setPos(engine.position())
      const v = videoRef.current
      if (!v || !v.duration || v.hidden) return
      const target = engine.position() + (song?.settings?.video_offset || 0)
      if (target < 0 || target >= v.duration - 0.05) {
        if (!v.paused) v.pause()
        return
      }
      if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target
      if (engine.playing && v.paused) v.play().catch(() => {})
      if (!engine.playing && !v.paused) v.pause()
    }, 250)
    return () => clearInterval(id)
  }, [engine, song?.settings?.video_offset])

  // enquanto algo estiver sendo preparado (palavras, clipe), acompanha o servidor
  const busy =
    song?.video?.status === "downloading" || song?.lyrics?.align?.status === "queued" || song?.lyrics?.align?.status === "running"
  useEffect(() => {
    if (!busy) return
    const id = setInterval(async () => {
      try {
        const s = await api<Song>(`/api/songs/${songId}`)
        setSong(cur => {
          if (!cur) return s
          const next = { ...cur, lyrics: s.lyrics, video: s.video }
          if (cur.video?.status === "downloading" && s.video?.status === "ready") {
            next.settings = { ...cur.settings, bg: "video" }
            save({ settings: next.settings })
            toast.success("Clipe pronto!")
          }
          if (!wordsReady(cur) && wordsReady(s)) toast.success("Palavras sincronizadas!")
          return next
        })
      } catch {
        /* tenta de novo */
      }
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, songId])

  // brilho colorido em volta do quadro, com a cor média da capa
  useEffect(() => {
    if (!song) return
    const img = new window.Image()
    if (!song.cover) img.crossOrigin = "anonymous"
    img.onload = () => {
      try {
        const c = document.createElement("canvas")
        c.width = c.height = 8
        const g = c.getContext("2d")!
        g.drawImage(img, 0, 0, 8, 8)
        const d = g.getImageData(0, 0, 8, 8).data
        let r = 0, gr = 0, b = 0
        for (let i = 0; i < d.length; i += 4) {
          r += d[i]
          gr += d[i + 1]
          b += d[i + 2]
        }
        const n = d.length / 4
        setGlow(`rgba(${(r / n) | 0},${(gr / n) | 0},${(b / n) | 0},.5)`)
      } catch {
        /* imagem de outro site sem permissão */
      }
    }
    img.src = artUrl(song)
  }, [song?.cover, song?.cover_v]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ salvar ajustes
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pending = useRef<Partial<Song>>({})
  const save = useCallback(
    (changes: Partial<Song>) => {
      Object.assign(pending.current, changes)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        const body = pending.current
        pending.current = {}
        api(`/api/songs/${songId}`, { method: "PATCH", body }).catch(e => toast.error(e.message))
      }, 400)
    },
    [songId],
  )

  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSong(cur => {
      if (!cur) return cur
      const next = { ...cur, settings: { ...DEFAULTS, ...cur.settings, [key]: value } }
      save({ settings: next.settings })
      return next
    })
  }

  function setOffset(v: number) {
    const offset = Math.round(v * 100) / 100
    setSong(cur => (cur ? { ...cur, offset } : cur))
    save({ offset })
  }

  function setKey(key: string, scale: string) {
    setSong(cur => (cur ? { ...cur, key, scale } : cur))
    api(`/api/songs/${songId}`, { method: "PATCH", body: { key, scale } })
      .then(() => toast.success(`Tom: ${key} ${scale}`))
      .catch(e => toast.error(e.message))
  }

  // ------------------------------------------------------------ letra: clicar numa linha
  const onLineClick = useCallback(
    (i: number) => {
      const lines = song?.lyrics?.lines
      if (!song?.lyrics?.synced || !lines?.[i] || lines[i].t === null) return
      if (armed) {
        setOffset(engine.position() - (lines[i].t as number))
        setArmed(false)
        toast.success("Sincronia acertada")
        return
      }
      engine.seek((lines[i].t as number) + (song.offset || 0))
      engine.play()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [song?.lyrics, song?.offset, armed, engine],
  )

  // ------------------------------------------------------------ tela cheia
  const toggleFs = useCallback(() => {
    setFs(on => {
      const next = !on
      if (next) document.documentElement.requestFullscreen?.().catch(() => {})
      else if (document.fullscreenElement) document.exitFullscreen?.()
      return next
    })
  }, [])
  useEffect(() => {
    const onChange = () => !document.fullscreenElement && setFs(false)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])
  // controles aparecem com o mouse na parte de baixo (área = altura real dos controles + folga)
  useEffect(() => {
    if (!fs) return
    setShowControls(true)
    let t = setTimeout(() => setShowControls(false), 2500)
    const onMove = (e: MouseEvent) => {
      const zone = (controlsRef.current?.offsetHeight || 160) + 60
      clearTimeout(t)
      if (e.clientY >= window.innerHeight - zone) setShowControls(true)
      else t = setTimeout(() => setShowControls(false), 300)
    }
    document.addEventListener("mousemove", onMove)
    return () => {
      clearTimeout(t)
      document.removeEventListener("mousemove", onMove)
    }
  }, [fs])

  // atalhos
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [role=dialog]")) return
      if (e.code === "Space") {
        e.preventDefault()
        engine.toggle()
      } else if (e.key === "f" || e.key === "F") toggleFs()
      else if (e.key === "ArrowRight") engine.seek(engine.position() + 5)
      else if (e.key === "ArrowLeft") engine.seek(engine.position() - 5)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [engine, toggleFs])

  // ------------------------------------------------------------ tela
  if (loadError && !song) return <p className="p-8 text-destructive">{loadError}</p>
  if (!song) {
    return (
      <div className="grid h-screen place-items-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    )
  }

  const lyrics = song.lyrics
  const lines = lyrics?.lines || []
  const videoReady = song.video?.status === "ready" && !!song.video.file
  const useVideo = settings.bg === "video" && videoReady
  const align = lyrics?.align
  const aligning = align?.status === "queued" || align?.status === "running"
  const duration = engine.duration || song.duration
  const shown = seeking ?? pos
  const notes = info?.notes || ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  const scales = info ? (info.scales.includes(song.scale) ? info.scales : [...info.scales, song.scale]) : [song.scale]
  const openPicker = (tab: PickerTab) => setPicker({ open: true, tab })

  const transport = (
    <div className="flex items-center gap-3">
      <Button size="icon-lg" className="size-11 rounded-full" disabled={!ready} onClick={() => engine.toggle()} aria-label={playing ? "Pausar" : "Tocar"}>
        {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
      </Button>
      <span className="w-24 text-sm tabular-nums text-muted-foreground">
        {fmtTime(shown)} / {fmtTime(duration)}
      </span>
      <Slider
        className="flex-1"
        value={[duration ? (shown / duration) * 1000 : 0]}
        max={1000}
        step={1}
        disabled={!ready}
        onValueChange={([v]) => setSeeking((v / 1000) * duration)}
        onValueCommit={([v]) => {
          engine.seek((v / 1000) * duration)
          setSeeking(null)
        }}
        aria-label="Posição da música"
      />
      <Volume2 className="size-4 text-muted-foreground" />
      <Slider
        className="w-24"
        value={[Math.round(volume * 100)]}
        max={100}
        step={5}
        onValueChange={([v]) => {
          setVolume(v / 100)
          engine.setVolume(v / 100)
        }}
        aria-label="Volume geral"
      />
    </div>
  )

  const modeToggle = (
    <ToggleGroup
      type="single"
      variant="outline"
      value={settings.mode}
      onValueChange={v => v && setSetting("mode", v as Settings["mode"])}
      className="w-full"
    >
      <ToggleGroupItem value="instrumental" className="flex-1">Sem voz</ToggleGroupItem>
      <ToggleGroupItem value="original" className="flex-1">Original</ToggleGroupItem>
    </ToggleGroup>
  )

  return (
    <div className={cn("mx-auto max-w-5xl space-y-4 px-4 py-5", fs && "overflow-hidden")}>
      {/* topo */}
      <header className="flex items-center gap-3">
        <IconButton label="Voltar para a biblioteca" asChild variant="ghost">
          <a href="/">
            <ArrowLeft />
          </a>
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{cleanTitle(song.title, song.artist)}</h1>
          <p className="truncate text-sm text-muted-foreground">{song.artist || song.channel}</p>
        </div>
        <IconButton label="Trocar letra" variant="outline" onClick={() => openPicker("lyrics")}>
          <FileText />
        </IconButton>
        <IconButton label="Trocar capa" variant="outline" onClick={() => openPicker("cover")}>
          <Image />
        </IconButton>
        <IconButton label="Clipe de fundo" variant="outline" onClick={() => openPicker("clip")}>
          <Clapperboard />
        </IconButton>
        <IconButton label="Tela cheia (F)" onClick={toggleFs}>
          <Maximize />
        </IconButton>
      </header>

      {/* palco: fundo + letra */}
      <div
        className={cn(
          "relative overflow-hidden bg-black",
          fs ? "fixed inset-0 z-40" : "aspect-video max-h-[52vh] w-full rounded-2xl transition-shadow duration-700",
        )}
        style={fs ? undefined : { boxShadow: `0 0 40px ${glow}` }}
      >
        {!useVideo && (
          <div
            className="absolute -inset-10 bg-cover bg-center transition-[filter]"
            style={{ backgroundImage: `url("${artUrl(song)}")`, filter: `blur(${settings.blur * 40}px)` }}
          />
        )}
        <video
          ref={videoRef}
          hidden={!useVideo}
          src={videoReady ? `/media/${song.id}/${song.video!.file}?v=${song.video!.source}` : undefined}
          muted
          playsInline
          preload="auto"
          className="absolute -top-10 -left-10 h-[calc(100%+5rem)] w-[calc(100%+5rem)] object-cover transition-[filter]"
          style={{ filter: `blur(${settings.blur * 40}px)` }}
        />
        <div className="absolute inset-0 bg-black transition-opacity" style={{ opacity: 0.15 + settings.blur * 0.5 }} />

        {ready && lines.length > 0 && (
          <div style={{ ["--txt" as string]: settings.brightness }} className="absolute inset-0">
            <LyricsView
              lines={lines}
              synced={!!lyrics?.synced}
              engine={engine}
              offsetRef={offsetRef}
              armed={armed}
              big={fs}
              onLineClick={onLineClick}
            />
          </div>
        )}

        {!ready && (
          <div className="absolute inset-0 grid place-items-center text-center text-white">
            {loadError ? (
              <p className="text-destructive">{loadError}</p>
            ) : (
              <div className="space-y-2">
                <Loader2 className="mx-auto size-6 animate-spin" />
                <p className="text-sm">Carregando as faixas... {loaded}/4</p>
              </div>
            )}
          </div>
        )}
        {ready && !lines.length && (
          <div className="absolute inset-0 grid place-items-center text-center text-white">
            <div className="space-y-3">
              <p className="text-lg font-semibold">Esta música ainda não tem letra</p>
              <Button onClick={() => openPicker("lyrics")}>
                <FileText /> Escolher letra
              </Button>
            </div>
          </div>
        )}

        {/* controles da tela cheia */}
        {fs && (
          <div
            ref={controlsRef}
            className={cn(
              "absolute inset-x-0 bottom-0 z-50 space-y-3 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-6 pt-12 pb-5 transition-all duration-300",
              showControls ? "translate-y-0 opacity-100" : "translate-y-full opacity-0",
            )}
          >
            <div className="mx-auto max-w-5xl space-y-3">
              {transport}
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
                <div className="w-44">{modeToggle}</div>
                <div className="w-40">
                  <SliderRow label="Vocais de apoio" value={settings.backing} onChange={v => setSetting("backing", v)} disabled={settings.mode === "original"} />
                </div>
                <div className="w-40">
                  <SliderRow label="Voz do cantor" value={settings.lead} onChange={v => setSetting("lead", v)} disabled={settings.mode === "original"} />
                </div>
                <Stepper small value={song.offset || 0} onShift={d => setOffset((song.offset || 0) + d)} />
                <Button variant="secondary" onClick={toggleFs}>
                  <Minimize /> Sair da tela cheia
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* barra de reprodução */}
      <Card size="sm" className="px-4 py-3">
        {transport}
      </Card>

      {/* ajustes */}
      <div className="grid gap-4 md:grid-cols-3">
        <Panel icon={<Mic2 className="size-4 text-primary" />} title="Vozes">
          {modeToggle}
          <SliderRow label="Vocais de apoio" value={settings.backing} onChange={v => setSetting("backing", v)} disabled={settings.mode === "original"} />
          <SliderRow label="Voz do cantor" value={settings.lead} onChange={v => setSetting("lead", v)} disabled={settings.mode === "original"} />
        </Panel>

        <Panel icon={<Monitor className="size-4 text-primary" />} title="Tela">
          <ToggleGroup
            type="single"
            variant="outline"
            value={useVideo ? "video" : "cover"}
            onValueChange={v => {
              if (!v) return
              if (v === "video" && !videoReady) return openPicker("clip")
              setSetting("bg", v as Settings["bg"])
            }}
            className="w-full"
          >
            <ToggleGroupItem value="cover" className="flex-1">
              <Image /> Capa
            </ToggleGroupItem>
            <ToggleGroupItem value="video" className="flex-1">
              <Clapperboard /> Clipe
            </ToggleGroupItem>
          </ToggleGroup>
          <SliderRow label="Desfoque do fundo" value={settings.blur} onChange={v => setSetting("blur", v)} />
          <SliderRow label="Brilho do texto" value={settings.brightness} min={0.2} onChange={v => setSetting("brightness", v)} />
          {useVideo && (
            <div className="space-y-2">
              <Label>Atraso do clipe</Label>
              <Stepper value={settings.video_offset} onShift={d => setSetting("video_offset", Math.round((settings.video_offset + d) * 100) / 100)} />
            </div>
          )}
        </Panel>

        <Panel icon={<Music className="size-4 text-primary" />} title="Tom e sincronia">
          <div className="space-y-2">
            <Label>Tom (vai para o Auto-Tune)</Label>
            <div className="flex gap-2">
              <Select value={song.key} onValueChange={k => setKey(k, song.scale)}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {notes.map(n => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={song.scale} onValueChange={sc => setKey(song.key, sc)}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scales.map(sc => (
                    <SelectItem key={sc} value={sc}>
                      {sc === "Major" ? "Maior" : sc === "Minor" ? "Menor" : sc === "Chromatic" ? "Cromática" : sc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {lyrics?.synced && (
            <div className="space-y-2">
              <Label>Sincronia da letra</Label>
              <Stepper value={song.offset || 0} onShift={d => setOffset((song.offset || 0) + d)} />
              <Button variant={armed ? "default" : "outline"} size="sm" className="w-full" onClick={() => setArmed(a => !a)}>
                <Crosshair /> {armed ? "Agora clique na linha quando ela começar" : "Acertar com o mouse"}
              </Button>
            </div>
          )}

          {lyrics?.synced && (aligning || !wordsReady(song)) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Type className="size-3.5" />
              {aligning ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" /> {align?.stage || "Sincronizando palavras..."} {Math.round((align?.progress || 0) * 100)}%
                </span>
              ) : (
                <>
                  <span className="flex-1">{align?.status === "error" ? "Erro ao sincronizar as palavras" : "Palavras estimadas"}</span>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() =>
                      api<Song>(`/api/songs/${songId}/words`, { method: "POST", body: {} })
                        .then(s => setSong(cur => (cur ? { ...cur, lyrics: s.lyrics } : s)))
                        .catch(e => toast.error(e.message))
                    }
                  >
                    Sincronizar palavras
                  </Button>
                </>
              )}
            </div>
          )}
        </Panel>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Espaço: tocar/pausar · F: tela cheia · ← →: 5 segundos · Clique numa linha para pular até ela
      </p>

      <Pickers
        song={song}
        open={picker.open}
        tab={picker.tab}
        onOpenChange={open => setPicker(p => ({ ...p, open }))}
        onTabChange={tab => setPicker(p => ({ ...p, tab }))}
        onSong={s => setSong(cur => (cur ? { ...s, settings: { ...cur.settings, ...s.settings } } : s))}
      />
    </div>
  )
}

function artUrl(s: Song) {
  return s.cover ? `/media/${s.id}/cover.jpg?v=${s.cover_v || 0}` : `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`
}
