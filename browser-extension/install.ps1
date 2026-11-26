# Windows：打开浏览器扩展管理页
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host "扩展目录：$dir"
if ($chrome) {
  Start-Process $chrome "chrome://extensions"
  Write-Host "已打开 Chrome 扩展管理页。开启开发者模式 → 加载已解压的扩展程序 → 选择上面的目录。"
} else {
  $ff = "$env:ProgramFiles\Mozilla Firefox\firefox.exe"
  if (Test-Path $ff) {
    Start-Process $ff "about:debugging#/runtime/this-firefox"
    Write-Host "已打开 Firefox。加载临时附加组件 → 选择 $dir\manifest.json"
  } else {
    Write-Host "未找到浏览器，请手动加载目录：$dir"
  }
}
