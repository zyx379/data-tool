# 构建并运行 Electron 应用

Write-Host "=== Building Electron App ===" -ForegroundColor Cyan

# 设置工作目录
$projectDir = "d:\aiCode\progaid\data-tool"
Set-Location $projectDir

# 查找 Node.js
$nodePaths = @(
    "C:\Program Files\nodejs\node.exe",
    "$env:APPDATA\npm\node.exe",
    "C:\Users\$env:USERNAME\AppData\Roaming\npm\node.exe"
)

$nodeExe = $null
foreach ($path in $nodePaths) {
    if (Test-Path $path) {
        $nodeExe = $path
        break
    }
}

if (-not $nodeExe) {
    Write-Host "Node.js not found in common locations" -ForegroundColor Red
    Write-Host "Please install Node.js or add it to PATH" -ForegroundColor Yellow
    exit 1
}

Write-Host "Using Node.js: $nodeExe" -ForegroundColor Green

# 查找 npm
$npmExe = [System.IO.Path]::ChangeExtension($nodeExe, "npm.cmd")
if (-not (Test-Path $npmExe)) {
    $npmExe = Join-Path (Split-Path $nodeExe) "npm.cmd"
}

if (Test-Path $npmExe) {
    Write-Host "Using npm: $npmExe" -ForegroundColor Green
    
    # 安装依赖(如果需要)
    if (-not (Test-Path "node_modules\ioredis")) {
        Write-Host "Installing ioredis..." -ForegroundColor Yellow
        & $npmExe install ioredis @types/ioredis
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Failed to install ioredis" -ForegroundColor Red
            exit 1
        }
    }
    
    # 构建项目
    Write-Host "Building project..." -ForegroundColor Yellow
    & $npmExe run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Build successful!" -ForegroundColor Green
    
    # 查找 Electron
    $electronExe = Join-Path $projectDir "node_modules\electron\dist\electron.exe"
    if (Test-Path $electronExe) {
        Write-Host "Starting Electron app..." -ForegroundColor Cyan
        & $electronExe .
    } else {
        Write-Host "Electron not found. Please install it:" -ForegroundColor Yellow
        Write-Host "  $npmExe install electron" -ForegroundColor Gray
    }
} else {
    Write-Host "npm not found" -ForegroundColor Red
    exit 1
}
