import { Check, ListMusic, Loader2, Plus, Search, Sparkles } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { PreviewButton, Thumb } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { api, fmtTime, searchApi } from "@/lib/api"
import { stopPreview } from "@/lib/preview"
import type { SearchResponse, SearchResult } from "@/lib/types"

type Props = { getName?: () => string; onAdded?: () => void; compact?: boolean }

const keyOf = (it: SearchResult) => it.id || `sp-${it.spotify?.id}`

function previewSrc(it: SearchResult) {
  if (it.id) return `/api/preview/${it.id}`
  if (it.preview) return `/api/preview_spotify?u=${encodeURIComponent(it.preview)}`
  return null
}

function SourceBadge({ source }: { source: SearchResponse["source"] }) {
  return source === "spotify" ? (
    <Badge className="border-transparent bg-[#1db954]/15 text-[#1ed760]">Spotify</Badge>
  ) : (
    <Badge className="border-transparent bg-red-500/15 text-red-400">YouTube</Badge>
  )
}

export function SearchPanel({ getName, onAdded, compact }: Props) {
  const [q, setQ] = useState("")
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<SearchResponse | null>(null)
  const [added, setAdded] = useState<Record<string, "adding" | "done">>({})
  const [bulk, setBulk] = useState<"idle" | "adding" | "done">("idle")

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    stopPreview()
    setLoading(true)
    setRes(null)
    setBulk("idle")
    try {
      setRes(await searchApi(q.trim()))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function add(item: SearchResult) {
    const k = keyOf(item)
    setAdded(a => ({ ...a, [k]: "adding" }))
    try {
      await api("/api/queue", { method: "POST", body: { entry: item, name: getName?.() || "" } })
      setAdded(a => ({ ...a, [k]: "done" }))
      setQ("") // pronto para a próxima busca (os resultados continuam na tela)
      stopPreview()
      toast.success("Música na fila!", { description: "A letra, o clipe e a sincronia vêm sozinhos." })
      onAdded?.()
    } catch (err) {
      setAdded(a => {
        const { [k]: _, ...rest } = a
        return rest
      })
      toast.error((err as Error).message)
    }
  }

  async function addAll() {
    if (!res) return
    const todo = res.items.filter(it => !added[keyOf(it)] && !it.duplicate) // duplicatas ficam de fora
    setBulk("adding")
    stopPreview()
    try {
      const r = await api<{ added: number; skipped: number }>("/api/queue/bulk", {
        method: "POST",
        body: { entries: todo, name: getName?.() || "" },
      })
      setAdded(a => ({ ...a, ...Object.fromEntries(todo.map(it => [keyOf(it), "done" as const])) }))
      setBulk("done")
      setQ("")
      toast.success(`${r.added} ${r.added === 1 ? "música adicionada" : "músicas adicionadas"} à fila`, {
        description: r.skipped ? `${r.skipped} já estavam na biblioteca ou na fila.` : "Elas vão sendo preparadas uma de cada vez.",
      })
      onAdded?.()
    } catch (err) {
      setBulk("idle")
      toast.error((err as Error).message)
    }
  }

  // "dup" = a mesma música (artista + nome) já está na biblioteca ou na fila
  const stateOf = (k: string, item: SearchResult): "adding" | "done" | "dup" | undefined =>
    added[k] || (item.duplicate ? "dup" : undefined)
  const items = res?.items || []
  const dupes = items.filter(it => it.duplicate).length
  const isPlaylist = res?.kind === "playlist"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" /> Adicionar música
        </CardTitle>
        {!compact && (
          <CardDescription>
            Busque pelo nome ou cole um link do YouTube ou do Spotify (música, playlist ou álbum). A letra, o clipe e a
            sincronia das palavras vêm automaticamente.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={search} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Música, artista ou link (YouTube/Spotify)"
              className="h-10 pl-8"
              autoComplete="off"
            />
          </div>
          <Button type="submit" size="lg" className="h-10 px-4" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Search />}
            Buscar
          </Button>
        </form>

        {loading && (
          <div className="animate-fade-in space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-12 w-20 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {res && items.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nada encontrado. Tente outro nome.</p>}

        {/* cabeçalho da playlist / álbum */}
        {res && isPlaylist && items.length > 0 && (
          <div className="flex animate-fade-in-up items-center gap-3 rounded-xl bg-muted/50 p-3">
            {res.cover ? (
              <Thumb src={res.cover} className="size-16" />
            ) : (
              <div className="grid size-16 place-items-center rounded-md bg-muted">
                <ListMusic className="size-6 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SourceBadge source={res.source} />
                <span className="text-xs text-muted-foreground">
                  {items.length} {items.length === 1 ? "música" : "músicas"}
                  {dupes > 0 && ` · ${dupes} já ${dupes === 1 ? "está" : "estão"} na biblioteca ou na fila`}
                </span>
              </div>
              <p className="mt-1 truncate font-semibold">{res.title}</p>
              {res.truncated && (
                <p className="text-xs text-muted-foreground">O Spotify mostra só as primeiras 100 faixas de cada playlist.</p>
              )}
            </div>
            <Button onClick={addAll} disabled={bulk !== "idle" || items.length === dupes} variant={bulk === "done" ? "secondary" : "default"}>
              {bulk === "adding" ? <Loader2 className="animate-spin" /> : bulk === "done" ? <Check /> : <Plus />}
              {bulk === "done" ? "Na fila" : items.length - dupes === items.length ? "Adicionar todas" : `Adicionar ${items.length - dupes}`}
            </Button>
          </div>
        )}

        {items.length > 0 && (
          <ul className={isPlaylist ? "max-h-[28rem] divide-y divide-border overflow-y-auto pr-1" : "divide-y divide-border"}>
            {items.map((item, i) => {
              const k = keyOf(item)
              const state = stateOf(k, item)
              const src = previewSrc(item)
              return (
                <li
                  key={k}
                  className="flex animate-fade-in-up items-center gap-3 py-2"
                  style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                >
                  {isPlaylist && <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>}
                  {item.thumbnail ? (
                    <Thumb src={item.thumbnail} className={item.spotify ? "size-12" : "aspect-video w-20 sm:w-24"} />
                  ) : (
                    <div className="grid size-12 shrink-0 place-items-center rounded-md bg-muted">
                      <ListMusic className="size-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-snug" title={item.title}>
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.channel} · {fmtTime(item.duration)}
                    </p>
                  </div>
                  {src && <PreviewButton id={`res-${k}`} src={src} />}
                  <Button onClick={() => add(item)} disabled={!!state} variant={state === "done" || state === "dup" ? "secondary" : "default"} title={state === "dup" ? "Essa música já existe (mesmo artista e nome)" : undefined}>
                    {state === "adding" ? <Loader2 className="animate-spin" /> : state === "done" || state === "dup" ? <Check /> : <Plus />}
                    <span className="hidden sm:inline">
                      {state === "dup" ? (item.duplicate === "fila" ? "Já na fila" : "Já na biblioteca") : state === "done" ? "Na fila" : "Adicionar"}
                    </span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
