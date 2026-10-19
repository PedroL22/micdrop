import { Check, Clapperboard, FileText, Image, Mic, MoreVertical, Music2, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Confirm, PreviewButton } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api, keyLabel, songTitle, wordsReady } from "@/lib/api"
import type { Song } from "@/lib/types"

function cardArt(s: Song) {
  if (s.cover) return `/media/${s.id}/cover.jpg?v=${s.cover_v || 0}`
  const clip = s.video?.status === "ready" ? s.video.source : s.id
  return `https://i.ytimg.com/vi/${clip}/hqdefault.jpg`
}

export function SongCard({ song, onChange }: { song: Song; onChange: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const open = (pick?: string) => (location.href = `/player/${song.id}${pick ? `?pick=${pick}` : ""}`)

  async function remove() {
    try {
      await api(`/api/songs/${song.id}`, { method: "DELETE" })
      toast.success("Música apagada")
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Card className="group gap-0 overflow-hidden py-0">
      <button type="button" onClick={() => open()} className="relative block aspect-video w-full overflow-hidden text-left">
        <img
          src={cardArt(song)}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg">
            <Mic className="size-4" /> Cantar
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-3">
          <p className="truncate font-semibold text-white">{songTitle(song)}</p>
          <p className="truncate text-sm text-white/70">
            {song.artist || song.channel}
            {song.owner_name && <span> · por {song.owner_name}</span>}
          </p>
        </div>
      </button>
      <div className="flex items-center gap-1.5 p-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          <Badge variant="secondary">
            <Music2 /> {keyLabel(song.key, song.scale)}
          </Badge>
          {wordsReady(song) ? (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
              <Check /> Letra
            </Badge>
          ) : song.lyrics ? (
            <Badge variant="outline">Letra sem palavras</Badge>
          ) : (
            <Badge variant="destructive">Sem letra</Badge>
          )}
          {song.video?.status === "ready" && (
            <Badge variant="outline">
              <Clapperboard /> Clipe
            </Badge>
          )}
        </div>
        <PreviewButton id={`song-${song.id}`} src={`/media/${song.id}/original.flac`} start={(song.duration || 60) / 2} variant="ghost" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Mais opções">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => open()}>
              <Mic /> Cantar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => open("lyrics")}>
              <FileText /> Trocar letra
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => open("cover")}>
              <Image /> Trocar capa
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => open("clip")}>
              <Clapperboard /> Trocar clipe
            </DropdownMenuItem>
            {song.mine && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
                  <Trash2 /> Apagar
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="Apagar esta música?"
        description={`"${songTitle(song)}" sai da biblioteca, junto com as vozes separadas, a letra e o clipe.`}
        onConfirm={remove}
      />
    </Card>
  )
}
