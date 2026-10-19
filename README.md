# 🎤 Karaoke Arnold 2026 🎹

Karaokê caseiro com o **som original da música**: baixa do YouTube, tira a voz do cantor com IA
na sua placa de vídeo e mostra a letra sincronizada em tela cheia com a capa do disco ao fundo.
Cópia do app que o Funky mostrou [neste vídeo](https://youtu.be/6i3vDPOjexA).

## O que ele faz

- **Busca no YouTube** (nome ou link), mostra os 5 primeiros resultados e toca uma prévia
  de 5 segundos do meio da música.
- **Tudo automático ao adicionar**: a música já entra pronta, com a letra sincronizada
  (escolhida pela duração), o clipe de fundo e as palavras sincronizadas. Se o vídeo
  adicionado for só áudio (canais "Topic"), o app procura o clipe oficial. Se não achar uma
  letra confiável, dá para escolher no player.
- **Fila de processamento**: cada música é baixada e separada na GPU com o modelo
  **BS-Roformer** em duas etapas: (1) todas as vozes × instrumental, (2) voz principal × vocais de apoio.
- **Sessão pelo celular**: QR code em "Entrar na sessão". Cada pessoa adiciona músicas, vê o
  progresso em tempo real e só pode apagar as próprias (o PC do anfitrião pode apagar tudo).
- **Biblioteca** com pesquisa, prévia, trocar letra 🎤, trocar arte 🖼️, apagar 🗑️ e o **tom** detectado
  (ex.: `A# Major`). Aparece `sem letra` até você escolher uma.
- **Letra sincronizada** do [LRCLIB](https://lrclib.net) e **capas** do iTunes.
- **Ajustes valem para todas as músicas**: vozes, volume, desfoque, brilho e fundo (capa/clipe)
  ficam salvos e são usados em qualquer música. Só a sincronia da letra, o atraso do clipe e o tom
  são de cada música.
- **Cor do tema da capa**: no player, botões, sliders, fundo e o preenchimento das palavras ganham a
  cor marcante da capa (ou do clipe).
- **Player**: Original / Instrumental, volume dos vocais de suporte e dos vocais originais,
  desfoque do fundo, brilho do texto, ajuste de sincronia (±0,1 s / ±0,5 s ou "Sync com mouse")
  e tela cheia (os controles aparecem quando o mouse vai para a parte de baixo).
  **Clicar numa linha da letra pula a música para ela.**
- **Palavra por palavra**: a linha atual vai sendo pintada da esquerda para a direita no ritmo
  da voz. Ao escolher a letra, o app descobre o tempo de cada palavra ouvindo a voz isolada
  (modelo MMS da Meta, na GPU; na primeira vez baixa ~1,2 GB). Se a letra do LRCLIB já tiver
  o tempo de cada palavra, usa direto. O botão 🔤 Palavras refaz a sincronização.
- **Clipe de fundo** (🎬): mostra o videoclipe, mudo e sincronizado com a música, atrás da letra.
  Use o vídeo da própria música ou busque outro (ex.: o clipe oficial, quando o áudio veio de uma
  versão "Topic"). Se o clipe tiver uma introdução diferente, acerte com "Ajuste do clipe".
- **Auto-Tune via MIDI**: ao abrir uma música, manda a nota e a escala por MIDI para o Auto-Tune
  (ex.: no Reaper). Trocar nota/escala no player salva na música e manda de novo.

## Instalar e abrir

1. Dê dois cliques em **`Iniciar Karaoke.bat`**. Na primeira vez ele roda o `setup.ps1`, que instala
   ffmpeg, Node.js, Python 3.12, PyTorch com CUDA e o resto (uns 5 GB), e compila a interface.
2. O navegador abre em `http://localhost:5000`.
3. A primeira música também baixa os dois modelos de IA (~1,5 GB, só uma vez).

Se o Windows perguntar sobre o firewall, **permita em redes privadas** — senão os celulares não conectam.

Tempo de separação: numa RTX 3050 6 GB, uma música de 3–4 min leva alguns minutos.
Sem placa NVIDIA funciona, mas no processador fica bem lento. O `"fast_separation": true` do
`config.json` usa fp16 e menos sobreposição (bem mais rápido); mude para `false` se quiser a
qualidade máxima.

## Celulares

Abra "Entrar na sessão" e escaneie o QR code. **Só funciona para quem está no mesmo Wi-Fi**:
o endereço é o IP local do PC (ex.: `http://192.168.0.10:5000/session`).

## Auto-Tune por MIDI (opcional)

O app manda dois *Control Change* no canal 1:

| CC  | O quê  | Valores |
|-----|--------|---------|
| 20  | Nota   | C=0 … B=127, espalhado em 12 passos |
| 21  | Escala | posição em `scales` do `config.json` (Major, Minor, Chromatic), espalhado de 0 a 127 |

Passo a passo no Reaper:

1. Instale uma porta MIDI virtual, como o [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html), e crie uma porta.
2. No karaokê, escolha essa porta em **MIDI Device** (canto de cima).
3. No Reaper, em *Preferences > MIDI Devices*, ative essa porta como entrada e marque
   **Enable input for control messages**.
4. No Auto-Tune, mexa no parâmetro *Key*, clique em **Param > Learn** e, com a janela aberta,
   clique em **CC nota** na tela do karaokê. Repita para *Scale* com **CC escala**.
5. Abra uma música no player e confira se o plugin mudou de tom.

Se o plugin precisar de valores exatos, coloque em `config.json` as listas
`"key_values"` (12 números) e `"scale_values"` (um por escala), com o valor 0–127 de cada opção.
Os números de CC e o canal também ficam no `config.json`.

## Atalhos no player

- **Espaço**: tocar/pausar
- **F**: tela cheia
- **← / →**: voltar/avançar 5 s

## Arquivos

| Arquivo | Para quê |
|---------|----------|
| `app.py` | servidor web (Flask) e API |
| `pipeline.py` | fila: download, separação e tom |
| `separate.py` | roda a separação na GPU (processo à parte) |
| `align.py` | descobre o tempo de cada palavra na voz isolada |
| `lyrics.py` | letras do LRCLIB: busca, leitura do LRC e escolha automática |
| `midi_control.py` | envio de nota/escala por MIDI |
| `web/` | interface (React + [shadcn/ui](https://ui.shadcn.com)): telas do PC, do celular e do player. O `app.py` recompila sozinho ao iniciar quando ela muda; para mexer com recarga ao vivo, rode `npm run dev` em `web/` (abre na porta 5173 e conversa com o servidor na 5000) |
| `config.json` | porta, modelos, quantidade de resultados, MIDI |
| `data/` | músicas processadas (uma pasta por vídeo) |
| `models/` | modelos de IA baixados |
