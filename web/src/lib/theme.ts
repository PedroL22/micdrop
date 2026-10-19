// Cor do tema tirada da capa da música.
// Lê a imagem num <canvas> pequeno, acha a cor "marcante" (o matiz mais forte e frequente)
// e pinta as variáveis do tema shadcn com ela. Imagem sem cor (cinza) = tema padrão.

export type Theme = { hue: number; chroma: number }

function toOklch(r8: number, g8: number, b8: number) {
  const lin = (c: number) => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const r = lin(r8), g = lin(g8), b = lin(b8)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 }
}

export async function themeFromImage(url: string): Promise<Theme | null> {
  const img = new Image()
  img.src = url
  await img.decode()
  const size = 48
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data

  // 24 faixas de matiz; cada pixel colorido vota com peso pela intensidade da cor
  const BINS = 24
  const weight = new Array(BINS).fill(0)
  const sumSin = new Array(BINS).fill(0)
  const sumCos = new Array(BINS).fill(0)
  const sumC = new Array(BINS).fill(0)
  for (let i = 0; i < data.length; i += 4) {
    const { L, C, H } = toOklch(data[i], data[i + 1], data[i + 2])
    if (L < 0.18 || L > 0.96 || C < 0.04) continue // preto, branco e cinza não contam
    const w = C * C
    const bin = Math.floor(H / (360 / BINS)) % BINS
    weight[bin] += w
    sumSin[bin] += Math.sin((H * Math.PI) / 180) * w
    sumCos[bin] += Math.cos((H * Math.PI) / 180) * w
    sumC[bin] += C * w
  }
  // junta cada faixa com as vizinhas, para não dividir uma cor entre duas faixas
  let best = -1
  let bestW = 0
  for (let b = 0; b < BINS; b++) {
    const w = weight[b] + 0.5 * (weight[(b + 1) % BINS] + weight[(b + BINS - 1) % BINS])
    if (w > bestW) {
      bestW = w
      best = b
    }
  }
  if (best < 0 || bestW < 0.15) return null // imagem quase sem cor
  const hue = ((Math.atan2(sumSin[best], sumCos[best]) * 180) / Math.PI + 360) % 360
  return { hue, chroma: sumC[best] / weight[best] }
}

const VARS = ["--primary", "--primary-foreground", "--ring", "--sing", "--background", "--card", "--popover", "--secondary", "--muted", "--accent", "--border"]

export function applyTheme(t: Theme | null) {
  const root = document.documentElement.style
  if (!t) {
    VARS.forEach(v => root.removeProperty(v))
    return
  }
  const h = t.hue.toFixed(1)
  const c = Math.min(0.2, Math.max(0.11, t.chroma * 1.3)).toFixed(3)
  const tint = Math.min(0.035, t.chroma * 0.25).toFixed(3)
  // amarelos/verdes claros ficam ilegíveis com texto branco: usa texto escuro neles
  const darkText = t.hue > 65 && t.hue < 150
  root.setProperty("--primary", `oklch(0.68 ${c} ${h})`)
  root.setProperty("--primary-foreground", darkText ? "oklch(0.18 0.02 " + h + ")" : "oklch(0.985 0 0)")
  root.setProperty("--ring", `oklch(0.68 ${c} ${h})`)
  root.setProperty("--sing", `oklch(0.87 ${Math.min(0.17, Number(c)).toFixed(3)} ${h})`)
  root.setProperty("--background", `oklch(0.155 ${tint} ${h})`)
  root.setProperty("--card", `oklch(0.2 ${tint} ${h})`)
  root.setProperty("--popover", `oklch(0.21 ${tint} ${h})`)
  root.setProperty("--secondary", `oklch(0.27 ${tint} ${h})`)
  root.setProperty("--muted", `oklch(0.27 ${tint} ${h})`)
  root.setProperty("--accent", `oklch(0.29 ${tint} ${h})`)
  root.setProperty("--border", `oklch(0.9 ${tint} ${h} / 10%)`)
}

export function glowColor(t: Theme | null) {
  return t ? `oklch(0.62 ${Math.min(0.2, Math.max(0.11, t.chroma * 1.3)).toFixed(3)} ${t.hue.toFixed(1)} / 0.55)` : "transparent"
}
