import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { initDatabase, closeDatabase } from './database/sqlite';
import { registerIpcHandlers } from './ipc/handlers';

let logDir: string;
let logPath: string;

function log(msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [info] ${msg}\n`;
  try {
    if (logDir && !fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    if (logPath) {
      fs.appendFileSync(logPath, line);
    }
  } catch (e) {
    console.error('Failed to write log:', e);
  }
  console.log(msg);
}

let mainWindow: BrowserWindow | null = null;

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
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

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow(): void {
  log('Creating window...');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'zoehis-helper',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
  });

  const appPath = app.getAppPath();
  log(`App path: ${appPath}`);
  log(`App isPackaged: ${app.isPackaged}`);

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  log(`Is development: ${isDev}`);

  if (isDev) {
    log('Loading dev URL: http://localhost:5173');
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const htmlPath = path.join(__dirname, '../renderer/index.html');
    log(`Loading production file: ${htmlPath}`);
    log(`File exists: ${fs.existsSync(htmlPath)}`);
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

app.whenReady().then(async () => {
  logDir = path.join(app.getPath('userData'), 'logs');
  logPath = path.join(logDir, 'main.log');
  
  log('App ready');

  createMenu();

  try {
    await initDatabase();
    log('Database initialized');
  } catch (error) {
    log(`Failed to initialize database: ${error}`);
    app.exit(1);
  }

  registerIpcHandlers();
  log('IPC handlers registered');

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDatabase();
    app.quit();
  }
});

app.on('before-quit', () => {
  closeDatabase();
});
