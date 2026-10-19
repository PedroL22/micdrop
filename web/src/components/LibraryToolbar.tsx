import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, List, Search } from "lucide-react"
import { useState } from "react"

import { IconButton } from "@/components/common"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { songTitle } from "@/lib/api"
import type { Song } from "@/lib/types"

export type View = "grid" | "list"
export type SortKey = "created" | "title" | "artist" | "duration" | "key"
export type Prefs = { view: View; sort: SortKey; desc: boolean }

const SORTS: { value: SortKey; label: string; desc: boolean }[] = [
  { value: "created", label: "Data de adição", desc: true },
  { value: "title", label: "Título", desc: false },
  { value: "artist", label: "Artista", desc: false },
  { value: "duration", label: "Duração", desc: false },
  { value: "key", label: "Tom", desc: false },
]

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
const text = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true })

function compare(a: Song, b: Song, key: SortKey) {
  switch (key) {
    case "title":
      return text.compare(songTitle(a), songTitle(b))
    case "artist":
      return text.compare(a.artist || a.channel, b.artist || b.channel) || text.compare(songTitle(a), songTitle(b))
    case "duration":
      return (a.duration || 0) - (b.duration || 0)
    case "key":
      return NOTES.indexOf(a.key) - NOTES.indexOf(b.key) || text.compare(a.scale, b.scale)
    default:
      return (a.created || 0) - (b.created || 0)
  }
}

export function sortSongs(songs: Song[], prefs: Prefs) {
  const sorted = songs.slice().sort((a, b) => compare(a, b, prefs.sort))
  return prefs.desc ? sorted.reverse() : sorted
}

/** Preferências da biblioteca, lembradas neste navegador. */
export function useLibraryPrefs(): [Prefs, (p: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      return { view: "grid", sort: "created", desc: true, ...JSON.parse(localStorage.karaokeLibrary || "{}") }
    } catch {
      return { view: "grid", sort: "created", desc: true }
    }
  })
  return [
    prefs,
    p =>
      setPrefs(cur => {
        const next = { ...cur, ...p }
        localStorage.karaokeLibrary = JSON.stringify(next)
        return next
      }),
  ]
}

type Props = { filter: string; onFilter: (v: string) => void; prefs: Prefs; onPrefs: (p: Partial<Prefs>) => void }

export function LibraryToolbar({ filter, onFilter, prefs, onPrefs }: Props) {
  const descLabel = {
    created: ["Mais antigas primeiro", "Mais recentes primeiro"],
    title: ["De A a Z", "De Z a A"],
    artist: ["De A a Z", "De Z a A"],
    duration: ["Mais curtas primeiro", "Mais longas primeiro"],
    key: ["De C a B", "De B a C"],
  }[prefs.sort]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-40 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={filter} onChange={e => onFilter(e.target.value)} placeholder="Procurar na biblioteca" className="pl-8" />
      </div>

      <Select
        value={prefs.sort}
        onValueChange={v => onPrefs({ sort: v as SortKey, desc: SORTS.find(s => s.value === v)!.desc })}
      >
        <SelectTrigger className="w-44" aria-label="Ordenar por">
          <span className="text-muted-foreground">Ordenar:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map(s => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <IconButton label={descLabel[prefs.desc ? 1 : 0]} variant="outline" onClick={() => onPrefs({ desc: !prefs.desc })}>
        {prefs.desc ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
      </IconButton>

      <ToggleGroup type="single" variant="outline" value={prefs.view} onValueChange={v => v && onPrefs({ view: v as View })}>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToggleGroupItem value="grid" aria-label="Grade">
              <LayoutGrid />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>Grade</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToggleGroupItem value="list" aria-label="Lista">
              <List />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>Lista</TooltipContent>
        </Tooltip>
      </ToggleGroup>
    </div>
  )
}
