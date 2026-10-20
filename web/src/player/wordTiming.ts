import type { LyricLine } from "@/lib/types"

// Quando cada palavra da linha é pintada.
//
// O alinhamento (align.py) acerta bem o INÍCIO das palavras, mas costuma esticar a última
// até a voz da linha seguinte (e puxar a primeira para antes da linha aparecer). Se usarmos
// isso direto, a linha troca com o preenchimento pela metade e parece que "pulou".
// Então: cada palavra vai do seu início até o início da próxima, a última ganha uma duração
// natural e tudo fica dentro do tempo da linha. Sem alinhamento confiável, usa uma duração
// padrão pelo número de sílabas.

type Span = [number, number]

const SECONDS_PER_SYLLABLE = 0.26 // canto: ~3,8 sílabas por segundo
const LINE_PADDING = 0.45

/** Sílabas aproximadas (grupos de vogais). */
export function syllables(word: string) {
  const plain = word.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")
  return Math.max(1, (plain.match(/[aeiouy]+/g) || []).length)
}

/** Até quando a linha pode ser pintada: um pouco antes da próxima começar. */
function lineWindow(lines: LyricLine[], i: number): [number, number] {
  const t0 = lines[i].t ?? 0
  const next = i + 1 < lines.length ? (lines[i + 1].t ?? t0 + 8) : t0 + 8
  return [t0, Math.max(t0 + 0.4, next - 0.12)]
}

/** Duração padrão: tempo natural da frase pelo número de sílabas, repartido entre as palavras. */
function defaultSpans(words: string[], t0: number, end: number): Span[] {
  const syl = words.map(syllables)
  const total = syl.reduce((a, b) => a + b, 0)
  const dur = Math.min(end - t0, Math.max(0.8, LINE_PADDING + SECONDS_PER_SYLLABLE * total))
  let t = t0
  return syl.map(n => {
    const d = (dur * n) / total
    const span: Span = [t, t + d]
    t += d
    return span
  })
}

export function wordTimes(lines: LyricLine[], i: number): Span[] {
  const words = lines[i].text.trim().split(/\s+/)
  const [t0, end] = lineWindow(lines, i)
  const w = lines[i].w
  if (!w || w.length !== words.length) return defaultSpans(words, t0, end)

  const lastWord = words[words.length - 1]
  const lastDur = Math.max(0.3, 0.2 + 0.18 * syllables(lastWord))
  // a última palavra precisa caber antes do fim da linha
  const limit = end - Math.min(lastDur, (end - t0) * 0.3)

  let starts = w.map(x => x[0])
  // alinhamento sem sentido (palavra começando muito depois da linha): duração padrão
  if (starts[0] > t0 + 3 || starts[starts.length - 1] < t0 || Math.max(starts[0], t0) >= limit) {
    return defaultSpans(words, t0, end)
  }
  // nada começa antes de a linha aparecer
  starts = starts.map(s => Math.max(s, t0))
  // passou do fim da linha: comprime proporcionalmente
  const s0 = starts[0]
  const sN = starts[starts.length - 1]
  if (sN > limit && sN > s0) starts = starts.map(s => s0 + ((s - s0) * (limit - s0)) / (sN - s0))
  // sempre para frente
  for (let k = 1; k < starts.length; k++) starts[k] = Math.max(starts[k], starts[k - 1] + 0.04)

  return starts.map((s, k) => [s, k + 1 < starts.length ? starts[k + 1] : Math.min(end, s + lastDur)] as Span)
}
