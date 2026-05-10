# Server Patch — Start-PKScriptsServer.ps1 v29

## What needs to change

Three new endpoints + update existing /export/incoming path structure.

---

## 1. Update pk:meta block

Change:
  v:       28
  updated: 2026.05.08-000000
  delta:   v28 ...

To:
  v:       29
  updated: 2026.05.10-000000
  delta:   v29 — /export/incoming: new path structure accountSlug\projectSlug\chatSlug\;
                  /export/session-log: writes bulk session log at accountSlug level;
                  /export/project-home: writes project.json to projectSlug level;
                  /export/incoming: artifactFiles now flat in chat folder (no artifacts\ subfolder);

Also update banner (v28 → v29) and /health version field.
Run Set-PKServerVersion.ps1 -Version 29 after applying.

---

## 2. Replace /export/incoming handler

Find and replace the entire "POST /export/incoming" handler block.
Replace the path construction logic with:

```powershell
        if ($method -eq "POST" -and $path -eq "/export/incoming") {
            $requestBody = Read-PkRequestBody -Context $ctx
            if (-not $requestBody) {
                Send-PkJsonResponse -Context $ctx -Body @{ error = "Body required" } -StatusCode 400; continue
            }

            $projectFolder  = if ($requestBody.PSObject.Properties['projectFolder']  -and $requestBody.projectFolder)  { $requestBody.projectFolder  } else { "" }
            $accountSlug    = if ($requestBody.PSObject.Properties['accountSlug']     -and $requestBody.accountSlug)    { $requestBody.accountSlug    } else { "unknown" }
            $rawChatSlug    = if ($requestBody.PSObject.Properties['chatSlug']        -and $requestBody.chatSlug)       { $requestBody.chatSlug       } else { "" }
            $exportPayload  = if ($requestBody.PSObject.Properties['exportPayload'])                                    { $requestBody.exportPayload  } else { $null }
            $imageAssetList = if ($requestBody.PSObject.Properties['imageAssets']     -and $requestBody.imageAssets)   { @($requestBody.imageAssets) } else { @() }
            $artifactList   = if ($requestBody.PSObject.Properties['artifactFiles']   -and $requestBody.artifactFiles) { @($requestBody.artifactFiles) } else { @() }

            if (-not $projectFolder)  { Send-PkJsonResponse -Context $ctx -Body @{ error = "projectFolder required" }  -StatusCode 400; continue }
            if (-not $rawChatSlug)    { Send-PkJsonResponse -Context $ctx -Body @{ error = "chatSlug required" }        -StatusCode 400; continue }
            if (-not $exportPayload)  { Send-PkJsonResponse -Context $ctx -Body @{ error = "exportPayload required" }   -StatusCode 400; continue }

            # Validate projectFolder against registry (prevents path traversal)
            $allProjects = Get-PkProjectList -ConfigPath $ConfigPath
            $matched = $allProjects | Where-Object {
                $_.PSObject.Properties['folder'] -and $_.folder -eq $projectFolder
            } | Select-Object -First 1
            if (-not $matched) {
                Send-PkJsonResponse -Context $ctx -Body @{ error = "Unknown project folder: $projectFolder" } -StatusCode 400; continue
            }

            # Sanitize slugs
            $safeAccount = ($accountSlug  -replace '[^a-z0-9A-Z_\-]', '_').Substring(0, [Math]::Min($accountSlug.Length, 40))
            $safeChatSlug = ($rawChatSlug -replace '[^a-z0-9\-_]', '').Substring(0, [Math]::Min($rawChatSlug.Length, 80))
            if (-not $safeChatSlug) { $safeChatSlug = 'untitled' }

            # Derive projectSlug from claudeai_project_name in payload
            $claudeProjectName = ""
            try {
                if ($exportPayload.PSObject.Properties['piqpull_meta'] -and
                    $exportPayload.piqpull_meta.PSObject.Properties['claudeai_project_name'] -and
                    $exportPayload.piqpull_meta.claudeai_project_name) {
                    $claudeProjectName = $exportPayload.piqpull_meta.claudeai_project_name
                }
            } catch { }

            $projectSlug = if ($claudeProjectName) {
                $claudeProjectName.ToLower() -replace '[^a-z0-9]+', '-' -replace '^-|-$', ''
            } else {
                '_no-project'
            }
            if ($projectSlug.Length -gt 60) { $projectSlug = $projectSlug.Substring(0, 60) }
            if (-not $projectSlug) { $projectSlug = '_no-project' }

            try {
                $downloadsBase = Join-Path (Split-Path $RootPath -Parent) 'PiQuixRootDownloads'
                $incomingBase  = Join-Path $downloadsBase 'incoming'
                $chatFolder    = Join-Path $incomingBase "PiQPull\$safeAccount\$projectSlug\$safeChatSlug"

                # Create full directory tree (idempotent)
                if (-not (Test-Path $chatFolder)) {
                    New-Item -ItemType Directory -Path $chatFolder -Force | Out-Null
                }

                # Timestamped JSON filename — accumulate, never overwrite
                $ts          = Get-Date -Format 'yyyy.MM.dd-HHmmss'
                $jsonName    = "chat_${ts}.json"
                $jsonPath    = Join-Path $chatFolder $jsonName
                $collision   = 0
                while (Test-Path $jsonPath) {
                    $collision++
                    $jsonPath = Join-Path $chatFolder "chat_${ts}_$('{0:D3}' -f $collision).json"
                    $jsonName = Split-Path $jsonPath -Leaf
                }

                # Write JSON
                $jsonContent = $exportPayload | ConvertTo-Json -Depth 20
                [System.IO.File]::WriteAllText($jsonPath, $jsonContent, [System.Text.UTF8Encoding]::new($false))

                # Write image assets FLAT in chat folder (no assets\ subfolder)
                $writtenImages = [System.Collections.Generic.List[hashtable]]::new()
                foreach ($asset in $imageAssetList) {
                    $fname   = if ($asset.PSObject.Properties['asset_filename']) { $asset.asset_filename } else { $null }
                    $b64data = if ($asset.PSObject.Properties['data_base64'])    { $asset.data_base64    } else { $null }
                    if (-not $fname -or -not $b64data) { continue }
                    $safeFname = [System.IO.Path]::GetFileName($fname)
                    $assetPath = Join-Path $chatFolder $safeFname
                    try {
                        $bytes = [Convert]::FromBase64String($b64data)
                        [System.IO.File]::WriteAllBytes($assetPath, $bytes)
                        $writtenImages.Add(@{ filename = $safeFname; sizeBytes = $bytes.Length })
                    } catch {
                        $writtenImages.Add(@{ filename = $safeFname; error = $_.ToString() })
                    }
                }

                # Write artifact files FLAT in chat folder (no artifacts\ subfolder)
                $writtenArtifacts = [System.Collections.Generic.List[hashtable]]::new()
                foreach ($art in $artifactList) {
                    $fname   = if ($art.PSObject.Properties['filename']) { $art.filename } else { $null }
                    $content = if ($art.PSObject.Properties['content'])  { $art.content  } else { $null }
                    if (-not $fname -or $null -eq $content) { continue }
                    $safeFname  = [System.IO.Path]::GetFileName($fname)
                    $artPath    = Join-Path $chatFolder $safeFname
                    try {
                        [System.IO.File]::WriteAllText($artPath, $content, [System.Text.UTF8Encoding]::new($false))
                        $writtenArtifacts.Add(@{ filename = $safeFname; sizeChars = $content.Length })
                    } catch {
                        $writtenArtifacts.Add(@{ filename = $safeFname; error = $_.ToString() })
                    }
                }

                # Open Explorer (non-blocking)
                Start-Process explorer.exe -ArgumentList "`"$chatFolder`"" -ErrorAction SilentlyContinue

                Send-PkJsonResponse -Context $ctx -Body @{
                    ok            = $true
                    jsonFilename  = $jsonName
                    jsonPath      = $jsonPath
                    chatFolder    = $chatFolder
                    imageCount    = $writtenImages.Count
                    artifactCount = $writtenArtifacts.Count
                    images        = $writtenImages.ToArray()
                    artifacts     = $writtenArtifacts.ToArray()
                }
            }
            catch {
                Send-PkJsonResponse -Context $ctx -Body @{ error = $_.ToString() } -StatusCode 500
            }
            continue
        }
