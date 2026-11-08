const {
  app, BrowserWindow, Tray, Menu, ipcMain, clipboard, screen,
  systemPreferences, session, nativeImage, Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { execFile } = require('child_process');
const { uIOhook, UiohookKey } = require('uiohook-napi');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// ---------- settings ----------
const MODELS = {
  'Xenova/whisper-tiny.en': 'Fastest (~40 MB)',
  'Xenova/whisper-base.en': 'Balanced (~80 MB)',
  'Xenova/whisper-small.en': 'Most accurate (~250 MB)',
};
const HOTKEYS = {
  'right-alt': { code: UiohookKey.AltRight, label: isMac ? 'Right Option' : 'Right Alt' },
  'right-ctrl': { code: UiohookKey.CtrlRight, label: 'Right Ctrl' },
  'right-shift': { code: UiohookKey.ShiftRight, label: 'Right Shift' },
};
const defaults = { model: 'Xenova/whisper-base.en', hotkey: isMac ? 'right-alt' : 'right-ctrl' };
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings = { ...defaults };
try { settings = { ...defaults, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) }; } catch {}
const saveSettings = () => {
  try { fs.mkdirSync(path.dirname(settingsPath), { recursive: true }); fs.writeFileSync(settingsPath, JSON.stringify(settings)); } catch {}
};

// ---------- state ----------
let overlay = null, tray = null, worker = null;
let modelState = { state: 'loading', progress: 0 };
let phase = 'idle';            // idle | recording | transcribing
let keyDown = false;
let cancelled = false;
let jobId = 0;
let hideTimer = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- overlay ----------
function createOverlay() {
  overlay = new BrowserWindow({
    width: 280, height: 76, show: false, frame: false, transparent: true,
    resizable: false, movable: false, focusable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true);
  overlay.loadFile(path.join(__dirname, 'overlay.html'));
}

function showOverlay() {
  clearTimeout(hideTimer);
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const [w, h] = overlay.getSize();
  overlay.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height - h - 36));
  overlay.showInactive();
}
function hideOverlay(delay = 0) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => overlay && overlay.hide(), delay);
}
const setOverlayState = (s) => overlay && overlay.webContents.send('state', s);

// ---------- worker ----------
function startWorker() {
  worker = new Worker(path.join(__dirname, 'transcriber.js'), {
    workerData: { cacheDir: path.join(app.getPath('userData'), 'models') },
  });
  worker.on('message', onWorkerMessage);
  worker.on('error', (e) => notify('Murmur error', String(e.message || e)));
  worker.postMessage({ type: 'load', model: settings.model });
}

function onWorkerMessage(msg) {
  if (msg.type === 'status') {
    modelState = msg;
    updateTray();
  } else if (msg.type === 'result') {
    if (msg.id !== jobId || cancelled) return;
    finish(msg.text);
  } else if (msg.type === 'error') {
    phase = 'idle';
    setOverlayState({ mode: 'error', text: 'Transcription failed' });
    hideOverlay(1800);
    notify('Murmur error', msg.message);
  }
}

// ---------- hotkey flow ----------
function onPress() {
  if (phase !== 'idle') return;
  if (modelState.state !== 'ready') {
    showOverlay();
    const pct = modelState.state === 'downloading' ? ` ${modelState.progress}%` : '';
    setOverlayState({ mode: 'loading', text: `Getting the model ready${pct}` });
    hideOverlay(1800);
    return;
  }
  cancelled = false;
  phase = 'recording';
  showOverlay();
  setOverlayState({ mode: 'recording' });
  overlay.webContents.send('start');
}

function onRelease() {
  if (phase !== 'recording') return;
  overlay.webContents.send('stop');
}

function onOtherKey() {
  // Another key pressed while holding the hotkey: the user is typing a shortcut, not dictating.
  if (phase !== 'recording') return;
  cancelled = true;
  phase = 'idle';
  overlay.webContents.send('cancel');
  hideOverlay();
}

