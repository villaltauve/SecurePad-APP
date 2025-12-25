import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticateUser, createUser, hasAnyUsers, markDailyGoal } from './user-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL;

nativeTheme.themeSource = 'dark';
app.setName('SecurePad');
app.setAppUserModelId('com.securepad.desktop');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;

const getMainWindow = () => mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null;

const ensureTxtExtension = (targetPath) => {
  if (!targetPath) {
    return targetPath;
  }
  const extension = path.extname(targetPath);
  if (extension && extension.length > 0) {
    return targetPath;
  }
  return `${targetPath}.txt`;
};

const sanitizeFileName = (name) => {
  if (!name || typeof name !== 'string') {
    return 'Documento';
  }
  const withoutControl = Array.from(name)
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('');
  const cleaned = withoutControl.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'Documento';
};

const fileExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_HEADER = 'SECUREPAD::';

const deriveKey = (secret, saltBuffer) =>
  crypto.pbkdf2Sync(secret, saltBuffer, 120000, 32, 'sha256');

const encryptContent = (plaintext, secret) => {
  if (!secret || secret.length === 0) {
    throw new Error('No se definió una clave de cifrado.');
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(secret, salt);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload = {
    v: 1,
    iv: iv.toString('base64url'),
    salt: salt.toString('base64url'),
    data: encrypted.toString('base64url'),
    tag: authTag.toString('base64url'),
  };

  return `${ENCRYPTION_HEADER}${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
};

const decryptContent = (content, secret) => {
  if (!content.startsWith(ENCRYPTION_HEADER)) {
    return content;
  }
  if (!secret || secret.length === 0) {
    throw new Error('No se definió una clave de cifrado válida.');
  }

  try {
    const payloadBuffer = Buffer.from(content.slice(ENCRYPTION_HEADER.length), 'base64url');
    const payload = JSON.parse(payloadBuffer.toString('utf8'));

    const salt = Buffer.from(payload.salt, 'base64url');
    const iv = Buffer.from(payload.iv, 'base64url');
    const encryptedData = Buffer.from(payload.data, 'base64url');
    const authTag = Buffer.from(payload.tag, 'base64url');

    const key = deriveKey(secret, salt);
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('No se pudo descifrar el archivo');
  }
};

const sessions = new Map();

const deriveSessionSecret = (username, password) => {
  const normalizedUser = username.trim().toLowerCase();
  const salt = crypto.createHash('sha512').update(normalizedUser).digest();
  const derived = crypto.pbkdf2Sync(password, salt, 220000, 32, 'sha512');
  return derived.toString('base64url');
};

const getSession = (senderId) => sessions.get(senderId) ?? null;

const startSession = (senderId, username, password, stats) => {
  const secret = deriveSessionSecret(username, password);
  sessions.set(senderId, {
    username,
    secret,
    stats,
  });
  return sessions.get(senderId);
};

const clearSession = (senderId) => {
  sessions.delete(senderId);
};

const formatDateKey = (date = new Date()) => date.toISOString().slice(0, 10);

const normalizeBaseName = (fileName) =>
  sanitizeFileName(fileName).replace(/\.(txt|text)$/iu, '').trim() || 'Documento';

const ensureSecurePadDirectory = async () => {
  const targetDir = path.join(app.getPath('documents'), 'SecurePad');
  await fs.mkdir(targetDir, { recursive: true });
  return targetDir;
};

const resolveAutoSavePath = async (preferredFileName) => {
  const directory = await ensureSecurePadDirectory();
  const baseName = normalizeBaseName(preferredFileName);
  let candidate = ensureTxtExtension(path.join(directory, baseName));

  if (!(await fileExists(candidate))) {
    return candidate;
  }

  const parsed = path.parse(baseName);
  const base = parsed.name;

  for (let index = 1; index < 500; index += 1) {
    const attemptName = `${base} (${index})`;
    candidate = ensureTxtExtension(path.join(directory, attemptName));
    if (!(await fileExists(candidate))) {
      return candidate;
    }
  }

  throw new Error('No se pudo generar un nombre de archivo único.');
};

const createApplicationMenu = () => {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Nuevo',
          accelerator: 'Ctrl+N',
          click: () => {
            const window = getMainWindow();
            window?.focus();
            window?.webContents.send('securepad:action', 'new');
          },
        },
        {
          label: 'Abrir…',
          accelerator: 'Ctrl+O',
          click: () => {
            const window = getMainWindow();
            window?.focus();
            window?.webContents.send('securepad:action', 'open');
          },
        },
        { type: 'separator' },
        {
          label: 'Guardar',
          accelerator: 'Ctrl+S',
          click: () => {
            const window = getMainWindow();
            window?.focus();
            window?.webContents.send('securepad:action', 'save');
          },
        },
        {
          label: 'Guardar como…',
          accelerator: 'Ctrl+Shift+S',
          click: () => {
            const window = getMainWindow();
            window?.focus();
            window?.webContents.send('securepad:action', 'saveAs');
          },
        },
        { type: 'separator' },
        process.platform === 'darwin'
          ? { role: 'close' }
          : {
              role: 'quit',
              label: 'Salir',
            },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(process.platform === 'darwin'
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              { role: 'speech' },
            ]
          : [
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' },
            ]),
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', visible: isDev },
        { role: 'toggleDevTools', visible: isDev },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

const registerIpcHandlers = () => {
  ipcMain.handle('securepad:auth-has-users', async () => hasAnyUsers());

  ipcMain.handle('securepad:auth-register', async (event, payload) => {
    const { username, password } = payload ?? {};
    try {
      const result = await createUser(username, password);
      startSession(event.sender.id, result.username, password, result.stats);
      return result;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'No se pudo crear el usuario.');
    }
  });

  ipcMain.handle('securepad:auth-login', async (event, payload) => {
    const { username, password } = payload ?? {};
    try {
      const result = await authenticateUser(username, password);
      startSession(event.sender.id, result.username, password, result.stats);
      return result;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'No se pudo iniciar sesión.');
    }
  });

  ipcMain.handle('securepad:auth-logout', async (event) => {
    clearSession(event.sender.id);
    return { success: true };
  });

  ipcMain.handle('securepad:stats-complete-goal', async (event) => {
    const session = getSession(event.sender.id);
    if (!session) {
      throw new Error('Sesión no activa.');
    }

    const updated = await markDailyGoal(session.username, formatDateKey());
    sessions.set(event.sender.id, {
      ...session,
      stats: updated,
    });
    return updated;
  });

  ipcMain.handle('securepad:open-file', async (event) => {
    const session = getSession(event.sender.id);
    if (!session) {
      dialog.showErrorBox('Sesión requerida', 'Debes iniciar sesión antes de abrir documentos.');
      return null;
    }

    try {
      const window = getMainWindow();
      const result = await dialog.showOpenDialog(window ?? undefined, {
        title: 'Abrir archivo',
        properties: ['openFile'],
        filters: [
          { name: 'Archivos de texto', extensions: ['txt', 'md', 'log'] },
          { name: 'Todos los archivos', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const filePath = result.filePaths[0];
      const encryptedContent = await fs.readFile(filePath, 'utf8');
      const decrypted = decryptContent(encryptedContent, session.secret);

      return {
        filePath,
        fileName: path.basename(filePath),
        content: decrypted,
      };
    } catch (error) {
      console.error('Failed to open file:', error);
      dialog.showErrorBox('Error al abrir', error instanceof Error ? error.message : String(error));
      return null;
    }
  });

  ipcMain.handle('securepad:save-file', async (event, payload) => {
    const session = getSession(event.sender.id);
    if (!session) {
      dialog.showErrorBox('Sesión requerida', 'Debes iniciar sesión antes de guardar documentos.');
      return null;
    }

    const {
      content = '',
      filePath,
      forceSaveAs = false,
      suggestedFileName,
      autoSave = false,
      preferredFileName,
    } = payload ?? {};

    try {
      let targetPath = filePath;
      const window = getMainWindow();

      if (!targetPath || forceSaveAs) {
        if (autoSave && !forceSaveAs) {
          targetPath = await resolveAutoSavePath(preferredFileName ?? suggestedFileName ?? 'Documento');
        } else {
          const defaultName =
            typeof suggestedFileName === 'string' && suggestedFileName.trim().length > 0
              ? ensureTxtExtension(sanitizeFileName(suggestedFileName))
              : 'Documento sin título.txt';

          const defaultPath = path.join(app.getPath('documents'), defaultName);
          const saveResult = await dialog.showSaveDialog(window ?? undefined, {
            title: 'Guardar archivo',
            defaultPath: targetPath ?? defaultPath,
            filters: [
              { name: 'Archivos de texto', extensions: ['txt'] },
              { name: 'Todos los archivos', extensions: ['*'] },
            ],
          });

          if (saveResult.canceled || !saveResult.filePath) {
            return null;
          }

          targetPath = ensureTxtExtension(saveResult.filePath);
        }
      }

      const plaintext = typeof content === 'string' ? content : '';
      const encryptedContent = encryptContent(plaintext, session.secret);
      await fs.writeFile(targetPath, encryptedContent, 'utf8');

      return {
        filePath: targetPath,
        fileName: path.basename(targetPath),
      };
    } catch (error) {
      console.error('Failed to save file:', error);
      dialog.showErrorBox('Error al guardar', error instanceof Error ? error.message : String(error));
      return null;
    }
  });
};

const createMainWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: 'SecurePad',
    backgroundColor: '#111318',
    autoHideMenuBar: true,
    frame: true,
    show: false,
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    titleBarOverlay:
      process.platform === 'win32'
        ? {
            color: '#111318',
            symbolColor: '#f8fafc',
            height: 40,
          }
        : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    sessions.clear();
  });

  const devURL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';

  if (isDev && devURL) {
    await mainWindow.loadURL(devURL);
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    await mainWindow.loadFile(indexPath);
  }

  return mainWindow;
};

app.on('second-instance', () => {
  const window = getMainWindow();
  if (window) {
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  } else {
    void createMainWindow();
  }
});

app.whenReady()
  .then(async () => {
    createApplicationMenu();
    registerIpcHandlers();
    await createMainWindow();
  })
  .catch((error) => {
    console.error('Failed to create window:', error);
    app.quit();
  });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

