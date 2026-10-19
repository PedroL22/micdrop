import { Copy, QrCode, Settings2, Wifi } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { IconButton } from "@/components/common"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import type { Info } from "@/lib/types"

/** QR code para os convidados entrarem pelo celular. */
export function InviteDialog({ info }: { info?: Info }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg">
          <QrCode /> Convidar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Chame a galera</DialogTitle>
          <DialogDescription>
            Escaneie com a câmera do celular para escolher músicas e entrar na fila.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <img src="/qr.svg" alt="QR code da sessão" className="size-56 rounded-xl bg-white p-2" />
          {info && (
            <div className="flex w-full items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{info.session_url}</span>
              <IconButton
                label="Copiar endereço"
                size="icon-sm"
                onClick={() => navigator.clipboard.writeText(info.session_url).then(() => toast.success("Endereço copiado"))}
              >
                <Copy />
              </IconButton>
            </div>
          )}
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Wifi className="size-3.5" /> Só funciona para quem estiver no mesmo Wi-Fi.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const NONE = "__none__"

/** Escolhe a porta MIDI que manda o tom para o Auto-Tune. */
export function MidiDialog({ info, onChange }: { info?: Info; onChange: () => void }) {
  const [device, setDevice] = useState(info?.midi_device || "")
  useEffect(() => setDevice(info?.midi_device || ""), [info?.midi_device])
  const devices = info?.midi_devices || []
  const missing = device && !devices.includes(device)

  async function choose(value: string) {
    const d = value === NONE ? "" : value
    setDevice(d)
    try {
      await api("/api/midi/device", { method: "POST", body: { device: d } })
      toast.success(d ? `MIDI: ${d}` : "MIDI desligado")
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function test(which: "key" | "scale") {
    const r = await api<{ sent: boolean }>("/api/midi/test", { method: "POST", body: { which } }).catch(e => {
      toast.error(e.message)
      return null
    })
    if (r) r.sent ? toast.success("CC enviado") : toast.warning("Escolha um dispositivo MIDI primeiro")
  }

  return (
    <Dialog>
      <Tooltipped>
        <DialogTrigger asChild>
          <Button variant="outline" size="icon-lg" aria-label="Auto-Tune (MIDI)">
            <Settings2 />
          </Button>
        </DialogTrigger>
      </Tooltipped>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Auto-Tune por MIDI</DialogTitle>
          <DialogDescription>
            Ao abrir uma música, o app manda a nota e a escala dela para o Auto-Tune (por exemplo, no Reaper).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Dispositivo MIDI</Label>
            <Select value={device || NONE} onValueChange={choose}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nenhum (desligado)</SelectItem>
                {devices.map(d => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
                {missing && <SelectItem value={device}>{device} (desconectado)</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
            <p className="font-medium">Ligar no Reaper (uma vez só)</p>
            <p className="text-muted-foreground">
              No Auto-Tune, mexa em <b>Key</b>, clique em <b>Param › Learn</b> e aperte <b>CC da nota</b>. Repita com{" "}
              <b>Scale</b> e <b>CC da escala</b>.
            </p>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => test("key")}>
                CC da nota
              </Button>
              <Button variant="secondary" size="sm" onClick={() => test("scale")}>
                CC da escala
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}


function Tooltipped({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>Auto-Tune (MIDI)</TooltipContent>
    </Tooltip>
  )
}
