import { Check, Clapperboard, FileText, Image, Mic, MoreVertical, Music2, Pencil, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Confirm, PreviewButton } from "@/components/common"
import { ImageThumbnail } from "@/components/ImageThumbnail"
import { RenameDialog } from "@/components/RenameDialog"
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
import { api, fmtTime, keyLabel, songTitle, wordsReady } from "@/lib/api"
import { navigate } from "@/lib/router"
import type { Song } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

function cardArt(s: Song) {
  if (s.cover) return `/media/${s.id}/cover.jpg?v=${s.cover_v || 0}`
  const clip = s.video?.status === "ready" ? s.video.source : s.id
  return `https://i.ytimg.com/vi/${clip}/hqdefault.jpg`
}

function openSong(s: Song, pick?: string) {
  navigate(`/player/${s.id}${pick ? `?pick=${pick}` : ""}`)
}

// Nomes de View Transition: o cartão desliza ao reordenar e a imagem vira o palco do player
export const vt = (name: string, cls: string) => ({ viewTransitionName: name, viewTransitionClass: cls }) as React.CSSProperties

type ItemProps = { song: Song; onChange: () => void; index?: number; animate?: boolean }
const enter = (animate?: boolean, index = 0) =>
  animate ? { className: "animate-fade-in-up", style: { animationDelay: `${Math.min(index, 12) * 40}ms` } } : { className: "", style: {} }

/** Selos: tom, estado da letra e clipe. */
function SongBadges({ song }: { song: Song }) {
  return (
    <>
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
    </>
  )
}

// ---------------------------------------------------------------- menu da música

type MenuItemComponent = React.ComponentType<{
  onSelect?: (event: Event) => void
  variant?: "default" | "destructive"
  children?: React.ReactNode
}>
type MenuSeparatorComponent = React.ComponentType<object>

/** Ações da música (cantar, renomear, trocar letra/capa/clipe, apagar).
 *  As mesmas opções aparecem no botão ⋮ e no clique direito (ContextMenu do shadcn). */
function useSongMenu(song: Song, onChange: () => void) {
  const [confirm, setConfirm] = useState(false)
  const [rename, setRename] = useState(false)

  async function remove() {
    try {
      await api(`/api/songs/${song.id}`, { method: "DELETE" })
      toast.success("Música apagada")
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const items = (Item: MenuItemComponent, Separator: MenuSeparatorComponent) => (
    <>
      <Item onSelect={() => openSong(song)}>
        <Mic /> Cantar
      </Item>
      <Item onSelect={() => setRename(true)}>
        <Pencil /> Renomear
      </Item>
      <Item onSelect={() => openSong(song, "lyrics")}>
        <FileText /> Trocar letra
      </Item>
      <Item onSelect={() => openSong(song, "cover")}>
        <Image /> Trocar capa
      </Item>
      <Item onSelect={() => openSong(song, "clip")}>
        <Clapperboard /> Trocar clipe
      </Item>
      {song.mine && (
        <>
          <Separator />
          <Item variant="destructive" onSelect={() => setConfirm(true)}>
            <Trash2 /> Apagar
          </Item>
        </>
      )}
    </>
  )

  const dialogs = (
    <>
      <RenameDialog song={song} open={rename} onOpenChange={setRename} onSaved={onChange} />
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="Apagar esta música?"
        description={`"${songTitle(song)}" sai da biblioteca, junto com as vozes separadas, a letra e o clipe.`}
        onConfirm={remove}
      />
    </>
  )
  return { items, dialogs }
}

type SongMenu = ReturnType<typeof useSongMenu>

/** Prévia + botão ⋮. */
function SongActions({ song, menu }: { song: Song; menu: SongMenu }) {
  return (
    <>
      <PreviewButton id={`song-${song.id}`} src={`/media/${song.id}/original.flac`} start={(song.duration || 60) / 2} variant="ghost" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Mais opções">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-44">
          {menu.items(DropdownMenuItem as MenuItemComponent, DropdownMenuSeparator)}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/** Clique direito em qualquer parte do cartão/linha abre o mesmo menu, onde o mouse está. */
function WithContextMenu({ menu, children }: { menu: SongMenu; children: React.ReactElement }) {
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          {menu.items(ContextMenuItem as MenuItemComponent, ContextMenuSeparator)}
        </ContextMenuContent>
      </ContextMenu>
      {menu.dialogs}
    </>
  )
}

/** Modo grade: cartão grande com a imagem. */
export function SongCard({ song, onChange, index, animate }: ItemProps) {
  const e = enter(animate, index)
  const menu = useSongMenu(song, onChange)
  return (
    <WithContextMenu menu={menu}>
      <Card
        className={cn(
          "group gap-0 overflow-hidden py-0 transition-[translate,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10",
          e.className,
        )}
        style={{ ...vt(`song-${song.id}`, "card"), ...e.style }}
      >
        <button type="button" onClick={() => openSong(song)} className="relative block aspect-video w-full overflow-hidden text-left">
          <ImageThumbnail
            src={cardArt(song)}
            containerClassName="size-full"
            className="duration-500 group-hover:scale-105"
            style={vt(`art-${song.id}`, "art")}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
          <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg">
              <Mic className="size-4" /> Cantar
            </span>
          </div>
          <span className="absolute top-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-white tabular-nums">
            {fmtTime(song.duration)}
          </span>
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
            <SongBadges song={song} />
          </div>
          <SongActions song={song} menu={menu} />
        </div>
      </Card>
    </WithContextMenu>
  )
}

/** Modo lista: uma linha compacta por música. */
export function SongRow({ song, onChange, index, animate }: ItemProps) {
  const e = enter(animate, index)
  const menu = useSongMenu(song, onChange)
  return (
    <WithContextMenu menu={menu}>
      <Card
        size="sm"
        className={cn("group flex-row items-center gap-3 px-2.5 py-2 transition-colors duration-200 hover:bg-accent/40", e.className)}
        style={{ ...vt(`song-${song.id}`, "card"), ...e.style }}
      >
        <button type="button" onClick={() => openSong(song)} className="relative shrink-0 overflow-hidden rounded-md" aria-label={`Cantar ${songTitle(song)}`}>
          <ImageThumbnail src={cardArt(song)} containerClassName="aspect-video w-24" style={vt(`art-${song.id}`, "art")} />
          <span className="absolute inset-0 grid place-items-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <Mic className="size-4 text-white" />
          </span>
        </button>
        <button type="button" onClick={() => openSong(song)} className="min-w-0 flex-1 text-left">
          <p className="truncate font-medium">{songTitle(song)}</p>
          <p className="truncate text-sm text-muted-foreground">
            {song.artist || song.channel}
            {song.owner_name && <span> · por {song.owner_name}</span>}
          </p>
        </button>
        <div className="hidden flex-wrap justify-end gap-1.5 md:flex">
          <SongBadges song={song} />
        </div>
        <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">{fmtTime(song.duration)}</span>
        <Button size="sm" onClick={() => openSong(song)} className="hidden sm:inline-flex">
          <Mic /> Cantar
        </Button>
        <div className="flex">
          <SongActions song={song} menu={menu} />
        </div>
      </Card>
    </WithContextMenu>
  )
}
