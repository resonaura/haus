# Haus — A thoughtful home.
# Copyright © 2026 Andrii Vynohradov. All rights reserved.
# Licensed under the GNU General Public License v3.0 or later; see LICENSE.
# SPDX-License-Identifier: GPL-3.0-or-later.

<#
.SYNOPSIS
  Configure Windows networking, Firewall, portproxy (NAT fallback), and headless
  WSL2 startup tasks for a Haus Hub running inside Windows Subsystem for Linux.
.EXAMPLE
  .\apps\hub\install\wsl-windows.ps1 -Action SetupMirrored -Distro Ubuntu -Port 8790 -RegisterStartupTask
.EXAMPLE
  .\apps\hub\install\wsl-windows.ps1 -Action SetupNat -Distro Ubuntu -Port 8790 -RegisterStartupTask
#>

[CmdletBinding()]
param(
  [ValidateSet('Status', 'SetupMirrored', 'SetupNat', 'RefreshPortProxy', 'Remove')]
  [string]$Action = 'Status',

  [string]$Distro = '',

  [ValidateRange(1, 65535)]
  [int]$Port = 8790,

  [ValidateRange(1, 65535)]
  [int]$NvrPort = 8098,

  [ValidateRange(1, 65535)]
  [int]$MqttPort = 1883,

  [ValidateRange(1, 65535)]
  [int]$RelayPort = 8791,

  [string]$WslIp = '',
  [switch]$IncludeNvr,
  [switch]$IncludeHomeKit,
  [switch]$RegisterStartupTask,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Administrator {
  if (-not $DryRun -and -not (Test-IsAdministrator)) {
    throw "Action '$Action' requires an elevated PowerShell prompt (Run as Administrator)."
  }
}

function Get-DefaultWslDistro {
  if ($Distro -and $Distro.Trim()) { return $Distro.Trim() }
  $raw = (& wsl.exe -l -q 2>$null | Out-String) -replace "`0", ''
  foreach ($line in ($raw -split "`r?`n")) {
    $clean = $line.Trim()
    if ($clean -and $clean -notlike 'docker-desktop*') { return $clean }
  }
  return 'Ubuntu'
}

function Get-WindowsLanIpv4 {
  $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1
  if (-not $route) { return $null }
  $addr = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } |
    Select-Object -First 1
  if ($addr) { return $addr.IPAddress }
  return $null
}

function Get-WslDistroIpv4 {
  param([string]$TargetDistro)
  if ($WslIp -and $WslIp -match '^\d+\.\d+\.\d+\.\d+$') { return $WslIp }
  $cmd = "ip -4 -o addr show dev eth0 2>/dev/null | awk '{print `$4}' | cut -d/ -f1"
  $ip = ((& wsl.exe -d $TargetDistro -- /bin/sh -c $cmd 2>$null | Out-String) -split '\s+' |
    Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' -and $_ -notlike '127.*' } | Select-Object -First 1)
  if (-not $ip) {
    $fallback = (& wsl.exe -d $TargetDistro -- hostname -I 2>$null | Out-String)
    $ip = ($fallback -split '\s+' | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' -and $_ -notlike '127.*' } | Select-Object -First 1)
  }
  return $ip
}

function Set-IniSectionKeysNoBom {
  param(
    [string]$Path,
    [string]$Section,
    [hashtable]$Updates
  )
  $existing = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Raw } else { '' }
  $lines = if ($existing) { @($existing -split "`r?`n") } else { @() }
  while ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') {
    $lines = if ($lines.Count -gt 1) { $lines[0..($lines.Count - 2)] } else { @() }
  }

  $pending = @{}
  foreach ($k in $Updates.Keys) { $pending[$k.ToLowerInvariant()] = @{ Key = $k; Value = $Updates[$k] } }

  $out = New-Object System.Collections.Generic.List[string]
  $inTarget = $false
  $foundTarget = $false
  $insertAt = -1

  foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if ($trimmed -match '^\[([^\]]+)\]$') {
      if ($inTarget -and $pending.Count -gt 0) {
        foreach ($item in $pending.Values) { $out.Add("$($item.Key)=$($item.Value)") }
        $pending.Clear()
      }
      $inTarget = ($Matches[1].Trim().ToLowerInvariant() -eq $Section.ToLowerInvariant())
      if ($inTarget) { $foundTarget = $true }
      $out.Add($line)
      if ($inTarget) { $insertAt = $out.Count }
      continue
    }
    if ($inTarget -and $trimmed -and -not $trimmed.StartsWith('#') -and -not $trimmed.StartsWith(';')) {
      $eq = $trimmed.IndexOf('=')
      if ($eq -gt 0) {
        $keyLower = $trimmed.Substring(0, $eq).Trim().ToLowerInvariant()
        if ($pending.ContainsKey($keyLower)) {
          $entry = $pending[$keyLower]
          $out.Add("$($entry.Key)=$($entry.Value)")
          $pending.Remove($keyLower)
          $insertAt = $out.Count
          continue
        }
      }
    }
    $out.Add($line)
    if ($inTarget -and $trimmed -ne '') { $insertAt = $out.Count }
  }

  if ($foundTarget -and $pending.Count -gt 0) {
    $idx = if ($insertAt -ge 0) { $insertAt } else { $out.Count }
    foreach ($item in $pending.Values) {
      $out.Insert($idx, "$($item.Key)=$($item.Value)")
      $idx++
    }
  } elseif (-not $foundTarget) {
    if ($out.Count -gt 0) { $out.Add('') }
    $out.Add("[$Section]")
    foreach ($item in $pending.Values) { $out.Add("$($item.Key)=$($item.Value)") }
  }

  $content = ($out -join "`r`n") + "`r`n"
  if ($DryRun) {
    Write-Host "[DryRun] Would write $Path`:`n$content"
    return
  }
  if (Test-Path -LiteralPath $Path) {
    Copy-Item -LiteralPath $Path -Destination "$Path.bak.$(Get-Date -Format 'yyyyMMddHHmmss')" -Force
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $content, $utf8NoBom)
  Write-Host "Updated $Path"
}

