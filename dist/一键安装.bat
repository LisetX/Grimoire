@echo off
setlocal
chcp 65001 >nul 2>&1
title Grimoire
set "GRIM_SELF=%~f0"
set "GRIM_ARGS=%*"

where powershell >nul 2>&1
if errorlevel 1 (
  echo.
  echo   PowerShell not found - this script needs Windows PowerShell.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$m='#:'+'PS:#'; $s=[IO.File]::ReadAllText($env:GRIM_SELF,[Text.Encoding]::UTF8); iex $s.Substring($s.IndexOf($m)+$m.Length)"

echo.
pause
endlocal
exit /b

#:PS:#

$ErrorActionPreference = 'Stop'
$SELF = $env:GRIM_SELF
$ROOT = Split-Path -Parent $SELF
$ENTRY = '{"name":"Grimoire","status":true,"description":"Grimoire - in-game trainer","parameters":{}}'

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }

$targets = @()
foreach ($m in [regex]::Matches(('' + $env:GRIM_ARGS), '"([^"]*)"|(\S+)')) {
    $v = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
    if ($v) { $targets += $v }
}
$Remove = $false
if ($targets -contains '--remove') {
    $Remove = $true
    $targets = @($targets | Where-Object { $_ -ne '--remove' })
}

function Find-Plugin {
    $up = Split-Path $ROOT -Parent
    $dirs = @($ROOT, (Join-Path $ROOT 'dist'))
    if ($up) { $dirs += @($up, (Join-Path $up 'dist')) }
    foreach ($d in $dirs) {
        $p = Join-Path $d 'Grimoire.js'
        if (Test-Path -LiteralPath $p) { return (Resolve-Path -LiteralPath $p).Path }
    }
    return $null
}

function Get-JsDir([string]$game) {
    foreach ($base in @($game, (Join-Path $game 'www'))) {
        $js = Join-Path $base 'js'
        if (Test-Path -LiteralPath (Join-Path $js 'plugins.js')) {
            $engine = '未知'
            if (Test-Path -LiteralPath (Join-Path $js 'rmmz_core.js')) { $engine = 'MZ' }
            elseif (Test-Path -LiteralPath (Join-Path $js 'rpg_core.js')) { $engine = 'MV' }
            return [pscustomobject]@{ Js = $js; Engine = $engine }
        }
    }
    return $null
}

function Find-Games {
    $found = New-Object System.Collections.Generic.List[string]
    $seenDir = @{}
    $seenJs = @{}
    $probe = {
        param($dir)
        if (-not $dir) { return }
        try { $full = (Resolve-Path -LiteralPath $dir -ErrorAction Stop).Path } catch { return }
        if ($seenDir.ContainsKey($full)) { return }
        $seenDir[$full] = $true
        $info = Get-JsDir $full
        if (-not $info) { return }

        $key = $info.Js.ToLower()
        if ($seenJs.ContainsKey($key)) { return }
        $seenJs[$key] = $true
        $found.Add($full)
    }

    $d = $ROOT
    for ($i = 0; $i -lt 4 -and $d; $i++) {
        & $probe $d
        $d = Split-Path $d -Parent
    }

    $scan = @($ROOT)
    $up = Split-Path $ROOT -Parent
    if ($up) { $scan += $up }
    foreach ($s in $scan) {
        Get-ChildItem -LiteralPath $s -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { & $probe $_.FullName }
    }
    return $found
}

function Pick-Folder {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = '选择 RPG Maker 游戏所在的文件夹（里面有 Game.exe 或 index.html）'
        $dlg.ShowNewFolderButton = $false
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dlg.SelectedPath }
    } catch {
        Say '  无法打开文件夹选择框，请把游戏文件夹拖到这个 bat 上重试。' 'Yellow'
    }
    return $null
}

