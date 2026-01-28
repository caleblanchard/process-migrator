import { contextBridge, ipcRenderer } from 'electron';

export interface IElectronAPI {
    // Connection
    testConnection: (url: string, token: string) => Promise<{ success: boolean; error?: string }>;
    
    // Processes
    listProcesses: (url: string, token: string) => Promise<{ id: string; name: string; description?: string }[]>;
    getProcessDetails: (url: string, token: string, processId: string) => Promise<any>;
    
    // Migration
    startMigration: (config: any) => Promise<void>;
    cancelMigration: () => void;
    onMigrationProgress: (callback: (progress: any) => void) => () => void;
    onMigrationLog: (callback: (log: any) => void) => () => void;
    onMigrationComplete: (callback: (result: any) => void) => () => void;
    
    // Profiles
    getProfiles: () => Promise<any[]>;
    saveProfile: (profile: any) => Promise<void>;
    deleteProfile: (id: string) => Promise<void>;
    
    // History
    getHistory: () => Promise<any[]>;
    clearHistory: () => Promise<void>;
}

const electronAPI: IElectronAPI = {
    // Connection
    testConnection: (url: string, token: string) => 
        ipcRenderer.invoke('connection:test', url, token),
    
    // Processes
    listProcesses: (url: string, token: string) => 
        ipcRenderer.invoke('process:list', url, token),
    getProcessDetails: (url: string, token: string, processId: string) => 
        ipcRenderer.invoke('process:get', url, token, processId),
    
    // Migration
    startMigration: (config: any) => 
        ipcRenderer.invoke('migration:start', config),
    cancelMigration: () => 
        ipcRenderer.send('migration:cancel'),
    onMigrationProgress: (callback: (progress: any) => void) => {
        const listener = (_event: any, progress: any) => callback(progress);
        ipcRenderer.on('migration:progress', listener);
        return () => ipcRenderer.removeListener('migration:progress', listener);
    },
    onMigrationLog: (callback: (log: any) => void) => {
        const listener = (_event: any, log: any) => callback(log);
        ipcRenderer.on('migration:log', listener);
        return () => ipcRenderer.removeListener('migration:log', listener);
    },
    onMigrationComplete: (callback: (result: any) => void) => {
        const listener = (_event: any, result: any) => callback(result);
        ipcRenderer.on('migration:complete', listener);
        return () => ipcRenderer.removeListener('migration:complete', listener);
    },
    
    // Profiles
    getProfiles: () => ipcRenderer.invoke('profiles:get'),
    saveProfile: (profile: any) => ipcRenderer.invoke('profiles:save', profile),
    deleteProfile: (id: string) => ipcRenderer.invoke('profiles:delete', id),
    
    // History
    getHistory: () => ipcRenderer.invoke('history:get'),
    clearHistory: () => ipcRenderer.invoke('history:clear'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
