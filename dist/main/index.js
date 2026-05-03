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
const logDir = path_1.default.join(electron_1.app.getPath('userData'), 'logs');
const logPath = path_1.default.join(logDir, 'main.log');
function log(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [info] ${msg}\n`;
    try {
        if (!fs_1.default.existsSync(logDir)) {
            fs_1.default.mkdirSync(logDir, { recursive: true });
        }
        fs_1.default.appendFileSync(logPath, line);
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
                { role: 'toggleDevTools', label: '开发者工具' },
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
        log('Loading dev URL: http://localhost:5173');
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        const htmlPath = path_1.default.join(__dirname, '../renderer/index.html');
        log(`Loading production file: ${htmlPath}`);
        log(`File exists: ${fs_1.default.existsSync(htmlPath)}`);
        mainWindow.loadFile(htmlPath);
        mainWindow.webContents.on('dom-ready', () => {
            log('DOM ready, opening dev tools');
            mainWindow?.webContents.openDevTools({ mode: 'detach' });
        });
    }
    mainWindow.webContents.on('did-finish-load', () => {
        log('Window finished loading');
    });
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        log(`Window failed to load: ${errorCode} - ${errorDescription}`);
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    log('Window created');
}
electron_1.app.whenReady().then(async () => {
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
