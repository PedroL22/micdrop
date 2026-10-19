import { Trash2, User } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Confirm, SectionTitle, Thumb } from "@/components/common"
import { QueueList } from "@/components/QueueList"
import { SearchPanel } from "@/components/SearchPanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePolling } from "@/hooks/usePolling"
import { api, songArt, songTitle } from "@/lib/api"
import type { Job, Song } from "@/lib/types"

/** Tela do celular: escolher músicas e acompanhar a fila. */
export default function Session() {
  const [name, setName] = useState<string>(localStorage.karaokeName || "")
  const [data, refresh] = usePolling(() =>
    Promise.all([api<Job[]>("/api/queue"), api<Song[]>("/api/songs")]).then(([queue, songs]) => ({ queue, songs })),
  )

  async function remove(s: Song) {
    try {
      await api(`/api/songs/${s.id}`, { method: "DELETE" })
      refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-6">
      <header className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-2xl bg-primary/15 text-xl">🎤</div>
        <div>
          <h1 className="text-xl font-bold">MicDrop</h1>
          <p className="text-sm text-muted-foreground">Escolha uma música para cantar</p>
        </div>
      </header>

      <Card size="sm">
        <CardContent className="space-y-2">
          <Label htmlFor="name" className="flex items-center gap-2">
            <User className="size-4" /> Seu nome
          </Label>
          <Input
            id="name"
            value={name}
            maxLength={30}
            placeholder="Para aparecer na fila (ex.: Tia Lúcia)"
            autoComplete="nickname"
            className="h-10"
            onChange={e => {
              setName(e.target.value)
              localStorage.karaokeName = e.target.value.trim()
            }}
          />
        </CardContent>
      </Card>

      <SearchPanel getName={() => name.trim()} onAdded={refresh} compact />

      <QueueList jobs={data?.queue || []} onChange={refresh} />

      <section>
        <SectionTitle>
          Prontas para cantar {!!data?.songs.length && <Badge variant="secondary">{data.songs.length}</Badge>}
        </SectionTitle>
        {data && data.songs.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma música pronta ainda.</p>}
        <div className="space-y-2">
          {data?.songs.map(s => (
            <Card key={s.id} size="sm" className="flex-row items-center gap-3 px-3 py-2.5">
              <Thumb src={songArt(s)} className="size-12" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{songTitle(s)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.artist || s.channel}
                  {s.owner_name && <span className="text-primary"> · {s.owner_name}</span>}
                </p>
              </div>
              {s.mine && (
                <Confirm
                  title="Apagar esta música?"
                  description={`"${songTitle(s)}" sai da biblioteca.`}
                  label="Apagar"
                  onConfirm={() => remove(s)}
                >
                  <Button variant="ghost" size="icon" aria-label="Apagar">
                    <Trash2 />
                  </Button>
                </Confirm>
              )}
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
