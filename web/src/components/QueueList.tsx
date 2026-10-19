import { AlertCircle, Loader2, RotateCcw, X } from "lucide-react"
import { toast } from "sonner"

import { Confirm, SectionTitle, Thumb } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { api } from "@/lib/api"
import type { Job } from "@/lib/types"

export function QueueList({ jobs, onChange }: { jobs: Job[]; onChange: () => void }) {
  if (!jobs.length) return null

  async function remove(job: Job) {
    try {
      await api(`/api/queue/${job.id}`, { method: "DELETE" })
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function retry(job: Job) {
    await api(`/api/queue/${job.id}/retry`, { method: "POST", body: {} }).catch(e => toast.error(e.message))
    onChange()
  }

  return (
    <section>
      <SectionTitle>
        Preparando <Badge variant="secondary">{jobs.length}</Badge>
      </SectionTitle>
      <div className="space-y-2">
        {jobs.map(job => {
          const err = job.status === "error"
          return (
            <Card key={job.id} size="sm" className="flex-row items-center gap-3 px-3 py-3">
              <Thumb src={job.thumbnail} className="aspect-video w-24" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-medium">{job.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {job.channel}
                  {job.owner_name && <span className="text-primary"> · {job.owner_name}</span>}
                </p>
                {err ? (
                  <p className="flex items-start gap-1.5 text-xs text-destructive" title={job.error || ""}>
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                    <span className="line-clamp-2">Deu erro: {job.error}</span>
                  </p>
                ) : (
                  <>
                    <p className="flex items-center gap-1.5 text-xs text-foreground/80">
                      {job.status === "running" && <Loader2 className="size-3 animate-spin" />}
                      {job.stage}
                    </p>
                    <Progress value={Math.round(job.progress * 100)} />
                  </>
                )}
              </div>
              {err && job.mine && (
                <Button size="sm" variant="secondary" onClick={() => retry(job)}>
                  <RotateCcw /> Tentar de novo
                </Button>
              )}
              {job.mine && (
                <Confirm
                  title="Tirar da fila?"
                  description={`"${job.title}" vai sair da fila e o que já foi feito será descartado.`}
                  action="Tirar da fila"
                  label="Tirar da fila"
                  onConfirm={() => remove(job)}
                >
                  <Button variant="ghost" size="icon" aria-label="Tirar da fila">
                    <X />
                  </Button>
                </Confirm>
              )}
            </Card>
          )
        })}
      </div>
    </section>
  )
}
