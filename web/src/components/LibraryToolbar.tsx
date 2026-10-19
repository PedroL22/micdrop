import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
  CalendarClock,
  Check,
  ChevronDown,
  LayoutGrid,
  List,
  Music2,
  Search,
  Timer,
  Type,
  User,
} from "lucide-react"
import { useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { songTitle } from "@/lib/api"
import { withViewTransition } from "@/lib/router"
import { cn } from "@/lib/utils"
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

const DIRECTION: Record<SortKey, [string, string]> = {
  created: ["Mais antigas primeiro", "Mais recentes primeiro"],
  title: ["De A a Z", "De Z a A"],
  artist: ["De A a Z", "De Z a A"],
  duration: ["Mais curtas primeiro", "Mais longas primeiro"],
  key: ["De C a B", "De B a C"],
}

const SORT_ICONS: Record<SortKey, ReactNode> = {
  created: <CalendarClock />,
  title: <Type />,
  artist: <User />,
  duration: <Timer />,
  key: <Music2 />,
}

export function LibraryToolbar({ filter, onFilter, prefs, onPrefs }: Props) {
  const [open, setOpen] = useState(false)
  const current = SORTS.find(s => s.value === prefs.sort) || SORTS[0]
  // ordenar e trocar grade/lista: os cartões deslizam até o novo lugar
  const change = (p: Partial<Prefs>) => withViewTransition(() => onPrefs(p))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-40 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={filter} onChange={e => onFilter(e.target.value)} placeholder="Procurar na biblioteca" className="pl-8" />
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="gap-2" aria-label="Ordenar">
            <ArrowUpDown />
            <span className="text-muted-foreground">Ordenar:</span>
            {current.label}
            <ChevronDown className="opacity-60 transition-transform duration-200 group-aria-expanded/button:rotate-180" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 p-1.5">
          <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">Ordenar por</p>
          <div className="space-y-0.5">
            {SORTS.map(s => {
              const active = s.value === prefs.sort
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => {
                    change({ sort: s.value, desc: s.desc })
                    setOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors [&_svg]:size-4",
                    active ? "bg-primary/15 text-foreground" : "text-foreground/80 hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className={cn(active ? "text-primary" : "text-muted-foreground")}>{SORT_ICONS[s.value]}</span>
                  <span className="flex-1 text-left">{s.label}</span>
                  {active && <Check className="text-primary" />}
                </button>
              )
            })}
          </div>
          <Separator className="my-1.5" />
          <p className="px-2 pb-1.5 text-xs font-medium text-muted-foreground">Ordem</p>
          <div className="space-y-0.5">
            {([false, true] as const).map(desc => {
              const active = prefs.desc === desc
              return (
                <button
                  key={String(desc)}
                  type="button"
                  onClick={() => change({ desc })}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors [&_svg]:size-4",
                    active ? "bg-primary/15 text-foreground" : "text-foreground/80 hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className={cn(active ? "text-primary" : "text-muted-foreground")}>
                    {desc ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
                  </span>
                  <span className="flex-1 text-left">{DIRECTION[prefs.sort][desc ? 1 : 0]}</span>
                  {active && <Check className="text-primary" />}
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>

      <ToggleGroup type="single" variant="outline" value={prefs.view} onValueChange={v => v && change({ view: v as View })}>
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
