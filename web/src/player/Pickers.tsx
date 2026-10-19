import { Check, Clapperboard, FileText, Image, Loader2, RotateCcw, Search, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Thumb } from "@/components/common"
import { ImageThumbnail } from "@/components/ImageThumbnail"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, cleanTitle, fmtTime } from "@/lib/api"
import type { CoverResult, LyricsResult, SearchResult, Song } from "@/lib/types"

export type PickerTab = "lyrics" | "cover" | "clip"

type Props = {
  song: Song
  open: boolean
  tab: PickerTab
  onOpenChange: (open: boolean) => void
  onTabChange: (tab: PickerTab) => void
  onSong: (s: Song) => void
}

function baseQuery(song: Song) {
  return `${song.artist || ""} ${cleanTitle(song.title, song.artist)}`.replace(/\s+/g, " ").trim()
}

/** Gaveta lateral para trocar a letra, a capa ou o clipe de fundo. */
export function Pickers({ song, open, tab, onOpenChange, onTabChange, onSong }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Personalizar</SheetTitle>
          <SheetDescription>{cleanTitle(song.title, song.artist)}</SheetDescription>
        </SheetHeader>
        <Tabs value={tab} onValueChange={v => onTabChange(v as PickerTab)} className="min-h-0 flex-1 px-4 pb-4">
          <TabsList className="w-full">
            <TabsTrigger value="lyrics">
              <FileText /> Letra
            </TabsTrigger>
            <TabsTrigger value="cover">
              <Image /> Capa
            </TabsTrigger>
            <TabsTrigger value="clip">
              <Clapperboard /> Clipe
            </TabsTrigger>
          </TabsList>
          <TabsContent value="lyrics" className="min-h-0 flex-1">
            <LyricsTab song={song} onSong={onSong} />
          </TabsContent>
          <TabsContent value="cover" className="min-h-0 flex-1">
            <CoverTab song={song} onSong={onSong} />
          </TabsContent>
          <TabsContent value="clip" className="min-h-0 flex-1">
            <ClipTab song={song} onSong={onSong} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

/** Busca + lista com rolagem, usada nas três abas. */
function useSearch<T>(initial: string, run: (q: string) => Promise<T[]>) {
  const [q, setQ] = useState(initial)
  const [items, setItems] = useState<T[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const go = async (query = q) => {
    if (!query.trim()) return
    setLoading(true)
    setError("")
    try {
      setItems(await run(query.trim()))
    } catch (e) {
      setError((e as Error).message)
      setItems(null)
    } finally {
      setLoading(false)
    }
  }
  const started = useRef(false)
  useEffect(() => {
    if (!started.current) {
      started.current = true
      go(initial)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { q, setQ, items, loading, error, go }
}

function SearchBox({ q, setQ, go, loading, placeholder }: { q: string; setQ: (v: string) => void; go: () => void; loading: boolean; placeholder: string }) {
  return (
    <form
      className="flex gap-2"
      onSubmit={e => {
        e.preventDefault()
        go()
      }}
    >
      <Input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} />
      <Button type="submit" variant="secondary" disabled={loading}>
        {loading ? <Loader2 className="animate-spin" /> : <Search />}
      </Button>
    </form>
  )
}

function Loading() {
  return (
    <div className="space-y-2 pt-3">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

function ErrorBox({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <p>{message}</p>
      <Button size="sm" variant="secondary" onClick={retry}>
        <RotateCcw /> Tentar de novo
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------- letra

function LyricsTab({ song, onSong }: { song: Song; onSong: (s: Song) => void }) {
  const s = useSearch<LyricsResult>(baseQuery(song), q => api<LyricsResult[]>("/api/lyrics/search?q=" + encodeURIComponent(q)))
  const [using, setUsing] = useState<number | null>(null)
  const dur = song.duration
  const items = (s.items || []).slice().sort(
    (a, b) => Number(b.synced) - Number(a.synced) || Math.abs(a.duration - dur) - Math.abs(b.duration - dur),
  )

  async function use(it: LyricsResult) {
    setUsing(it.id)
    try {
      onSong(await api<Song>(`/api/songs/${song.id}/lyrics`, { method: "POST", body: { id: it.id } }))
      toast.success("Letra aplicada", { description: it.synced ? "Sincronizando as palavras..." : undefined })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUsing(null)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 pt-2">
      <SearchBox {...s} go={() => s.go()} placeholder="Artista e música" />
      {s.loading && <Loading />}
      {s.error && <ErrorBox message={s.error} retry={() => s.go()} />}
      {!s.loading && s.items?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma letra encontrada. Tente mudar a busca.</p>}
      <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
        <ul className="space-y-1.5">
          {items.map(it => {
            const close = Math.abs(it.duration - dur) <= 3
            const current = song.lyrics?.source?.startsWith(`lrclib:${it.id}:`)
            return (
              <li key={it.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.track}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {it.artist} · {fmtTime(it.duration)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant={it.synced ? "secondary" : "outline"}>{it.synced ? "Sincronizada" : "Só texto"}</Badge>
                    {close && <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">Duração bate</Badge>}
                  </div>
                </div>
                <Button size="sm" variant={current ? "secondary" : "default"} disabled={current || using !== null} onClick={() => use(it)}>
                  {using === it.id ? <Loader2 className="animate-spin" /> : current ? <Check /> : null}
                  {current ? "Em uso" : "Usar"}
                </Button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- capa

function CoverTab({ song, onSong }: { song: Song; onSong: (s: Song) => void }) {
  const s = useSearch<CoverResult>(baseQuery(song), q => api<CoverResult[]>("/api/covers/search?q=" + encodeURIComponent(q)))
  const [using, setUsing] = useState("")

  async function use(it: CoverResult) {
    setUsing(it.full)
    try {
      onSong(await api<Song>(`/api/songs/${song.id}/cover`, { method: "POST", body: { url: it.full } }))
      toast.success("Capa trocada")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUsing("")
    }
  }
  async function remove() {
    try {
      onSong(await api<Song>(`/api/songs/${song.id}/cover`, { method: "DELETE" }))
      toast.success("Capa removida")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const current = song.cover ? `/media/${song.id}/cover.jpg?v=${song.cover_v || 0}` : `https://i.ytimg.com/vi/${song.id}/hqdefault.jpg`

  return (
    <div className="flex h-full flex-col gap-3 pt-2">
      <div className="flex items-center gap-3 rounded-lg bg-muted/60 p-3">
        <img src={current} alt="Capa atual" className="size-16 shrink-0 rounded-md object-cover ring-2 ring-primary" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Capa em uso</p>
          <p className="text-xs text-muted-foreground">
            {song.cover ? "Escolhida por você." : "Nenhuma escolhida: usando a imagem do YouTube."} Aparece de fundo quando não há
            clipe e na biblioteca.
          </p>
        </div>
        {song.cover && (
          <Button size="sm" variant="ghost" onClick={remove}>
            <Trash2 /> Remover
          </Button>
        )}
      </div>
      <SearchBox {...s} go={() => s.go()} placeholder="Artista e álbum" />
      {s.loading && <Loading />}
      {s.error && <ErrorBox message={s.error} retry={() => s.go()} />}
      <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
        <div className="grid grid-cols-3 gap-2">
          {(s.items || []).map(it => {
            const inUse = !!song.cover && song.cover_url === it.full
            return (
              <button
                key={it.full}
                type="button"
                title={`${it.artist || ""} — ${it.album || ""}${inUse ? " (em uso)" : ""}`}
                onClick={() => !inUse && use(it)}
                aria-pressed={inUse}
                className={`relative overflow-hidden rounded-md ring-primary transition hover:ring-2 focus-visible:ring-2 ${inUse ? "ring-3" : ""}`}
              >
                <ImageThumbnail src={it.thumb} containerClassName="aspect-square w-full" />
                {inUse && (
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-primary py-0.5 text-[11px] font-semibold text-primary-foreground">
                    <Check className="size-3" /> Em uso
                  </span>
                )}
                {using === it.full && (
                  <span className="absolute inset-0 grid place-items-center bg-black/60">
                    <Loader2 className="size-5 animate-spin" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- clipe

function ClipTab({ song, onSong }: { song: Song; onSong: (s: Song) => void }) {
  const s = useSearch<SearchResult>(`${baseQuery(song)} clipe oficial`, q =>
    api<SearchResult[]>("/api/search?q=" + encodeURIComponent(q)),
  )
  const v = song.video

  async function use(videoId: string) {
    try {
      onSong(await api<Song>(`/api/songs/${song.id}/video`, { method: "POST", body: { video_id: videoId } }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  async function remove() {
    try {
      onSong(await api<Song>(`/api/songs/${song.id}/video`, { method: "DELETE" }))
      toast.success("Clipe removido")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 pt-2">
      <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
        {!v && <p className="text-muted-foreground">Nenhum clipe de fundo.</p>}
        {v?.status === "downloading" && (
          <>
            <p className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Baixando o clipe... {Math.round((v.progress || 0) * 100)}%
            </p>
            <Progress value={(v.progress || 0) * 100} />
          </>
        )}
        {v?.status === "ready" && (
          <p className="flex items-center gap-2">
            <Check className="size-4 text-emerald-400" /> <span className="truncate">{v.title || v.source}</span>
          </p>
        )}
        {v?.status === "ready" && v.sync === "running" && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Achando onde a música começa no clipe...
          </p>
        )}
        {v?.status === "ready" && v.sync === "error" && (
          <p className="text-xs text-muted-foreground">
            Não deu para sincronizar sozinho ({v.sync_error || "som diferente"}). Ajuste o atraso no painel Tela ou desligue o clipe nesta música.
          </p>
        )}
        {v?.status === "error" && <p className="text-destructive">Erro ao baixar o clipe: {v.error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => use(song.id)} disabled={v?.status === "downloading"}>
            Usar o vídeo desta música
          </Button>
          {v && (
            <Button size="sm" variant="ghost" onClick={remove}>
              <Trash2 /> Remover
            </Button>
          )}
        </div>
      </div>
      <SearchBox {...s} go={() => s.go()} placeholder="Buscar outro vídeo no YouTube" />
      {s.loading && <Loading />}
      {s.error && <ErrorBox message={s.error} retry={() => s.go()} />}
      <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
        <ul className="space-y-1.5">
          {(s.items || []).map(it => (
            <li key={it.id} className="flex items-center gap-3 rounded-lg border p-2">
              <Thumb src={it.thumbnail} className="aspect-video w-24" />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium leading-snug">{it.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {it.channel} · {fmtTime(it.duration)}
                </p>
              </div>
              <Button
                size="sm"
                variant={v?.source === it.id ? "secondary" : "default"}
                disabled={v?.status === "downloading" || (v?.source === it.id && v.status === "ready")}
                onClick={() => use(it.id)}
              >
                {v?.source === it.id && v.status === "ready" ? "Em uso" : "Usar"}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
