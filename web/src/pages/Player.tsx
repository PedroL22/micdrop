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
  Wand2,
  Pencil,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { IconButton } from "@/components/common"
import { RenameDialog } from "@/components/RenameDialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, cleanTitle, fmtTime, pct, wordsReady } from "@/lib/api"
import type { Info, Settings, Song } from "@/lib/types"
import { applyTheme, glowColor, themeFromImage, type Theme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { goBack } from "@/lib/router"
import { AudioEngine } from "@/player/engine"
import { LyricsView } from "@/player/LyricsView"
import { Pickers, type PickerTab } from "@/player/Pickers"

const DEFAULTS: Settings = { mode: "instrumental", backing: 1, lead: 0, blur: 0.5, brightness: 0.85, bg: "video", video_offset: 0 }

// Ajustes que valem para todas as músicas (guardados no servidor)
type Prefs = Omit<Settings, "video_offset"> & { volume: number; translate: boolean }
const PREF_KEYS = ["mode", "backing", "lead", "blur", "brightness", "bg"] as const

// idioma do navegador para a tradução ("pt-BR" -> "pt"; chinês mantém a variante)
const BROWSER_LANG = (() => {
  const l = (navigator.language || "pt").toLowerCase()
  return l.startsWith("zh") ? l.replace(/^zh-(hans|cn|sg).*/, "zh-CN").replace(/^zh-(hant|tw|hk).*/, "zh-TW") : l.split("-")[0]
})()
const LANG_NAME = (() => {
  try {
    const n = new Intl.DisplayNames([navigator.language || "pt-BR"], { type: "language" }).of(BROWSER_LANG) || BROWSER_LANG
    return n.charAt(0).toUpperCase() + n.slice(1)
  } catch {
    return BROWSER_LANG
  }
})()

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
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULTS, volume: 1, translate: true })
  const [translations, setTranslations] = useState<(string | null)[] | null>(null)
  const [fs, setFs] = useState(false)
  const [showControls, setShowControls] = useState(false)
  const [armed, setArmed] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [picker, setPicker] = useState<{ open: boolean; tab: PickerTab }>({ open: false, tab: "lyrics" })
  const offsetRef = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const [theme, setTheme] = useState<Theme | null>(null)

  // preferências gerais + o que é só desta música (atraso do clipe)
  const settings: Settings = {
    ...DEFAULTS,
    ...prefs,
    video_offset: song?.settings?.video_offset || 0,
    clip_off: !!song?.settings?.clip_off,
  }
  offsetRef.current = song?.offset || 0

  // ------------------------------------------------------------ carregar
  useEffect(() => {
    let alive = true
    Promise.all([api<Song>(`/api/songs/${songId}`), api<Info>("/api/info"), api<Prefs>("/api/prefs")])
      .then(([s, i, p]) => {
        if (!alive) return
        setSong(s)
        setInfo(i)
        setPrefs(p)
        engine.setVolume(p.volume ?? 1)
        document.title = `${cleanTitle(s.title, s.artist)} · Karaoke`
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
  // no modo de desenvolvimento o React desmonta e monta de novo: só fecha se não voltou
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      setTimeout(() => !mounted.current && engine.close(), 500)
    }
  }, [engine])

  // tradução da letra no idioma do navegador
  const lyricsSource = song?.lyrics?.source
  useEffect(() => {
    setTranslations(null)
    if (!lyricsSource || !prefs.translate) return
    let alive = true
    api<{ lines: (string | null)[] | null }>(`/api/songs/${songId}/translation?lang=${BROWSER_LANG}`)
      .then(r => alive && setTranslations(r.lines))
      .catch(() => {}) // sem tradução: a letra continua normal
    return () => {
      alive = false
    }
  }, [songId, lyricsSource, prefs.translate])

  // mixagem
  useEffect(() => {
    engine.setMix(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, prefs.mode, prefs.backing, prefs.lead])

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
    song?.video?.status === "downloading" ||
    song?.video?.sync === "running" ||
    song?.lyrics?.align?.status === "queued" ||
    song?.lyrics?.align?.status === "running"
  useEffect(() => {
    if (!busy) return
    const id = setInterval(async () => {
      try {
        const s = await api<Song>(`/api/songs/${songId}`)
        setSong(cur => {
          if (!cur) return s
          const next = { ...cur, lyrics: s.lyrics, video: s.video }
          if (cur.video?.sync === "running" && s.video?.sync && s.video.sync !== "running") {
            next.settings = { ...cur.settings, video_offset: s.settings?.video_offset || 0 }
            if (s.video.sync === "done") toast.success("Clipe sincronizado", { description: offsetLabel(s.settings?.video_offset || 0) })
            else toast.error("Não deu para sincronizar o clipe", { description: s.video.sync_error || undefined })
          }
          if (cur.video?.status === "downloading" && s.video?.status === "ready") toast.success("Clipe pronto!")
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

  // cor do tema a partir da capa (ou do clipe), usada no app todo enquanto o player está aberto
  const artKey = song ? `${song.cover_v || 0}-${song.video?.status === "ready" ? song.video.source : ""}` : ""
  useEffect(() => {
    if (!song) return
    let alive = true
    themeFromImage(`/api/art/${song.id}?v=${artKey}`)
      .then(t => {
        if (!alive) return
        setTheme(t)
        applyTheme(t)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [artKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => applyTheme(null), [])

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

  // preferências gerais: salvas no servidor e usadas em todas as músicas
  const prefTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const prefPending = useRef<Partial<Prefs>>({})
  function setPref(changes: Partial<Prefs>) {
    setPrefs(cur => ({ ...cur, ...changes }))
    Object.assign(prefPending.current, changes)
    clearTimeout(prefTimer.current)
    prefTimer.current = setTimeout(() => {
      const body = prefPending.current
      prefPending.current = {}
      api("/api/prefs", { method: "PATCH", body }).catch(e => toast.error(e.message))
    }, 400)
  }

  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    if ((PREF_KEYS as readonly string[]).includes(key)) return setPref({ [key]: value } as Partial<Prefs>)
    // o resto (atraso do clipe) é desta música
    setSong(cur => {
      if (!cur) return cur
      const next = { ...cur, settings: { ...cur.settings, [key]: value } }
      save({ settings: { [key]: value } as unknown as Settings })
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
  const useVideo = settings.bg === "video" && videoReady && !settings.clip_off
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
        value={[Math.round(prefs.volume * 100)]}
        max={100}
        step={5}
        onValueChange={([v]) => {
          setPref({ volume: v / 100 })
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
    <div className={cn("mx-auto max-w-5xl animate-fade-in space-y-4 px-4 py-5", fs && "overflow-hidden")}>
      {/* topo */}
      <header className="flex items-center gap-3">
        <IconButton label="Voltar para a biblioteca" variant="ghost" onClick={() => goBack("/")}>
          <ArrowLeft />
        </IconButton>
        <div className="group/title flex min-w-0 flex-1 items-center gap-1">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{cleanTitle(song.title, song.artist)}</h1>
            <p className="truncate text-sm text-muted-foreground">{song.artist || song.channel}</p>
          </div>
          <IconButton
            label="Renomear"
            size="icon-sm"
            className="opacity-0 transition-opacity group-hover/title:opacity-100 focus-visible:opacity-100"
            onClick={() => setRenaming(true)}
          >
            <Pencil />
          </IconButton>
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
        style={
          fs
            ? undefined
            : ({ boxShadow: `0 0 48px ${glowColor(theme)}`, viewTransitionName: `art-${song.id}`, viewTransitionClass: "art" } as React.CSSProperties)
        }
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
              translations={prefs.translate ? translations : null}
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
      <div className="grid gap-4 md:grid-cols-3 [&>*]:animate-fade-in-up [&>*:nth-child(2)]:[animation-delay:60ms] [&>*:nth-child(3)]:[animation-delay:120ms]">
        <Panel icon={<Mic2 className="size-4 text-primary" />} title="Vozes">
          {modeToggle}
          <SliderRow label="Vocais de apoio" value={settings.backing} onChange={v => setSetting("backing", v)} disabled={settings.mode === "original"} />
          <SliderRow label="Voz do cantor" value={settings.lead} onChange={v => setSetting("lead", v)} disabled={settings.mode === "original"} />
        </Panel>

        <Panel icon={<Monitor className="size-4 text-primary" />} title="Tela">
          <ToggleGroup
            type="single"
            variant="outline"
            value={settings.bg}
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
          {lyrics && (
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Tradução ({LANG_NAME})
                <span className="block text-xs text-muted-foreground">Pequena, embaixo de cada verso</span>
              </span>
              <Switch checked={prefs.translate} onCheckedChange={on => setPref({ translate: on })} />
            </label>
          )}
          {videoReady && settings.bg === "video" && (
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Clipe nesta música
                <span className="block text-xs text-muted-foreground">Desligue se o clipe não combinar com a música</span>
              </span>
              <Switch checked={!settings.clip_off} onCheckedChange={on => setSetting("clip_off", !on)} />
            </label>
          )}
          {useVideo && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Atraso do clipe</Label>
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={song.video?.sync === "running"}
                  onClick={() =>
                    api<Song>(`/api/songs/${songId}/video/sync`, { method: "POST", body: {} })
                      .then(s => setSong(cur => (cur ? { ...cur, video: s.video } : s)))
                      .catch(e => toast.error(e.message))
                  }
                >
                  {song.video?.sync === "running" ? <Loader2 className="animate-spin" /> : <Wand2 />}
                  {song.video?.sync === "running" ? "Sincronizando..." : "Sincronizar sozinho"}
                </Button>
              </div>
              <Stepper value={settings.video_offset} onShift={d => setSetting("video_offset", Math.round((settings.video_offset + d) * 100) / 100)} />
              <p className="text-xs text-muted-foreground">{offsetLabel(settings.video_offset)}</p>
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

      <RenameDialog
        song={song}
        open={renaming}
        onOpenChange={setRenaming}
        onSaved={s => setSong(cur => (cur ? { ...cur, title: s.title, artist: s.artist } : s))}
      />
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

// capa escolhida > miniatura do clipe > miniatura do vídeo (servida pelo nosso servidor)
function offsetLabel(v: number) {
  const s = Math.abs(v).toFixed(1).replace(".", ",")
  if (Math.abs(v) < 0.05) return "O clipe começa junto com a música."
  return v > 0 ? `Pulando os primeiros ${s} s do clipe (introdução).` : `O clipe começa ${s} s depois da música.`
}

function artUrl(s: Song) {
  return `/api/art/${s.id}?v=${s.cover_v || 0}-${s.video?.status === "ready" ? s.video.source : ""}`
}