```

---

## 3. Add /export/session-log handler (insert before the 404 catch-all)

```powershell
        # POST /export/session-log
        # Writes a bulk session log to account level in incoming tree.
        # Path: PiQuixRootDownloads\incoming\PiQPull\{accountSlug}\session_log_{timestamp}.txt
        # Body: { accountSlug, projectFolder, timestamp, logContent }
        if ($method -eq "POST" -and $path -eq "/export/session-log") {
            $body = Read-PkRequestBody -Context $ctx
            if (-not $body) { Send-PkJsonResponse -Context $ctx -Body @{ error = "Body required" } -StatusCode 400; continue }

            $acct      = if ($body.PSObject.Properties['accountSlug']   -and $body.accountSlug)   { $body.accountSlug   } else { "unknown" }
            $proj      = if ($body.PSObject.Properties['projectFolder'] -and $body.projectFolder) { $body.projectFolder } else { "_no-project" }
            $ts        = if ($body.PSObject.Properties['timestamp']     -and $body.timestamp)     { $body.timestamp     } else { (Get-Date -Format 'yyyy.MM.dd-HHmmss') }
            $logText   = if ($body.PSObject.Properties['logContent']    -and $body.logContent)    { $body.logContent    } else { "" }

            $safeAcct  = ($acct -replace '[^a-z0-9A-Z_\-]', '_').Substring(0, [Math]::Min($acct.Length, 40))
            $safeProj  = ($proj -replace '[^a-z0-9A-Z_\-]', '_').Substring(0, [Math]::Min($proj.Length, 40))
            $safeTs    = ($ts   -replace '[^0-9\.\-]', '').Substring(0, [Math]::Min($ts.Length, 20))

            try {
                $downloadsBase = Join-Path (Split-Path $RootPath -Parent) 'PiQuixRootDownloads'
                $accountDir    = Join-Path $downloadsBase "incoming\PiQPull\$safeAcct"

                if (-not (Test-Path $accountDir)) {
                    New-Item -ItemType Directory -Path $accountDir -Force | Out-Null
                }

                $logFilename = "session_log_${safeProj}_${safeTs}.txt"
                $logPath     = Join-Path $accountDir $logFilename

                [System.IO.File]::WriteAllText($logPath, $logText, [System.Text.UTF8Encoding]::new($false))

                Send-PkJsonResponse -Context $ctx -Body @{
                    ok       = $true
                    logPath  = $logPath
                    filename = $logFilename
                    bytes    = $logText.Length
                }
            }
            catch {
                Send-PkJsonResponse -Context $ctx -Body @{ error = $_.ToString() } -StatusCode 500
            }
            continue
        }
