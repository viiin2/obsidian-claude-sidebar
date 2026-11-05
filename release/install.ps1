# Claude Sidebar 설치 (Windows)
# install-windows.bat 을 더블클릭하면 이 스크립트가 실행됩니다.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here 'claude-sidebar'
function Ok($m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function No($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Claude Sidebar 설치" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path (Join-Path $src 'main.js'))) {
  No "claude-sidebar 폴더가 이 파일 옆에 없어요. zip을 먼저 '압축 풀기' 한 다음, 푼 폴더에서 실행해 주세요."
  exit 1
}

# 1. 설치할 볼트 고르기
$cfg = Join-Path $env:APPDATA 'obsidian\obsidian.json'
if (-not (Test-Path $cfg)) {
  No "옵시디언을 한 번도 켠 적이 없는 것 같아요. 옵시디언에서 볼트를 만든 뒤 다시 실행해 주세요."
  exit 1
}
$json = Get-Content $cfg -Raw -Encoding UTF8 | ConvertFrom-Json
$vaults = @($json.vaults.PSObject.Properties | ForEach-Object { $_.Value.path })
if ($vaults.Count -eq 0) { No "옵시디언 볼트를 찾지 못했어요."; exit 1 }
if ($vaults.Count -eq 1) {
  $vault = $vaults[0]
} else {
  Write-Host "어느 볼트에 설치할까요?"
  for ($i = 0; $i -lt $vaults.Count; $i++) { Write-Host ("  {0}) {1}" -f ($i + 1), $vaults[$i]) }
  $n = Read-Host "번호"
  $vault = $vaults[[int]$n - 1]
}
if (-not (Test-Path (Join-Path $vault '.obsidian'))) { No "볼트가 아니에요: $vault"; exit 1 }
Write-Host "볼트: $vault"
Write-Host ""

# 2. 플러그인 복사 (기존 대화 기록 data.json은 그대로 둠)
$dest = Join-Path $vault '.obsidian\plugins\claude-sidebar'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
foreach ($f in 'main.js', 'manifest.json', 'styles.css', 'assistant.js') {
  Copy-Item (Join-Path $src $f) $dest -Force
}
Get-ChildItem $dest | Unblock-File
Ok "플러그인 복사"

# 3. 켜진 플러그인 목록에 추가 (BOM 없는 UTF-8로 저장해야 옵시디언이 읽음)
$listPath = Join-Path $vault '.obsidian\community-plugins.json'
$list = @()
if (Test-Path $listPath) {
  try { $list = @(Get-Content $listPath -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { $list = @() }
}
if ($list -notcontains 'claude-sidebar') { $list += 'claude-sidebar' }
$out = ConvertTo-Json -InputObject @($list)
[System.IO.File]::WriteAllText($listPath, $out, (New-Object System.Text.UTF8Encoding $false))
Ok "플러그인 켜기"

# 4. 필요한 프로그램 확인
function Find-Bin($name) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:USERPROFILE\.local\bin\$name.exe", "$env:APPDATA\npm\$name.cmd", "$env:ProgramFiles\nodejs\$name.exe", "$env:ProgramFiles\GitHub CLI\$name.exe", "$env:ProgramFiles\Git\cmd\$name.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}
Write-Host ""
Write-Host "필요한 것:"
$c = Find-Bin 'claude'
if ($c) { Ok "Claude Code ($c)" } else { No "Claude Code가 없어요 → PowerShell에서  irm https://claude.ai/install.ps1 | iex  실행 후, claude 를 한 번 실행해 로그인" }
$g = Find-Bin 'git'
if ($g) { Ok "Git" } else { No "Git이 없어요 (Claude Code에 필요) → winget install --id Git.Git" }
$n = Find-Bin 'node'
if ($n) { Ok "Node.js" } else { No "Node.js가 없어요 (자동 비서에 필요) → winget install OpenJS.NodeJS.LTS" }
$h = Find-Bin 'gh'
if ($h) { Ok "GitHub CLI" } else { No "GitHub CLI가 없어요 (선택: 내 GitHub 저장소도 챙기려면) → winget install --id GitHub.cli  후  gh auth login" }

Write-Host ""
Write-Host "끝! 옵시디언을 완전히 껐다가 다시 켜세요." -ForegroundColor Cyan
Write-Host " - 왼쪽 아이콘 줄의 로봇 아이콘을 누르면 사이드바가 열려요."
Write-Host " - 플러그인이 안 보이면: 설정 > 커뮤니티 플러그인 > '제한 모드 끄기' 후 Claude Sidebar 켜기"
Write-Host " - 자동 비서(아침·점심·저녁 브리핑, 일정 알림): 설정 > Claude Sidebar > 자동 비서 켜기"
Write-Host " - 사용법은 이 폴더의 START-HERE.md 를 보세요."
Write-Host ""
