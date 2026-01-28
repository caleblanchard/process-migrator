import Store from 'electron-store';

export interface IConnectionProfile {
    id: string;
    name: string;
    sourceUrl: string;
    sourceToken: string;
    targetUrl: string;
    targetToken: string;
    createdAt: string;
    updatedAt: string;
}

export interface IMigrationHistoryEntry {
    id: string;
    sourceUrl: string;
    targetUrl: string;
    sourceProcessName: string;
    targetProcessName: string;
    mode: 'export' | 'import' | 'migrate';
    status: 'success' | 'failed' | 'cancelled';
    startedAt: string;
    completedAt: string;
    duration: number;
    error?: string;
}

interface StoreSchema {
    profiles: IConnectionProfile[];
    history: IMigrationHistoryEntry[];
}

let store: any;

export function initStore() {
    store = new Store({
        name: 'process-migrator-config',
        defaults: {
            profiles: [],
            history: [],
        },
    });
}

export function getStore() {
    return store;
}

// Profile operations
export function getProfiles(): IConnectionProfile[] {
    return store.get('profiles') || [];
}

export function saveProfile(profile: IConnectionProfile): void {
    const profiles = getProfiles();
    const existingIndex = profiles.findIndex((p: IConnectionProfile) => p.id === profile.id);
    
    if (existingIndex >= 0) {
        profiles[existingIndex] = { ...profile, updatedAt: new Date().toISOString() };
    } else {
        profiles.push({ ...profile, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    
    store.set('profiles', profiles);
}

export function deleteProfile(id: string): void {
    const profiles = getProfiles().filter((p: IConnectionProfile) => p.id !== id);
    store.set('profiles', profiles);
}

// History operations
export function getHistory(): IMigrationHistoryEntry[] {
    return store.get('history') || [];
}

export function addHistoryEntry(entry: IMigrationHistoryEntry): void {
    const history = getHistory();
    history.unshift(entry);
    // Keep only last 50 entries
    if (history.length > 50) {
        history.splice(50);
    }
    store.set('history', history);
}

export function clearHistory(): void {
    store.set('history', []);
}
