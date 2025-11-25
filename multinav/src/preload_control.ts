import { contextBridge, ipcRenderer } from "electron";

type InputMode = "control" | "mirror" | "none";

contextBridge.exposeInMainWorld("controlAPI", {
  // mode & targeting
  setInputMode: (mode: InputMode) => ipcRenderer.invoke("control:setInputMode", mode),
  setLeader: (idx: number | null) => ipcRenderer.invoke("control:setLeader", idx),
  setSprayAll: (on: boolean) => ipcRenderer.invoke("control:setSprayAll", on),

  // navigation & view management
  navigateAll: (url: string) => ipcRenderer.invoke("control:navigateAll", url),
  navigateOne: (i: number, url: string) => ipcRenderer.invoke("control:navigateOne", i, url),
  reloadAll: () => ipcRenderer.invoke("control:reloadAll"),
  setViewCount: (n: number) => ipcRenderer.invoke("control:setViewCount", n),

  // mirror mode controls
  setMirrorSource: (i: number) => ipcRenderer.invoke("control:setMirrorSource", i),
  setMirrorEnabled: (on: boolean) => ipcRenderer.invoke("control:setMirrorEnabled", on),

  // input controls
  sendText: (text: string) => ipcRenderer.invoke("control:sendText", text),
  sendKey: (k: string) => ipcRenderer.invoke("control:sendKey", k),

  // optional: pass full prompt for logging/latency
  prompt: (text: string) => ipcRenderer.invoke("control:prompt", text),
});

declare global {
  interface Window {
    controlAPI: {
      // mode & targeting
      setInputMode: (mode: InputMode) => Promise<void>;
      setLeader: (idx: number | null) => Promise<void>;
      setSprayAll: (on: boolean) => Promise<void>;
      // navigation & view management
      navigateAll: (url: string) => Promise<void>;
      navigateOne: (i: number, url: string) => Promise<void>;
      reloadAll: () => Promise<void>;
      setViewCount: (n: number) => Promise<void>;
      // mirror mode controls
      setMirrorSource: (i: number) => Promise<void>;
      setMirrorEnabled: (on: boolean) => Promise<void>;
      // input controls
      sendText: (text: string) => Promise<void>;
      sendKey: (k: string) => Promise<void>;
      // logging/latency tracking
      prompt: (text: string) => Promise<void>;
    };
  }
}
