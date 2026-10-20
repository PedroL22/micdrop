import { CheckCircle2, Clock, Cookie, Loader2, Trash2, Upload, XCircle } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"

type Status = { cookies: boolean; js_runtime: string | null; cooldown_until: number | null }

function Row({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <span>{children}</span>
    </p>
  )
}

/** Estado do acesso ao YouTube e envio do cookies.txt (evita o "confirme que você não é um robô"). */
export function YouTubeSettings() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const load = () => api<Status>("/api/youtube").then(setStatus).catch(() => {})
  useEffect(() => {
    load()
  }, [])

  async function upload(f: File) {
    setBusy(true)
    try {
      setStatus(await api<Status>("/api/youtube/cookies", { method: "POST", body: { text: await f.text() } }))
      toast.success("Cookies do YouTube salvos", { description: "As próximas músicas já usam." })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ""
    }
  }

  async function remove() {
    try {
      setStatus(await api<Status>("/api/youtube/cookies", { method: "DELETE" }))
      toast.success("Cookies removidos")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (!status) {
    return (
      <div className="grid place-items-center py-6">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const pause = status.cooldown_until ? new Date(status.cooldown_until * 1000) : null
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Row ok={!!status.js_runtime}>
          {status.js_runtime
            ? `Liberação dos vídeos funcionando (usando ${status.js_runtime}).`
            : "Falta um interpretador de JavaScript (instale o Node.js) para o YouTube liberar os vídeos."}
        </Row>
        <Row ok={status.cookies}>
          {status.cookies ? "Cookies do YouTube enviados: menos bloqueios." : "Sem cookies do YouTube (opcional)."}
        </Row>
        {pause && (
          <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-sm text-amber-300">
            <Clock className="mt-0.5 size-4 shrink-0" />
            O YouTube pediu uma pausa. A fila volta sozinha às{" "}
            {pause.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
          </p>
        )}
      </div>

      <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Cookie className="size-4" /> Bloqueio "confirme que você não é um robô"
        </p>
        <p className="text-muted-foreground">
          Acontece depois de muitos downloads seguidos. A fila espera e tenta de novo sozinha, mas para evitar de vez:
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>
            No Chrome, instale a extensão <b>Get cookies.txt LOCALLY</b>.
          </li>
          <li>
            Abra o <b>youtube.com</b> já logado na sua conta e clique em <b>Export</b> na extensão.
          </li>
          <li>Envie aqui o arquivo baixado.</li>
        </ol>
        <div className="flex flex-wrap gap-2 pt-1">
          <input
            ref={file}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={e => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <Button size="sm" onClick={() => file.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
            {status.cookies ? "Enviar outro cookies.txt" : "Enviar cookies.txt"}
          </Button>
          {status.cookies && (
            <Button size="sm" variant="ghost" onClick={remove}>
              <Trash2 /> Remover
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
