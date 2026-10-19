# Instala tudo que o karaokê precisa (rodar uma vez só).
# Uso: clique com o botão direito > "Executar com o PowerShell", ou rode "Iniciar Karaoke.bat".
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host "== Karaoke: instalação ==" -ForegroundColor Cyan

if (-not (Have ffmpeg)) {
    Write-Host "Instalando ffmpeg (winget)..."
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

if (-not (Have npm)) {
    Write-Host "Instalando Node.js (para a interface)..."
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

if (-not (Have uv)) {
    Write-Host "Instalando uv (gerenciador de Python)..."
    powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 | iex"
    $env:Path = "$env:USERPROFILE\.local\bin;" + $env:Path
}

if (-not (Test-Path "venv\Scripts\python.exe")) {
    Write-Host "Criando ambiente Python 3.12..."
    uv venv --python 3.12 venv
}

$py = "venv\Scripts\python.exe"
if (Have nvidia-smi) {
    Write-Host "Placa NVIDIA encontrada: instalando PyTorch com CUDA..."
    uv pip install --python $py torch torchaudio --index-url https://download.pytorch.org/whl/cu128
} else {
    Write-Host "Sem placa NVIDIA: a separação vai rodar no processador (bem mais lenta)." -ForegroundColor Yellow
    uv pip install --python $py torch torchaudio
}

Write-Host "Instalando o resto..."
uv pip install --python $py -r requirements.txt

Write-Host "Compilando a interface..."
Push-Location web
npm install --no-audit --no-fund
npm run build
Pop-Location

& $py -c "import torch; print('GPU disponível:', torch.cuda.is_available())"
Write-Host "Pronto! Agora é só abrir 'Iniciar Karaoke.bat'." -ForegroundColor Green
