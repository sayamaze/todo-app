const { app, BrowserWindow, shell, screen, Tray, Menu, nativeImage, Notification, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const { startServer, DATA_FILE } = require("./server.cjs");
const { autoUpdater } = require("electron-updater");

// 单实例锁：重复启动时聚焦已有窗口，避免多个服务器互相抢端口
const gotLock = app.requestSingleInstanceLock();

let serverPort = null;
let mainWindow = null;
let widgetWindow = null;
let tray = null;

// ---------- 窗口状态持久化 ----------
function stateFile(name) {
  return path.join(app.getPath("userData"), name);
}

function loadState(name) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(name), "utf8"));
  } catch {
    return null;
  }
}

function saveState(name, value) {
  try {
    fs.writeFileSync(stateFile(name), JSON.stringify(value));
  } catch {
    /* 忽略写入失败 */
  }
}

function validBounds(s) {
  if (!s || !(s.width > 0) || !(s.height > 0)) return null;
  if (s.x !== undefined && s.y !== undefined) {
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return s.x >= a.x - s.width / 2 && s.x < a.x + a.width && s.y >= a.y && s.y < a.y + a.height;
    });
    if (!visible) {
      delete s.x;
      delete s.y;
    }
  }
  return s;
}

// ---------- 主窗口 ----------
async function createMainWindow() {
  if (serverPort === null) serverPort = await startServer(7100);
  const state = validBounds(loadState("window-state.json"));

  mainWindow = new BrowserWindow({
    width: state?.width ?? 960,
    height: state?.height ?? 920,
    x: state?.x,
    y: state?.y,
    minWidth: 560,
    minHeight: 640,
    title: "日程待办",
    backgroundColor: "#f5f6f8",
    titleBarStyle: "hiddenInset",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  mainWindow.on("close", () => {
    if (!mainWindow.isDestroyed() && !mainWindow.isMinimized() && !mainWindow.isFullScreen()) {
      saveState("window-state.json", mainWindow.getBounds());
    }
  });
  mainWindow.on("closed", () => (mainWindow = null));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
  return mainWindow;
}

// ---------- 桌面悬浮小组件（4:2 中尺寸比例） ----------
function createWidgetWindow() {
  const state = validBounds(loadState("widget-state.json"));

  widgetWindow = new BrowserWindow({
    width: state?.width ?? 520,
    height: state?.height ?? 260,
    x: state?.x,
    y: state?.y,
    minWidth: 360,
    minHeight: 180,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: "日程待办小组件",
    backgroundColor: "#f5f6f8",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  widgetWindow.setAlwaysOnTop(true, "floating");
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  widgetWindow.on("close", () => {
    if (!widgetWindow.isDestroyed()) {
      saveState("widget-state.json", widgetWindow.getBounds());
    }
  });
  widgetWindow.on("closed", () => (widgetWindow = null));

  widgetWindow.loadURL(`http://127.0.0.1:${serverPort}/widget.html`);
  return widgetWindow;
}

function toggleWidget() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    saveState("widget-state.json", widgetWindow.getBounds());
    widgetWindow.close();
  } else {
    createWidgetWindow();
  }
  updateTrayMenu();
}

function widgetVisible() {
  return !!(widgetWindow && !widgetWindow.isDestroyed());
}

// ---------- 托盘 ----------
function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开主窗口",
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createMainWindow();
          }
        },
      },
      {
        label: "桌面小组件",
        type: "checkbox",
        checked: widgetVisible(),
        click: toggleWidget,
      },
      {
        label: "每日提醒（9:00）",
        type: "checkbox",
        checked: reminderEnabled(),
        click: (item) => setReminderEnabled(item.checked),
      },
      { type: "separator" },
      { label: "退出日程待办", click: () => app.exit(0) },
    ])
  );
}

function createTray() {
  // 模板图标：macOS 会忽略颜色、只取 alpha 通道，并自动适配菜单栏深浅色
  // 使用 22x22 线条图标 + @2x 高清版本，避免实心色块被渲染成纯黑方块
  const iconPath = path.resolve(__dirname, "tray-icon.png");
  const image = nativeImage.createFromPath(iconPath);
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("日程待办");
  tray.on("click", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });
  updateTrayMenu();
}

// ---------- 桌面提醒 ----------
// 每天早上 9 点对「今天到期的高/中优先级任务」发系统通知；当天只提醒一次。托盘菜单可开关。

function todayStrLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 从 Markdown 数据文件解析出今天到期的未完成任务（轻量解析，只取标题/优先级/日期行） */
function readTodayTasks() {
  try {
    const md = fs.readFileSync(DATA_FILE, "utf8");
    const today = todayStrLocal();
    const tasks = [];
    for (const line of md.split("\n")) {
      const m = line.match(/^- \[ \] (.+) <!-- id:[A-Za-z0-9-]+ -->\s*$/);
      if (!m) continue;
      const body = m[1];
      const dateM = body.match(/📅(\d{4}-\d{2}-\d{2})/);
      if (!dateM || dateM[1] > today) continue; // 只关心今天及已过期
      const priM = body.match(/!(高|中|低)/);
      const title = body
        .replace(/📅\d{4}-\d{2}-\d{2}/, "")
        .replace(/!(高|中|低)/, "")
        .replace(/#([^\s#]+)/g, "")
        .replace(/🔁(daily|weekly|weekday)/, "")
        .replace(/\s+/g, " ")
        .trim();
      tasks.push({ title, priority: priM ? priM[1] : "无", overdue: dateM[1] < today });
    }
    return tasks;
  } catch {
    return [];
  }
}

function loadReminderState() {
  return loadState("reminder-state.json") ?? { enabled: true, lastFired: null };
}

function reminderEnabled() {
  return loadReminderState().enabled !== false;
}

function setReminderEnabled(v) {
  const s = loadReminderState();
  saveState("reminder-state.json", { ...s, enabled: v });
  updateTrayMenu();
}

function fireReminder() {
  const s = loadReminderState();
  const today = todayStrLocal();
  if (s.lastFired === today) return; // 当天已提醒过
  if (!Notification.isSupported()) return;

  const tasks = readTodayTasks();
  if (tasks.length === 0) return;

  const important = tasks.filter((t) => t.priority === "高" || t.priority === "中");
  const overdue = tasks.filter((t) => t.overdue);
  const show = important.length > 0 ? important : tasks;

  const lines = [];
  if (overdue.length > 0) lines.push(`⚠️ ${overdue.length} 项已过期`);
  lines.push(`今天 ${tasks.length} 项待办，其中高/中优先级 ${important.length} 项`);
  const preview = show.slice(0, 3).map((t) => `· ${t.title}`).join("\n");

  const n = new Notification({
    title: "日程待办 · 今日提醒",
    body: `${lines.join("，")}\n${preview}${show.length > 3 ? `\n…共 ${show.length} 项` : ""}`,
    silent: false,
  });
  n.on("click", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });
  n.show();
  saveState("reminder-state.json", { ...s, lastFired: today });
}

/** 调度：启动时若已过 9 点且当天未提醒则立即提醒；之后每小时检查一次（覆盖跨天常驻） */
function scheduleReminder() {
  const check = () => {
    if (!reminderEnabled()) return;
    const now = new Date();
    if (now.getHours() >= 9) fireReminder();
  };
  setTimeout(check, 15 * 1000); // 启动 15s 后首次检查（等服务器/文件就绪）
  setInterval(check, 60 * 60 * 1000);
}

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });

  app.whenReady().then(async () => {
    if (serverPort === null) serverPort = await startServer(7100);
    createMainWindow();
    createTray();
    scheduleReminder();
    setupAutoUpdater();
    // 上次退出时小组件是开着的，则自动恢复
    const widgetState = loadState("widget-visible.json");
    if (widgetState?.visible) createWidgetWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  // 小组件显隐状态记忆 + 托盘菜单勾选态同步
  app.on("browser-window-created", (_e, win) => {
    const sync = () => {
      saveState("widget-visible.json", { visible: widgetVisible() });
      updateTrayMenu();
    };
    win.on("show", sync);
    win.on("hide", sync);
    win.on("closed", sync);
  });

  // macOS 习惯：关闭窗口不退出应用，服务器保持在线（点程序坞/托盘图标重新开窗）
  app.on("window-all-closed", () => {
    // 保持运行
  });
}

// ---------- 自动更新（GitHub Release） ----------
function setupAutoUpdater() {
  autoUpdater.autoDownload = false; // 检测到新版本后先弹提示，用户确认再下载
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    dialog
      .showMessageBox({
        type: "info",
        title: "发现新版本",
        message: `新版本 v${info.version} 已发布，是否下载更新？`,
        buttons: ["下载更新", "稍后"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.downloadUpdate();
      });
  });

  autoUpdater.on("update-downloaded", () => {
    dialog
      .showMessageBox({
        type: "info",
        title: "更新已就绪",
        message: "新版本已下载完成，重启应用后生效。",
        buttons: ["立即重启", "稍后"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on("error", (err) => {
    console.error("autoUpdater error:", err.message);
  });

  // 启动后 10s 首次检查，之后每 4 小时检查一次
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10 * 1000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}
