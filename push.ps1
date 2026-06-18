# ============================================================
# VERA - push.ps1
# Pushes code to Google Apps Script AND GitHub in one step
# Run from: C:\Users\Ahmed\Documents\GitHub\VERA-My-Chief-of-Staff
# ============================================================

# Always run from the repo root, regardless of where the script is called from
Set-Location $PSScriptRoot

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  VERA Push' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

# ---- Step 0: Compile dashboard JSX → plain JS -----------------------------
Write-Host '[0/2] Compiling dashboard (JSX → JS)...' -ForegroundColor Yellow

# Only recompile if index.html is newer than _app.js
$indexHtml = 'docs\index.html'
$appJs     = 'docs\_app.js'
$appJsx    = 'docs\_app.jsx'

# Extract JSX from index.html into _app.jsx
node -e "
const fs = require('fs');
const html = fs.readFileSync('$indexHtml', 'utf-8');
const match = html.match(/<script type=\"text\/babel\">([\s\S]*?)<\/script>\s*<\/body>/);
if (match) { fs.writeFileSync('$appJsx', match[1], 'utf-8'); process.exit(0); }
else { console.error('No <script type=text/babel> found in index.html'); process.exit(1); }
"

if ($LASTEXITCODE -ne 0) {
    Write-Host 'ERROR: Could not extract JSX from index.html.' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}

babel "$appJsx" -o "$appJs"

if ($LASTEXITCODE -ne 0) {
    Write-Host 'ERROR: Babel compile failed.' -ForegroundColor Red
    Write-Host 'Make sure Babel is installed: npm install -g @babel/core @babel/cli @babel/plugin-transform-react-jsx' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}

Remove-Item $appJsx -ErrorAction SilentlyContinue
Write-Host 'Dashboard compiled.' -ForegroundColor Green
Write-Host ''

# ---- Step 1: Push to Google Apps Script via clasp --------------------------
Write-Host '[1/2] Pushing to Google Apps Script...' -ForegroundColor Yellow

npx clasp push

if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'ERROR: clasp push failed (exit code ' + $LASTEXITCODE + ').' -ForegroundColor Red
    Write-Host 'Common causes:' -ForegroundColor Red
    Write-Host '  - Not logged in: run clasp login first' -ForegroundColor Red
    Write-Host '  - clasp not installed: run npm install -g @google/clasp first' -ForegroundColor Red
    Write-Host ''
    Read-Host 'Press Enter to exit'
    exit 1
}

Write-Host 'Deploying new version to live web app...' -ForegroundColor Yellow
npx clasp deploy --deploymentId AKfycbx2GF3nKQvCoXT1TJiB9WuQwnuifK9oS-yoKsUHMKajvfM_rCYWNZpVwdX-Hp3ckXR9 --description "Auto-deployed" 2>&1 | Out-Host

Write-Host 'Apps Script: done.' -ForegroundColor Green
Write-Host ''

# ---- Step 2: Push to GitHub ------------------------------------------------
Write-Host '[2/2] Pushing to GitHub...' -ForegroundColor Yellow

# Check if there are any changes to commit
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Host ''
    Write-Host 'Changed files:' -ForegroundColor Gray
    git status --short
    Write-Host ''

    $commitMsg = Read-Host 'Commit message (press Enter to use "update")'
    if (-not $commitMsg) {
        $commitMsg = 'update'
    }

    git add -A
    git commit -m $commitMsg

    if ($LASTEXITCODE -ne 0) {
        Write-Host 'ERROR: git commit failed.' -ForegroundColor Red
        Read-Host 'Press Enter to exit'
        exit 1
    }
} else {
    Write-Host 'No local changes to commit - pushing existing commits.' -ForegroundColor Gray
}

git push

if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'ERROR: git push failed.' -ForegroundColor Red
    Write-Host 'Try running: git push --set-upstream origin main' -ForegroundColor Red
    Write-Host ''
    Read-Host 'Press Enter to exit'
    exit 1
}

Write-Host 'GitHub: done.' -ForegroundColor Green
Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  All done! Code is live.' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''