function Split-Entries([string]$body) {
    $list = New-Object System.Collections.Generic.List[string]
    $depth = 0
    $start = -1
    $inStr = $false
    $esc = $false
    for ($i = 0; $i -lt $body.Length; $i++) {
        $c = $body[$i]
        if ($inStr) {
            if ($esc) { $esc = $false }
            elseif ($c -eq '\') { $esc = $true }
            elseif ($c -eq '"') { $inStr = $false }
            continue
        }
        if ($c -eq '"') { $inStr = $true; continue }
        if ($c -eq '{') {
            if ($depth -eq 0) { $start = $i }
            $depth++
        } elseif ($c -eq '}') {
            $depth--
            if ($depth -eq 0 -and $start -ge 0) {
                $list.Add($body.Substring($start, $i - $start + 1))
                $start = -1
            }
        }
    }
    return $list
}

function Install-One([string]$game, [string]$pluginPath, [bool]$doRemove) {
    $info = Get-JsDir $game
    if (-not $info) {
        Say ('  跳过：不是 RPG Maker 游戏目录（没有 js\plugins.js）') 'Yellow'
        return $false
    }
    $jsDir = $info.Js
    $pluginsJs = Join-Path $jsDir 'plugins.js'
    $dest = Join-Path (Join-Path $jsDir 'plugins') 'Grimoire.js'
    Say ('  引擎：' + $info.Engine + '    ' + $jsDir)

    $src = [System.IO.File]::ReadAllText($pluginsJs, [System.Text.Encoding]::UTF8)
    $i = $src.IndexOf('[')
    $j = $src.LastIndexOf(']')
    if ($i -lt 0 -or $j -le $i) {
        Say '  跳过：plugins.js 里找不到插件数组，文件可能已损坏' 'Red'
        return $false
    }
    $eol = if ($src.Contains("`r`n")) { "`r`n" } else { "`n" }
    $pre = $src.Substring(0, $i)
    $post = $src.Substring($j + 1)

    $entries = @(Split-Entries $src.Substring($i + 1, $j - $i - 1))
    $mine = @($entries | Where-Object { $_ -match '"name"\s*:\s*"Grimoire"' })
    $rest = @($entries | Where-Object { $_ -notmatch '"name"\s*:\s*"Grimoire"' })

    if ($doRemove) {
        if ($mine.Count -eq 0 -and -not (Test-Path -LiteralPath $dest)) {
            Say '  未安装，无需卸载' 'Yellow'
            return $false
        }
        $final = $rest
    } else {

        $entry = if ($mine.Count) { $mine[0] -replace '"status"\s*:\s*(true|false)', '"status":true' } else { $ENTRY }
        $final = @($rest) + $entry
    }

    $bak = $pluginsJs + '.grimoire-bak'
    if (-not (Test-Path -LiteralPath $bak)) {
        Copy-Item -LiteralPath $pluginsJs -Destination $bak -Force
        Say '  已备份 plugins.js -> plugins.js.grimoire-bak'
    }

    $text = $pre + '[' + $eol + ($final -join (',' + $eol)) + $eol + ']' + $post
    [System.IO.File]::WriteAllText($pluginsJs, $text, (New-Object System.Text.UTF8Encoding($false)))

    if ($doRemove) {
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
        Say '  已卸载（plugins.js.grimoire-bak 保留）' 'Green'
        return $true
    }

    $plugDir = Split-Path $dest -Parent
    if (-not (Test-Path -LiteralPath $plugDir)) { New-Item -ItemType Directory -Path $plugDir | Out-Null }

    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
    Copy-Item -LiteralPath $pluginPath -Destination $dest -Force

    $verb = if ($mine.Count) { '已更新' } else { '已安装' }
    Say ('  ' + $verb + '：js\plugins\Grimoire.js，登记在插件列表最后一位（共 ' + $final.Count + ' 个）') 'Green'
    return $true
}

Say ''

Say '  Grimoire 安装工具' 'White'
Say '  ================================================================'

$plugin = Find-Plugin
if (-not $plugin) {
    Say '  找不到 Grimoire.js，请把它和这个 bat 放在同一个文件夹中。' 'Red'
    exit 1
}
Say ('  插件：' + $plugin)

$games = @()
if ($targets.Count) {
    foreach ($t in $targets) {
        if (Test-Path -LiteralPath $t) {

            if (-not (Get-Item -LiteralPath $t).PSIsContainer) { $t = Split-Path $t -Parent }
            $games += $t
        } else {
            Say ('  路径不存在：' + $t) 'Yellow'
        }
    }
} else {
    $found = @(Find-Games)
    if ($found.Count -eq 1) {
        $games = @($found[0])
    } elseif ($found.Count -gt 1) {
        Say ''
        Say '  找到以下游戏：' 'White'
        for ($k = 0; $k -lt $found.Count; $k++) { Say ('    [' + ($k + 1) + '] ' + $found[$k]) }
        Say ('    [0] 全部安装')
        $ans = Read-Host '  输入编号'
        if ($ans -eq '0') { $games = @($found) }
        elseif ($ans -match '^\d+$' -and [int]$ans -ge 1 -and [int]$ans -le $found.Count) { $games = @($found[[int]$ans - 1]) }
        else { Say '  未选择，已退出。' 'Yellow'; exit 1 }
    } else {
        Say '  未找到游戏，请在弹出的窗口中选择游戏文件夹…' 'Yellow'
        $pick = Pick-Folder
        if ($pick) { $games = @($pick) }
    }
}

if ($games.Count -eq 0) {
    Say ''
    Say '  没有可处理的游戏目录；也可以把游戏文件夹拖到这个 bat 上。' 'Yellow'
    exit 1
}

if (-not $Remove -and $games.Count -eq 1) {
    $info = Get-JsDir $games[0]
    if ($info) {
        $cur = [System.IO.File]::ReadAllText((Join-Path $info.Js 'plugins.js'), [System.Text.Encoding]::UTF8)
        if ($cur -match '"name"\s*:\s*"Grimoire"') {
            Say ''
            Say '  该游戏已安装 Grimoire：' 'White'
            Say '    [1] 更新到当前版本（直接回车）'
            Say '    [2] 卸载'
            $ans = Read-Host '  选择'
            if ($ans -eq '2') { $Remove = $true }
        }
    }
}

$ok = 0
foreach ($g in $games) {
    Say ''
    Say ('  ' + $g) 'White'
    try {
        if (Install-One $g $plugin $Remove) { $ok++ }
    } catch {
        Say ('  失败：' + $_.Exception.Message) 'Red'
        if ($_.Exception.Message -match '正在使用|being used|拒绝访问|denied|Access') {
            Say '  游戏可能正在运行，请关闭后重试。' 'Yellow'
        }
    }
}

Say ''
Say '  ================================================================'
if ($Remove) {
    Say ('  完成，已卸载 ' + $ok + ' 个。') 'Green'
} else {
    Say ('  完成，已安装 ' + $ok + ' 个。') 'Green'
    if ($ok -gt 0) {
        Say '  进入游戏后右上角会出现齿轮按钮，PC 上也可以按 Insert 打开面板。'
    }
}