function Set-HausFirewallRule {
  param(
    [string]$DisplayName,
    [string]$Protocol,
    [string]$LocalPort
  )
  if ($DryRun) {
    Write-Host "[DryRun] Would ensure firewall rule '$DisplayName' ($Protocol $LocalPort)"
    return
  }
  Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $DisplayName -Direction Inbound -Action Allow -Protocol $Protocol -LocalPort $LocalPort -Profile Private | Out-Null
}

function Configure-HausFirewall {
  Set-HausFirewallRule -DisplayName "Haus Hub API (TCP $Port)" -Protocol 'TCP' -LocalPort "$Port"
  Set-HausFirewallRule -DisplayName 'Haus Hub mDNS (UDP 5353)' -Protocol 'UDP' -LocalPort '5353'
  Set-HausFirewallRule -DisplayName "Haus Hub MQTT (TCP $MqttPort)" -Protocol 'TCP' -LocalPort "$MqttPort"
  if ($IncludeHomeKit) {
    Set-HausFirewallRule -DisplayName 'Haus Hub HomeKit (TCP 51828)' -Protocol 'TCP' -LocalPort '51828'
  }
  if ($IncludeNvr) {
    Set-HausFirewallRule -DisplayName "Haus Hub NVR API (TCP $NvrPort)" -Protocol 'TCP' -LocalPort "$NvrPort"
    Set-HausFirewallRule -DisplayName 'Haus Hub NVR WebRTC/RTSP (UDP 8555-8631)' -Protocol 'UDP' -LocalPort '8555-8631'
  }
  Write-Host 'Configured Windows Defender Firewall inbound rules (Private profile).'
}

function Update-PortProxyRule {
  param([int]$ListenPort, [string]$TargetIp)
  if ($DryRun) {
    Write-Host "[DryRun] netsh interface portproxy v4tov4 0.0.0.0:$ListenPort -> ${TargetIp}:$ListenPort"
    return
  }
  & netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$ListenPort | Out-Null
  & netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$ListenPort connectaddress=$TargetIp connectport=$ListenPort | Out-Null
}

