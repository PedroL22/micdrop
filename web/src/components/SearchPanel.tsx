import { Check, Loader2, Plus, Search, Sparkles } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { PreviewButton, Thumb } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { api, fmtTime } from "@/lib/api"
import { stopPreview } from "@/lib/preview"
import type { SearchResult } from "@/lib/types"

type Props = { getName?: () => string; onAdded?: () => void; compact?: boolean }

export function SearchPanel({ getName, onAdded, compact }: Props) {
  const [q, setQ] = useState("")
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [added, setAdded] = useState<Record<string, "adding" | "done">>({})

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    stopPreview()
    setLoading(true)
    setResults(null)
    try {
      setResults(await api<SearchResult[]>("/api/search?q=" + encodeURIComponent(q.trim())))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function add(item: SearchResult) {
    setAdded(a => ({ ...a, [item.id]: "adding" }))
    try {
      await api("/api/queue", { method: "POST", body: { entry: item, name: getName?.() || "" } })
      setAdded(a => ({ ...a, [item.id]: "done" }))
      stopPreview()
      toast.success("Música na fila!", { description: "A letra, o clipe e a sincronia vêm sozinhos." })
      onAdded?.()
    } catch (err) {
      setAdded(a => {
        const { [item.id]: _, ...rest } = a
        return rest
      })
      toast.error((err as Error).message)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" /> Adicionar música
        </CardTitle>
        {!compact && (
          <CardDescription>
            Busque pelo nome ou cole um link do YouTube. A letra, o clipe e a sincronia das palavras vêm automaticamente.
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
              placeholder="Artista, música ou link do YouTube"
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
          <div className="space-y-2">
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

        {results && results.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">Nada encontrado. Tente outro nome.</p>
        )}

        {results && results.length > 0 && (
          <ul className="divide-y divide-border">
            {results.map(item => {
              const state = added[item.id]
              return (
                <li key={item.id} className="flex items-center gap-3 py-2">
                  <Thumb src={item.thumbnail} className="aspect-video w-20 sm:w-24" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-snug" title={item.title}>
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.channel} · {fmtTime(item.duration)}
                    </p>
                  </div>
                  <PreviewButton id={`yt-${item.id}`} src={`/api/preview/${item.id}`} />
                  <Button onClick={() => add(item)} disabled={!!state} variant={state === "done" ? "secondary" : "default"}>
                    {state === "adding" ? <Loader2 className="animate-spin" /> : state === "done" ? <Check /> : <Plus />}
                    <span className="hidden sm:inline">{state === "done" ? "Na fila" : "Adicionar"}</span>
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
