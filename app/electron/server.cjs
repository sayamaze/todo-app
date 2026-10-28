// 内置本地服务器：静态托管前端 dist/ + 任务 REST API
// 与网页版共用同一份明文数据文件，桌面端和预览端数据互通
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createTasksApiHandler, createImagesApiHandler } = require("./api.bundle.cjs");

// 数据文件路径解析：
// 1. 环境变量 TODO_DATA_FILE 指定（高级用法）
// 2. 开发者机器上沿用工作区明文文件（供 Agent 工具读取/编辑）
// 3. 其他机器默认存到 ~/Documents/日程待办/tasks.md（明文、可见、可分享）
function resolveDataFile() {
  if (process.env.TODO_DATA_FILE) return process.env.TODO_DATA_FILE;
  // 开发者机器：优先检查 TODO_DATA_FILE 环境变量；否则用 ~/Documents/日程待办/tasks.md
  const os = require("os");
  return path.join(os.homedir(), "Documents", "日程待办", "tasks.md");
}

const DATA_FILE = resolveDataFile();
const DIST_DIR = path.resolve(__dirname, "../dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveStatic(req, res) {
  let pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  if (pathname === "/") pathname = "/index.html";
  let file = path.normalize(path.join(DIST_DIR, pathname));
  if (!file.startsWith(DIST_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    file = path.join(DIST_DIR, "index.html"); // SPA 回退
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}

/**
 * 启动服务器，优先使用 preferredPort，被占用时自动退到随机空闲端口。
 * @returns {Promise<number>} 实际监听端口
 */
function startServer(preferredPort = 7100) {
  const apiHandler = createTasksApiHandler(DATA_FILE);
  const imagesHandler = createImagesApiHandler(DATA_FILE);
  const server = http.createServer((req, res) => {
    try {
      if ((req.url || "").startsWith("/api/tasks")) {
        req.url = (req.url || "").slice("/api/tasks".length) || "/";
        return apiHandler(req, res, () => {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "接口不存在" }));
        });
      }
      if ((req.url || "").startsWith("/api/images")) {
        req.url = (req.url || "").slice("/api/images".length) || "/";
        return imagesHandler(req, res, () => {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "接口不存在" }));
        });
      }
      serveStatic(req, res);
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e) }));
    }
  });

  return new Promise((resolve) => {
    server.once("error", () => {
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
    server.listen(preferredPort, "127.0.0.1", () => resolve(preferredPort));
  });
}

module.exports = { startServer, DATA_FILE };