function Register-WslKeepaliveTask {
  param([string]$TargetDistro)
  $taskName = "Haus-WSL-Keepalive-$TargetDistro"
  $userId = "$env:USERDOMAIN\$env:USERNAME"
  if ($DryRun) {
    Write-Host "[DryRun] Would register logon task '$taskName' for $userId running distro '$TargetDistro'"
    return
  }
  # WSL distros live in per-user HKCU registry; task must run under the user's account, not SYSTEM.
  $taskAction = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "-d $TargetDistro -u root -- /bin/sh -c `"exec sleep infinity`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Settings $settings -User $userId -RunLevel Highest -Force | Out-Null
  Write-Host "Registered Scheduled Task '$taskName' (keeps WSL2 + systemd alive after login without an open terminal)."
}

$targetDistro = Get-DefaultWslDistro
$wslConfigPath = Join-Path $env:USERPROFILE '.wslconfig'
$lanIp = Get-WindowsLanIpv4

switch ($Action) {
  'Status' {
    $currentWslIp = Get-WslDistroIpv4 -TargetDistro $targetDistro
    Write-Host "Haus WSL2 Windows Status"
    Write-Host "  Target distro:    $targetDistro"
    Write-Host "  WSL IPv4:         $(if ($currentWslIp) { $currentWslIp } else { 'unavailable (distro stopped)' })"
    Write-Host "  Windows LAN IPv4: $(if ($lanIp) { $lanIp } else { 'not found' })"
    Write-Host "  .wslconfig path:  $wslConfigPath (exists=$(Test-Path -LiteralPath $wslConfigPath))"
    if (Test-Path -LiteralPath $wslConfigPath) {
      Write-Host "--- .wslconfig ---"
      Get-Content -LiteralPath $wslConfigPath | ForEach-Object { Write-Host "  $_" }
    }
    Write-Host "--- netsh portproxy ---"
    & netsh interface portproxy show v4tov4
    Write-Host "--- Haus firewall rules ---"
    Get-NetFirewallRule -DisplayName 'Haus Hub*' -ErrorAction SilentlyContinue | Format-Table DisplayName, Enabled, Profile, Action -AutoSize
  }

  'SetupMirrored' {
    Assert-Administrator
    Set-IniSectionKeysNoBom -Path $wslConfigPath -Section 'wsl2' -Updates @{
      networkingMode = 'mirrored'
      hostAddressLoopback = 'true'
      dnsTunneling = 'true'
    }
    Configure-HausFirewall
    if ($RegisterStartupTask) {
      Register-WslKeepaliveTask -TargetDistro $targetDistro
    }
    Write-Host ''
    Write-Host "Next steps:"
    Write-Host "  1. Run 'wsl --shutdown' once to apply .wslconfig mirrored networking."
    Write-Host "  2. Launch distro ($targetDistro) or log back in if startup task was registered."
    if ($lanIp) { Write-Host "  3. Connect Haus Desktop / Mobile to http://${lanIp}:$Port" }
  }

  { $_ -in @('SetupNat', 'RefreshPortProxy') } {
    Assert-Administrator
    $resolvedWslIp = Get-WslDistroIpv4 -TargetDistro $targetDistro
    if (-not $resolvedWslIp) {
      throw "Could not determine IPv4 address for WSL distro '$targetDistro'. Start WSL or pass -WslIp."
    }
    Update-PortProxyRule -ListenPort $Port -TargetIp $resolvedWslIp
    if ($IncludeNvr) {
      Update-PortProxyRule -ListenPort $NvrPort -TargetIp $resolvedWslIp
    }
    if ($IncludeHomeKit) {
      Update-PortProxyRule -ListenPort 51828 -TargetIp $resolvedWslIp
    }
    if ($Action -eq 'SetupNat') {
      Configure-HausFirewall
      Set-HausFirewallRule -DisplayName "Haus LAN Relay (TCP $RelayPort)" -Protocol 'TCP' -LocalPort "$RelayPort"
      if ($RegisterStartupTask) {
        Register-WslKeepaliveTask -TargetDistro $targetDistro
      }
    }
    Write-Host "Forwarded Windows 0.0.0.0:$Port -> ${resolvedWslIp}:$Port"
    if ($lanIp) { Write-Host "Connect Haus Desktop / Mobile to http://${lanIp}:$Port" }
  }

  'Remove' {
    Assert-Administrator
    if (-not $DryRun) {
      & netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$Port | Out-Null
      if ($IncludeNvr) {
        & netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$NvrPort | Out-Null
      }
      Get-NetFirewallRule -DisplayName 'Haus *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName "Haus-WSL-Keepalive-$targetDistro" -Confirm:$false -ErrorAction SilentlyContinue
    }
    Write-Host "Removed Haus portproxy, firewall rules, and startup task for '$targetDistro'."
  }
}