ipcMain.on('audio', (_e, buf) => {
  if (cancelled) return;
  const audio = buf instanceof Float32Array ? buf : new Float32Array(buf.buffer || buf);
  let sum = 0;
  for (let i = 0; i < audio.length; i += 8) sum += audio[i] * audio[i];
  const rms = Math.sqrt(sum / Math.max(1, audio.length / 8));
  if (audio.length < 16000 * 0.4 || rms < 0.004) {   // too short or silent
    phase = 'idle';
    hideOverlay();
    return;
  }
  phase = 'transcribing';
  setOverlayState({ mode: 'transcribing' });
  jobId += 1;
  worker.postMessage({ type: 'transcribe', id: jobId, model: settings.model, audio }, [audio.buffer]);
});

ipcMain.on('mic-error', (_e, msg) => {
  phase = 'idle';
  setOverlayState({ mode: 'error', text: 'Microphone unavailable' });
  hideOverlay(2200);
  notify('Murmur cannot hear you', msg || 'Allow microphone access for Murmur in your system settings.');
});

// ---------- text handling ----------
function clean(raw) {
  let t = raw
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')                 // [BLANK_AUDIO], (music)
    .replace(/\b(?:um+|uh+|erm+|hmm+|mm+)\b[,.]?\s*/gi, '') // filler words
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!t) return '';
  return t[0].toUpperCase() + t.slice(1);
}

async function finish(raw) {
  const text = clean(raw);
  if (!text) {
    phase = 'idle';
    hideOverlay();
    return;
  }
  setOverlayState({ mode: 'done' });
  await pasteText(text);
  phase = 'idle';
  hideOverlay(500);
}

function pressPaste() {
  return new Promise((resolve) => {
    if (isMac) {
      execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], () => resolve());
    } else if (isWin) {
      execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
        "(New-Object -ComObject WScript.Shell).SendKeys('^v')"], () => resolve());
    } else {
      execFile('xdotool', ['key', 'ctrl+v'], () => resolve());
    }
  });
}

async function pasteText(text) {
  const previous = clipboard.readText();
  clipboard.writeText(text);
  await sleep(60);
  await pressPaste();
  await sleep(300);
  clipboard.writeText(previous);   // put the user's clipboard back
}

// ---------- tray ----------
function makeTrayImage() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
  return img.resize({ width: 18, height: 18 });
}

function statusLabel() {
  if (modelState.state === 'downloading') return `Downloading model… ${modelState.progress}%`;
  if (modelState.state === 'loading') return 'Loading model…';
  return `Ready. Hold ${HOTKEYS[settings.hotkey].label} and speak`;
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(`Murmur: ${statusLabel()}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: statusLabel(), enabled: false },
    { type: 'separator' },
    {
      label: 'Hold-to-talk key',
      submenu: Object.entries(HOTKEYS).map(([id, k]) => ({
        label: k.label, type: 'radio', checked: settings.hotkey === id,
        click: () => { settings.hotkey = id; saveSettings(); updateTray(); },
      })),
    },
    {
      label: 'Model',
      submenu: Object.entries(MODELS).map(([id, label]) => ({
        label, type: 'radio', checked: settings.model === id,
        click: () => {
          settings.model = id; saveSettings();
          modelState = { state: 'loading', progress: 0 };
          worker.postMessage({ type: 'load', model: id });
          updateTray();
        },
      })),
    },
    { type: 'separator' },
    {
      label: 'Launch at login', type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (m) => app.setLoginItemSettings({ openAtLogin: m.checked }),
    },
    { label: 'Quit Murmur', role: 'quit' },
  ]));
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

// ---------- boot ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.whenReady().then(async () => {
  if (!gotLock) return;
  if (isMac) {
    app.dock && app.dock.hide();
    await systemPreferences.askForMediaAccess('microphone');
    systemPreferences.isTrustedAccessibilityClient(true);   // prompts for Accessibility (needed to paste)
  }
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');

  createOverlay();
  tray = new Tray(makeTrayImage());
  updateTray();
  startWorker();

  uIOhook.on('keydown', (e) => {
    if (e.keycode === HOTKEYS[settings.hotkey].code) {
      if (!keyDown) { keyDown = true; onPress(); }
    } else if (keyDown) {
      onOtherKey();
    }
  });
  uIOhook.on('keyup', (e) => {
    if (e.keycode === HOTKEYS[settings.hotkey].code && keyDown) {
      keyDown = false;
      onRelease();
    }
  });
  uIOhook.start();
});

app.on('window-all-closed', (e) => e.preventDefault());   // live in the tray
app.on('will-quit', () => { try { uIOhook.stop(); } catch {} });
