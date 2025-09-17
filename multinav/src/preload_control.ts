import { contextBridge, ipcRenderer } from "electron";

type InputMode = "control" | "mirror" | "none";

contextBridge.exposeInMainWorld("controlAPI", {
  // mode & targeting
  setInputMode: (mode: InputMode) => ipcRenderer.invoke("control:setInputMode", mode),
  setLeader: (idx: number | null) => ipcRenderer.invoke("control:setLeader", idx),
  setSprayAll: (on: boolean) => ipcRenderer.invoke("control:setSprayAll", on),

  // send text from control textbox
  sendText: (text: string) => ipcRenderer.invoke("control:sendText", text),

  // optional: pass full prompt for logging/latency
  prompt: (text: string) => ipcRenderer.invoke("control:prompt", text),
});

declare global {
  interface Window {
    controlAPI: {
      setInputMode: (mode: InputMode) => Promise<void>;
      setLeader: (idx: number | null) => Promise<void>;
      setSprayAll: (on: boolean) => Promise<void>;
      sendText: (text: string) => Promise<void>;
      prompt: (text: string) => Promise<void>;
    };
  }
}
