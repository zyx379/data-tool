"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const sqlite_1 = require("./database/sqlite");
const handlers_1 = require("./ipc/handlers");
let logDir;
let logPath;
function log(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [info] ${msg}\n`;
    try {
        if (logDir && !fs_1.default.existsSync(logDir)) {
            fs_1.default.mkdirSync(logDir, { recursive: true });
        }
        if (logPath) {
            fs_1.default.appendFileSync(logPath, line);
        }
    }
    catch (e) {
        console.error('Failed to write log:', e);
    }
    console.log(msg);
}
let mainWindow = null;
function createMenu() {
    const template = [
        {
            label: '文件',
            submenu: [
                { role: 'quit', label: '退出' }
            ]
        },
        {
            label: '视图',
            submenu: [
                { role: 'reload', label: '刷新' },
                { label: '开发者工具', click: () => {
                        if (mainWindow) {
                            if (mainWindow.webContents.isDevToolsOpened()) {
                                mainWindow.webContents.closeDevTools();
                            }
                            else {
                                mainWindow.webContents.openDevTools({ mode: 'detach' });
                            }
                        }
                    } },
                { type: 'separator' },
                { role: 'togglefullscreen', label: '全屏' }
            ]
        },
        {
            label: '帮助',
            submenu: [
                {
                    label: '关于',
                    click: () => {
                        const { dialog } = require('electron');
                        dialog.showMessageBox({
                            type: 'info',
                            title: '关于',
                            message: 'zoehis-helper v1.0'
                        });
                    }
                }
            ]
        }
    ];
    const menu = electron_1.Menu.buildFromTemplate(template);
    electron_1.Menu.setApplicationMenu(menu);
}
function createWindow() {
    log('Creating window...');
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        title: 'zoehis-helper',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            devTools: true,
        },
    });
    const appPath = electron_1.app.getAppPath();
    log(`App path: ${appPath}`);
    log(`App isPackaged: ${electron_1.app.isPackaged}`);
    const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
    log(`Is development: ${isDev}`);
    if (isDev) {
        // 尝试的端口列表
        const devPorts = [5173, 5174, 5175, 5176, 5177];
        let currentPortIndex = 0;
        const tryLoadDevUrl = () => {
            if (currentPortIndex >= devPorts.length) {
                log('所有开发端口都尝试失败，请检查Vite服务是否运行');
                return;
            }
            const port = devPorts[currentPortIndex];
            const devUrl = `http://localhost:${port}`;
            log(`尝试加载开发URL: ${devUrl}`);
            mainWindow.loadURL(devUrl);
        };
        // 设置失败重试逻辑
        mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            log(`窗口加载失败: ${errorCode} - ${errorDescription}`);
            // 如果是开发环境且加载的是开发URL，尝试下一个端口
            if (isDev) {
                currentPortIndex++;
                if (currentPortIndex < devPorts.length) {
                    log(`尝试下一个端口...`);
                    setTimeout(tryLoadDevUrl, 100); // 稍等再试
                }
                else {
                    log(`所有开发端口都尝试失败，请确保Vite服务正在运行`);
                }
            }
        });
        // 首次尝试加载
        tryLoadDevUrl();
    }
    else {
        const htmlPath = path_1.default.join(__dirname, '../renderer/index.html');
        log(`加载生产文件: ${htmlPath}`);
        log(`文件存在: ${fs_1.default.existsSync(htmlPath)}`);
        mainWindow.loadFile(htmlPath);
    }
    mainWindow.webContents.on('did-finish-load', () => {
        log('窗口加载完成');
        if (isDev) {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    log('Window created');
}
electron_1.app.whenReady().then(async () => {
    logDir = path_1.default.join(electron_1.app.getPath('userData'), 'logs');
    logPath = path_1.default.join(logDir, 'main.log');
    log('App ready');
    createMenu();
    try {
        await (0, sqlite_1.initDatabase)();
        log('Database initialized');
    }
    catch (error) {
        log(`Failed to initialize database: ${error}`);
        electron_1.app.exit(1);
    }
    (0, handlers_1.registerIpcHandlers)();
    log('IPC handlers registered');
    createWindow();
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        (0, sqlite_1.closeDatabase)();
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    (0, sqlite_1.closeDatabase)();
});
