import { Fragment, useEffect, useLayoutEffect, useRef, type RefObject } from "react"

import type { LyricLine } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { AudioEngine } from "./engine"
import { wordTimes } from "./wordTiming"

type Props = {
  lines: LyricLine[]
  synced: boolean
  engine: AudioEngine
  offsetRef: RefObject<number>
  armed: boolean
  big: boolean
  onLineClick: (i: number) => void
  translations?: (string | null)[] | null // tradução de cada linha (pequena, embaixo)
}

function currentIndex(lines: LyricLine[], t: number) {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((lines[mid].t ?? 0) <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/**
 * A letra: a linha atual fica no meio, em destaque, e é pintada da esquerda para a direita
 * no ritmo das palavras. Atualiza o DOM direto (60x por segundo) sem re-renderizar o React.
 */
export function LyricsView({ lines, synced, engine, offsetRef, armed, big, onLineClick, translations }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const state = useRef({ idx: -2, wipe: -1, estimates: new Map<number, [number, number][]>() })

  // depois de qualquer render, reaplica destaque e posição no próximo quadro
  useLayoutEffect(() => {
    state.current.idx = -2
    state.current.wipe = -1
  })
  useEffect(() => {
    state.current.estimates.clear()
  }, [lines])

  useEffect(() => {
    if (!synced) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = inner.current
      if (!el || !box.current || !lines.length) return
      const t = engine.position() - (offsetRef.current || 0)
      const idx = currentIndex(lines, t)
      const st = state.current
      const els = el.children as HTMLCollectionOf<HTMLElement>
      if (idx !== st.idx) {
        st.idx = idx
        for (let i = 0; i < els.length; i++) {
          els[i].classList.toggle("active", i === idx)
          els[i].classList.toggle("past", i < idx)
        }
        const ref = els[Math.max(0, idx)]
        if (ref) {
          const center = ref.offsetTop + ref.offsetHeight / 2
          el.style.transform = `translateY(${box.current.clientHeight * 0.42 - center}px)`
        }
      }
      // preenchimento palavra por palavra
      if (st.wipe !== idx) {
        els[st.wipe]?.querySelectorAll<HTMLElement>(".w").forEach(w => w.style.removeProperty("--p"))
        st.wipe = idx
      }
      if (idx < 0) return
      // tempos ajustados para caber na linha (veja wordTiming.ts); calculados uma vez por linha
      let times = st.estimates.get(idx)
      if (!times) {
        times = wordTimes(lines, idx)
        st.estimates.set(idx, times)
      }
      const spans = els[idx].children as HTMLCollectionOf<HTMLElement>
      for (let k = 0; k < spans.length && k < times.length; k++) {
        const [s, e] = times[k]
        const v = Math.max(0, Math.min(1, (t - s) / Math.max(0.05, e - s))).toFixed(3)
        if (spans[k].dataset.p !== v) {
          spans[k].dataset.p = v
          spans[k].style.setProperty("--p", v)
        }
      }
    }
    raf = requestAnimationFrame(tick)
    const onResize = () => (state.current.idx = -2)
    window.addEventListener("resize", onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", onResize)
    }
  }, [lines, synced, engine, offsetRef])

  return (
    <div
      ref={box}
      className={cn(
        "lyrics-mask absolute inset-0 px-6 text-center select-none", // letra não é selecionável
        synced ? "overflow-hidden" : "overflow-y-auto py-8",
        armed && "lyrics-armed",
        big ? "text-[clamp(1.4rem,2.6vw,2.4rem)]" : "text-lg",
      )}
    >
      <div ref={inner} className={cn(synced && "py-10 transition-transform duration-500 ease-out")}>
        {lines.map((l, i) => (
          <div
            key={i}
            onClick={() => onLineClick(i)}
            className={cn("lyric-line leading-snug", synced ? "cursor-pointer py-[0.4em]" : "py-1")}
          >
            {l.text
              .trim()
              .split(/\s+/)
              .map((word, k) => (
                <Fragment key={k}>
                  {k > 0 && " "}
                  <span className="w">{word}</span>
                </Fragment>
              ))}
            {translations?.[i] && <span className="lyric-tr">{translations[i]}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
