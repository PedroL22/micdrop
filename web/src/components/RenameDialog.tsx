import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, songTitle } from "@/lib/api"
import type { Song } from "@/lib/types"

/** Trocar o nome e o artista de uma música. */
export function RenameDialog({
  song,
  open,
  onOpenChange,
  onSaved,
}: {
  song: Song
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (s: Song) => void
}) {
  const [title, setTitle] = useState("")
  const [artist, setArtist] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(songTitle(song))
      setArtist(song.artist || song.channel || "")
    }
  }, [open, song])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      const s = await api<Song>(`/api/songs/${song.id}`, {
        method: "PATCH",
        body: { title: title.trim(), artist: artist.trim() },
      })
      toast.success("Música renomeada")
      onSaved?.(s)
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Renomear</DialogTitle>
            <DialogDescription>Muda como a música aparece na biblioteca e no player.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-title">Nome da música</Label>
            <Input id="rename-title" value={title} onChange={e => setTitle(e.target.value)} autoFocus maxLength={150} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rename-artist">Artista</Label>
            <Input id="rename-artist" value={artist} onChange={e => setArtist(e.target.value)} maxLength={150} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving && <Loader2 className="animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
