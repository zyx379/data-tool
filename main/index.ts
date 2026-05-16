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
        { label: '开发者工具', click: () => {
          if (mainWindow) {
            if (mainWindow.webContents.isDevToolsOpened()) {
              mainWindow.webContents.closeDevTools();
            } else {
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
              message: 'ZoeDevOps v1.0'
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
    title: 'ZoeDevOps',
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
      mainWindow!.loadURL(devUrl);
    };
    
    // 设置失败重试逻辑
    mainWindow!.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      log(`窗口加载失败: ${errorCode} - ${errorDescription}`);
      
      // 如果是开发环境且加载的是开发URL，尝试下一个端口
      if (isDev) {
        currentPortIndex++;
        if (currentPortIndex < devPorts.length) {
          log(`尝试下一个端口...`);
          setTimeout(tryLoadDevUrl, 100); // 稍等再试
        } else {
          log(`所有开发端口都尝试失败，请确保Vite服务正在运行`);
        }
      }
    });
    
    // 首次尝试加载
    tryLoadDevUrl();
  } else {
    const htmlPath = path.join(__dirname, '../renderer/index.html');
    log(`加载生产文件: ${htmlPath}`);
    log(`文件存在: ${fs.existsSync(htmlPath)}`);
    mainWindow!.loadFile(htmlPath);
  }

  mainWindow!.webContents.on('did-finish-load', () => {
    log('窗口加载完成');
    if (isDev) {
      mainWindow!.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow!.on('closed', () => {
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
