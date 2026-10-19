import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import Home from "@/pages/Home"
import Player from "@/pages/Player"
import Session from "@/pages/Session"
import "./index.css"

// Três telas, escolhidas pelo endereço: / (PC), /session (celular), /player/<id>
function App() {
  const path = window.location.pathname
  const player = path.match(/^\/player\/([A-Za-z0-9_-]{11})/)
  if (player) return <Player songId={player[1]} />
  if (path.startsWith("/session")) return <Session />
  return <Home />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <App />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  </StrictMode>,
)
