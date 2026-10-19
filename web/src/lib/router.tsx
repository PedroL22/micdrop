import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react"
import { flushSync } from "react-dom"

// Navegação sem recarregar a página, com View Transitions:
// o navegador fotografa a tela antiga e a nova e anima entre elas.

const isIgnorable = (error: unknown) => {
  const name = (error as { name?: string } | null)?.name
  return name === "AbortError" || name === "InvalidStateError"
}

/** Roda a mudança dentro de uma View Transition, se o navegador suportar. */
export function withViewTransition(update: () => void) {
  const start = document.startViewTransition?.bind(document)
  if (!start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update()
    return
  }
  try {
    const t = start(() => flushSync(update))
    for (const p of [t.ready, t.updateCallbackDone, t.finished]) p.catch(e => !isIgnorable(e) && console.warn(e))
  } catch (e) {
    if (!isIgnorable(e)) throw e
    update()
  }
}

const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())
const current = () => location.pathname + location.search

// posição da rolagem de cada tela, para voltar para onde estava
const scrolls = new Map<string, number>()
const restoreScroll = () => window.scrollTo(0, scrolls.get(location.pathname) ?? 0)

export function navigate(to: string) {
  if (to === current()) return
  scrolls.set(location.pathname, window.scrollY)
  withViewTransition(() => {
    history.pushState({ spa: true }, "", to)
    emit()
    restoreScroll()
  })
}

/** Voltar: usa o histórico se viemos de dentro do app, senão vai para `fallback`. */
export function goBack(fallback = "/") {
  if (history.state?.spa) history.back()
  else navigate(fallback)
}

window.addEventListener("popstate", () => {
  withViewTransition(() => {
    emit()
    restoreScroll()
  })
})
history.scrollRestoration = "manual"

window.addEventListener("scroll", () => scrolls.set(location.pathname, window.scrollY), { passive: true })

export function usePath() {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    current,
  )
}

/** <a> que navega com transição (Ctrl/Cmd+clique continua abrindo em outra aba). */
export function Link({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate(href)
      }}
      {...props}
    />
  )
}
