$ErrorActionPreference = 'Stop'
function Assert-Exit([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "$Step failed ($LASTEXITCODE)" }
}
Set-Location (Split-Path $PSScriptRoot -Parent)
if (git status --porcelain) { throw '工作区有未提交修改。请先检查并提交本次文件。' }
git fetch origin main
Assert-Exit 'fetch main'
$releaseSha = (git rev-parse HEAD).Trim()
$mainSha = (git rev-parse origin/main).Trim()
if ($releaseSha -ne $mainSha) { throw '请切换到已合并的 origin/main 提交后发布。' }
$runs = gh run list --workflow deploy-pages.yml --event push --commit $releaseSha --limit 1 --json databaseId,status,conclusion | ConvertFrom-Json
Assert-Exit 'read GitHub deployment'
if (-not $runs -or $runs[0].status -ne 'completed' -or $runs[0].conclusion -ne 'success') {
  throw '请先等待此提交的 GitHub Pages 检查及部署成功。'
}
$oldBasePath = $env:NEXT_PUBLIC_BASE_PATH
try {
  $env:NEXT_PUBLIC_BASE_PATH = ''
  npm run build:pages
  Assert-Exit 'Cloudflare root build'
  npx wrangler pages deploy out --project-name penguin-fantasy --branch main --commit-hash $releaseSha --commit-dirty=false
  Assert-Exit 'Cloudflare deployment'
  npm run verify:online
  Assert-Exit 'public acceptance'
} finally { $env:NEXT_PUBLIC_BASE_PATH = $oldBasePath }
