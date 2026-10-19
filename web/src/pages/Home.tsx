import { Music } from "lucide-react"
import { useMemo, useState } from "react"

import { SectionTitle } from "@/components/common"
import { InviteDialog, MidiDialog } from "@/components/HostDialogs"
import { LibraryToolbar, sortSongs, useLibraryPrefs } from "@/components/LibraryToolbar"
import { QueueList } from "@/components/QueueList"
import { SearchPanel } from "@/components/SearchPanel"
import { SongCard, SongRow } from "@/components/SongCard"
import { Badge } from "@/components/ui/badge"
import { usePolling } from "@/hooks/usePolling"
import { api } from "@/lib/api"
import type { Info, Job, Song } from "@/lib/types"

export default function Home() {
  const [data, refresh] = usePolling(() =>
    Promise.all([api<Job[]>("/api/queue"), api<Song[]>("/api/songs")]).then(([queue, songs]) => ({ queue, songs })),
  )
  const [info, refreshInfo] = usePolling(() => api<Info>("/api/info"), 15000)
  const [filter, setFilter] = useState("")
  const [prefs, setPrefs] = useLibraryPrefs()

  const songs = data?.songs || []
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const found = f ? songs.filter(s => `${s.title} ${s.artist} ${s.channel}`.toLowerCase().includes(f)) : songs
    return sortSongs(found, prefs)
  }, [songs, filter, prefs])

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-primary/15 text-2xl">🎤</div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Karaoke Arnold</h1>
            <p className="text-sm text-muted-foreground">Cante por cima do som original</p>
          </div>
        </div>
        <div className="flex gap-2">
          <InviteDialog info={info} />
          <MidiDialog info={info} onChange={refreshInfo} />
        </div>
      </header>

      <SearchPanel onAdded={refresh} />

      <QueueList jobs={data?.queue || []} onChange={refresh} />

      <section>
        <SectionTitle>
          Biblioteca {songs.length > 0 && <Badge variant="secondary">{songs.length}</Badge>}
        </SectionTitle>
        {songs.length > 0 && (
          <div className="mb-4">
            <LibraryToolbar filter={filter} onFilter={setFilter} prefs={prefs} onPrefs={setPrefs} />
          </div>
        )}

        {data && songs.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-center">
            <Music className="size-8 text-muted-foreground" />
            <p className="font-medium">Nenhuma música ainda</p>
            <p className="text-sm text-muted-foreground">Busque uma música acima para começar.</p>
          </div>
        )}
        {songs.length > 0 && shown.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma música com “{filter}”.</p>
        )}
        {prefs.view === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map(s => (
              <SongCard key={s.id} song={s} onChange={refresh} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {shown.map(s => (
              <SongRow key={s.id} song={s} onChange={refresh} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
