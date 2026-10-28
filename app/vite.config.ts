import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { createTasksApiHandler, createImagesApiHandler } from "./server/api"

// 任务明文存储文件：工作区根目录下 data/tasks.md，Agent 可直接读取/编辑
const dataFile = path.resolve(__dirname, "../data/tasks.md")
const tasksApiHandler = createTasksApiHandler(dataFile)
const imagesApiHandler = createImagesApiHandler(dataFile)

function tasksApi(): Plugin {
  return {
    name: "tasks-markdown-api",
    configureServer(server) {
      server.middlewares.use("/api/tasks", tasksApiHandler)
      server.middlewares.use("/api/images", imagesApiHandler)
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/tasks", tasksApiHandler)
      server.middlewares.use("/api/images", imagesApiHandler)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react(), tasksApi()],
  server: {
    port: 3000,
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        widget: path.resolve(__dirname, "widget.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
