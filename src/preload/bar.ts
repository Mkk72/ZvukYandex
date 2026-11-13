import { contextBridge, ipcRenderer } from 'electron';

type StateListener = (view: unknown) => void;
type MenuListener = (payload: unknown) => void;

contextBridge.exposeInMainWorld('ymBar', {
  onState: (cb: StateListener): void => {
    ipcRenderer.on('bar:state', (_event, view: unknown) => cb(view));
  },
  onLayout: (cb: (layout: string) => void): void => {
    ipcRenderer.on('bar:layout', (_event, layout: string) => cb(layout));
  },
  onMenu: (cb: MenuListener): void => {
    ipcRenderer.on('bar:menu', (_event, payload: unknown) => cb(payload));
  },
  command: (command: string): void => {
    ipcRenderer.send('bar:command', command);
  },
  menu: (): void => {
    ipcRenderer.send('bar:menu');
  },
  menuSelect: (id: string): void => {
    ipcRenderer.send('bar:menu-select', id);
  },
  menuClose: (): void => {
    ipcRenderer.send('bar:menu-close');
  },
  ready: (): void => {
    ipcRenderer.send('bar:ready');
  }
});