```

---

## 4. Add /export/project-home handler (insert before session-log)

```powershell
        # POST /export/project-home
        # Writes project metadata + knowledge files JSON to project-level folder.
        # Path: PiQuixRootDownloads\incoming\PiQPull\{accountSlug}\{projectSlug}\project.json
        # Body: { accountSlug, projectFolder, payload }
        if ($method -eq "POST" -and $path -eq "/export/project-home") {
            $body = Read-PkRequestBody -Context $ctx
            if (-not $body) { Send-PkJsonResponse -Context $ctx -Body @{ error = "Body required" } -StatusCode 400; continue }

            $acct    = if ($body.PSObject.Properties['accountSlug']   -and $body.accountSlug)   { $body.accountSlug   } else { "unknown" }
            $proj    = if ($body.PSObject.Properties['projectFolder'] -and $body.projectFolder) { $body.projectFolder } else { "unknown" }
            $payload = if ($body.PSObject.Properties['payload']       -and $body.payload)       { $body.payload       } else { $null }

            if (-not $payload) { Send-PkJsonResponse -Context $ctx -Body @{ error = "payload required" } -StatusCode 400; continue }

            # Derive projectSlug from payload
            $projectSlug = "_no-project"
            try {
                $meta = $payload.PSObject.Properties['piqpull_project_meta']
                if ($meta -and $meta.Value.PSObject.Properties['project_slug'] -and $meta.Value.project_slug) {
                    $projectSlug = $meta.Value.project_slug -replace '[^a-z0-9\-]', '-'
                }
            } catch { }

            $safeAcct  = ($acct -replace '[^a-z0-9A-Z_\-]', '_').Substring(0, [Math]::Min($acct.Length, 40))
            $safeSlug  = $projectSlug.Substring(0, [Math]::Min($projectSlug.Length, 60))
            if (-not $safeSlug) { $safeSlug = '_no-project' }

            try {
                $downloadsBase = Join-Path (Split-Path $RootPath -Parent) 'PiQuixRootDownloads'
                $projDir       = Join-Path $downloadsBase "incoming\PiQPull\$safeAcct\$safeSlug"

                if (-not (Test-Path $projDir)) {
                    New-Item -ItemType Directory -Path $projDir -Force | Out-Null
                }

                $jsonPath    = Join-Path $projDir "project.json"
                $jsonContent = $payload | ConvertTo-Json -Depth 20
                [System.IO.File]::WriteAllText($jsonPath, $jsonContent, [System.Text.UTF8Encoding]::new($false))

                Start-Process explorer.exe -ArgumentList "`"$projDir`"" -ErrorAction SilentlyContinue

                Send-PkJsonResponse -Context $ctx -Body @{
                    ok        = $true
                    jsonPath  = $jsonPath
                    projDir   = $projDir
                }
            }
            catch {
                Send-PkJsonResponse -Context $ctx -Body @{ error = $_.ToString() } -StatusCode 500
            }
            continue
        }
```

---

## Resulting folder structure

```
PiQuixRootDownloads\incoming\PiQPull\
  CandisMan\
    session_log_PiQPull_2026.05.10-143022.txt   ← one per bulk session
    test-download-project\
      testing-custom-extension-for-project-file-downloads\
        chat_2026.05.10-143022.json
        Sample.md                               ← artifact, flat
        img_001_2026.05.10-143022.png           ← image, flat
      project.json                              ← project home page export
```

---

## Run after applying

```powershell
.\PiQScripts\AdHoc\Set-PKServerVersion.ps1 -Version 29
# Then restart the server:
# Stop existing instance (Ctrl+C in its terminal)
.\PiQScripts\Session\Start-PKScriptsServer.ps1
```
