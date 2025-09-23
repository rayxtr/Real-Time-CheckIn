const { app, BrowserWindow } = require("electron");
const path = require("path");
const child_process = require("child_process");

let serverProcess;

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load frontend
  if (app.isPackaged) {
    // Production: load React build from resources
    const indexHtml = path.join(process.resourcesPath, "client/dist/index.html");
    win.loadFile(indexHtml);
  } else {
    // Dev: load React dev server
    win.loadURL("http://localhost:5173");
  }

  win.on("closed", () => {
    if (serverProcess) serverProcess.kill();
    serverProcess = null;
  });
}

app.whenReady().then(() => {
  // Start backend server
  const serverExePath = app.isPackaged
    ? path.join(process.resourcesPath, "server.exe")
    : path.join(__dirname, "server.js"); // Dev: run Node directly

  if (app.isPackaged) {
    serverProcess = child_process.spawn(serverExePath, [], { stdio: "inherit" });
  } else {
    const { fork } = require("child_process");
    serverProcess = fork(serverExePath);
  }

  createWindow();

  app.on("before-quit", () => {
    if (serverProcess) serverProcess.kill();
  });
});
