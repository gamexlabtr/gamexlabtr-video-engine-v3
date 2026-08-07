param(
  [Parameter(Mandatory=$true)]
  [string]$RepoUrl
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Git bulunamadi. Once GitHub Desktop veya Git for Windows kurun."
  exit 1
}

git init
git branch -M main
git add -A
git commit -m "Install GamexlabTR Video Studio v2.0"
git remote remove origin 2>$null
git remote add origin $RepoUrl
git push -u origin main --force

Write-Host "Yukleme tamamlandi."
