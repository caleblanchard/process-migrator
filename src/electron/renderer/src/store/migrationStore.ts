import { create } from 'zustand';

export interface ProcessInfo {
  id: string;
  name: string;
  description?: string;
  workItemTypes?: any[];
}

export interface ConnectionConfig {
  url: string;
  token: string;
  isConnected: boolean;
  error?: string;
}

export interface MigrationOptions {
  overwritePicklist: boolean;
  continueOnRuleImportFailure: boolean;
  continueOnFieldDefaultValueFailure: boolean;
  skipImportFormContributions: boolean;
}

export interface LogEntry {
  level: 'info' | 'warning' | 'error' | 'verbose';
  message: string;
  timestamp: string;
}

export interface MigrationProgress {
  step: string;
  progress: number;
  total: number;
}

interface MigrationState {
  // Connection
  source: ConnectionConfig;
  target: ConnectionConfig;
  
  // Process selection
  sourceProcesses: ProcessInfo[];
  targetProcesses: ProcessInfo[];
  sourceProcess: ProcessInfo | null;
  targetProcess: ProcessInfo | null;
  targetProcessName: string;
  
  // Migration
  mode: 'export' | 'import' | 'migrate';
  options: MigrationOptions;
  exportFilePath: string;
  importFilePath: string;
  isRunning: boolean;
  progress: MigrationProgress | null;
  logs: LogEntry[];
  
  // Actions
  setSource: (config: Partial<ConnectionConfig>) => void;
  setTarget: (config: Partial<ConnectionConfig>) => void;
  setSourceProcesses: (processes: ProcessInfo[]) => void;
  setTargetProcesses: (processes: ProcessInfo[]) => void;
  setSourceProcess: (process: ProcessInfo | null) => void;
  setTargetProcess: (process: ProcessInfo | null) => void;
  setTargetProcessName: (name: string) => void;
  setMode: (mode: 'export' | 'import' | 'migrate') => void;
  setOptions: (options: Partial<MigrationOptions>) => void;
  setExportFilePath: (path: string) => void;
  setImportFilePath: (path: string) => void;
  setIsRunning: (isRunning: boolean) => void;
  setProgress: (progress: MigrationProgress | null) => void;
  addLog: (log: LogEntry) => void;
  clearLogs: () => void;
  reset: () => void;
}

const initialState = {
  source: { url: '', token: '', isConnected: false },
  target: { url: '', token: '', isConnected: false },
  sourceProcesses: [],
  targetProcesses: [],
  sourceProcess: null,
  targetProcess: null,
  targetProcessName: '',
  mode: 'migrate' as const,
  options: {
    overwritePicklist: false,
    continueOnRuleImportFailure: false,
    continueOnFieldDefaultValueFailure: false,
    skipImportFormContributions: false,
  },
  exportFilePath: '',
  importFilePath: '',
  isRunning: false,
  progress: null,
  logs: [],
};

export const useMigrationStore = create<MigrationState>((set) => ({
  ...initialState,
  
  setSource: (config) => set((state) => ({ source: { ...state.source, ...config } })),
  setTarget: (config) => set((state) => ({ target: { ...state.target, ...config } })),
  setSourceProcesses: (processes) => set({ sourceProcesses: processes }),
  setTargetProcesses: (processes) => set({ targetProcesses: processes }),
  setSourceProcess: (process) => set({ sourceProcess: process }),
  setTargetProcess: (process) => set({ targetProcess: process }),
  setTargetProcessName: (name) => set({ targetProcessName: name }),
  setMode: (mode) => set({ mode }),
  setOptions: (options) => set((state) => ({ options: { ...state.options, ...options } })),
  setExportFilePath: (path) => set({ exportFilePath: path }),
  setImportFilePath: (path) => set({ importFilePath: path }),
  setIsRunning: (isRunning) => set({ isRunning }),
  setProgress: (progress) => set({ progress }),
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  clearLogs: () => set({ logs: [] }),
  reset: () => set(initialState),
}));
