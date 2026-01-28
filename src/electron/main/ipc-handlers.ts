import { ipcMain, app } from 'electron';
import * as nodeApi from 'azure-devops-node-api';
import { getProfiles, saveProfile, deleteProfile, getHistory, clearHistory, addHistoryEntry, IMigrationHistoryEntry } from './store';
import { getMainWindow } from './index';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let migrationProcess: ChildProcess | null = null;

function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

async function getRestClients(url: string, token: string) {
    const authHandler = nodeApi.getPersonalAccessTokenHandler(token);
    const connection = new nodeApi.WebApi(url, authHandler);
    
    return {
        witApi: await connection.getWorkItemTrackingApi(),
        witProcessApi: await connection.getWorkItemTrackingProcessApi(),
    };
}

function sendProgress(step: string, progress: number, total: number) {
    const mainWindow = getMainWindow();
    if (mainWindow) {
        mainWindow.webContents.send('migration:progress', { step, progress, total });
    }
}

function sendLog(level: 'info' | 'warning' | 'error' | 'verbose', message: string) {
    const mainWindow = getMainWindow();
    if (mainWindow) {
        mainWindow.webContents.send('migration:log', { level, message, timestamp: new Date().toISOString() });
    }
}

function sendComplete(success: boolean, error?: string) {
    const mainWindow = getMainWindow();
    if (mainWindow) {
        mainWindow.webContents.send('migration:complete', { success, error });
    }
}

export function registerIpcHandlers() {
    // Connection test
    ipcMain.handle('connection:test', async (_event, url: string, token: string) => {
        try {
            const clients = await getRestClients(url, token);
            await clients.witProcessApi.getProcesses();
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message || 'Connection failed' };
        }
    });

    // List processes
    ipcMain.handle('process:list', async (_event, url: string, token: string) => {
        try {
            const clients = await getRestClients(url, token);
            const processes = await clients.witProcessApi.getProcesses();
            return (processes || []).map((p: any) => ({
                id: p.typeId,
                name: p.name,
                description: p.description,
                isDefault: p.isDefault,
                parentProcessTypeId: p.parentProcessTypeId,
            }));
        } catch (error: any) {
            throw new Error(error.message || 'Failed to list processes');
        }
    });

    // Get process details
    ipcMain.handle('process:get', async (_event, url: string, token: string, processId: string) => {
        try {
            const clients = await getRestClients(url, token);
            const process = await clients.witProcessApi.getProcessById(processId);
            const workItemTypes = await clients.witProcessApi.getWorkItemTypes(processId);
            
            const workItemTypesWithDetails = await Promise.all(
                (workItemTypes || []).map(async (wit: any) => {
                    let fields: any[] = [];
                    let states: any[] = [];
                    
                    // Use referenceName or id depending on what's available
                    const witRefName = wit.referenceName || wit.id;
                    
                    try {
                        fields = await clients.witProcessApi.getWorkItemTypeFields(processId, witRefName) || [];
                    } catch (e: any) {
                        console.error(`Failed to get fields for ${witRefName}:`, e.message);
                    }
                    
                    try {
                        states = await clients.witProcessApi.getStateDefinitions(processId, witRefName) || [];
                    } catch (e: any) {
                        console.error(`Failed to get states for ${witRefName}:`, e.message);
                    }
                    
                    return {
                        ...wit,
                        fields,
                        states,
                    };
                })
            );

            return {
                ...process,
                workItemTypes: workItemTypesWithDetails,
            };
        } catch (error: any) {
            console.error('Failed to get process details:', error);
            throw new Error(error.message || 'Failed to get process details');
        }
    });

    // Start migration using CLI subprocess
    ipcMain.handle('migration:start', async (_event, config: {
        sourceUrl: string;
        sourceToken: string;
        targetUrl: string;
        targetToken: string;
        sourceProcessName: string;
        targetProcessName: string;
        mode: 'export' | 'import' | 'migrate';
        options: any;
    }) => {
        const startTime = Date.now();
        const historyId = generateUUID();

        // Create temp config file
        const tempDir = os.tmpdir();
        const configPath = path.join(tempDir, `process-migrator-${historyId}.json`);
        
        const configContent = {
            sourceAccountUrl: config.sourceUrl,
            sourceAccountToken: config.sourceToken,
            targetAccountUrl: config.targetUrl,
            targetAccountToken: config.targetToken,
            sourceProcessName: config.sourceProcessName,
            targetProcessName: config.targetProcessName || config.sourceProcessName,
            options: {
                logLevel: 'verbose',
                overwritePicklist: config.options?.overwritePicklist || false,
                continueOnRuleImportFailure: config.options?.continueOnRuleImportFailure || false,
                continueOnIdentityDefaultValueFailure: config.options?.continueOnFieldDefaultValueFailure || false,
                skipImportFormContributions: config.options?.skipImportFormContributions || false,
            }
        };

        fs.writeFileSync(configPath, JSON.stringify(configContent, null, 2));

        sendProgress('Starting migration', 1, 3);
        sendLog('info', `Starting ${config.mode} operation...`);
        sendLog('info', `Source: ${config.sourceUrl}`);
        if (config.mode !== 'export') {
            sendLog('info', `Target: ${config.targetUrl}`);
        }
        sendLog('info', `Process: ${config.sourceProcessName}`);

        // Find the CLI script path
        const isDev = !app.isPackaged;
        let cliPath: string;
        
        if (isDev) {
            // In dev, __dirname is build/electron/main, so go up 3 levels to root, then into build/nodejs
            cliPath = path.join(__dirname, '../../nodejs/nodejs/Main.js');
        } else {
            cliPath = path.join(process.resourcesPath!, 'app', 'build', 'nodejs', 'nodejs', 'Main.js');
        }

        // Spawn the CLI process using Electron's bundled Node.js
        // process.execPath points to the Electron binary which includes Node.js
        const args = [`--mode=${config.mode}`, `--config=${configPath}`];
        
        // In development, use system node. In production, use Electron's node
        const nodePath = isDev ? 'node' : process.execPath;
        const execArgs = isDev ? [cliPath, ...args] : ['--no-sandbox', cliPath, ...args];
        
        sendProgress('Running migration', 2, 3);
        
        return new Promise<void>((resolve, reject) => {
            migrationProcess = spawn(nodePath, execArgs, {
                env: { 
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: '1' // Run Electron as Node.js instead of browser
                },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdoutData = '';
            let stderrData = '';

            migrationProcess.stdout?.on('data', (data: Buffer) => {
                const text = data.toString();
                stdoutData += text;
                // Parse and send log messages
                const lines = text.split('\n').filter((l: string) => l.trim());
                lines.forEach((line: string) => {
                    if (line.includes('[Error]') || line.includes('error')) {
                        sendLog('error', line);
                    } else if (line.includes('[Warning]') || line.includes('warning')) {
                        sendLog('warning', line);
                    } else if (line.includes('[Verbose]')) {
                        sendLog('verbose', line);
                    } else {
                        sendLog('info', line);
                    }
                });
            });

            migrationProcess.stderr?.on('data', (data: Buffer) => {
                const text = data.toString();
                stderrData += text;
                sendLog('error', text);
            });

            migrationProcess.on('close', (code: number | null) => {
                const endTime = Date.now();
                
                // Clean up temp config file
                try {
                    fs.unlinkSync(configPath);
                } catch (e) {
                    // Ignore cleanup errors
                }

                migrationProcess = null;
                
                const success = code === 0;
                
                // Add to history
                const historyEntry: IMigrationHistoryEntry = {
                    id: historyId,
                    sourceUrl: config.sourceUrl,
                    targetUrl: config.targetUrl,
                    sourceProcessName: config.sourceProcessName,
                    targetProcessName: config.targetProcessName || config.sourceProcessName,
                    mode: config.mode,
                    status: success ? 'success' : 'failed',
                    startedAt: new Date(startTime).toISOString(),
                    completedAt: new Date(endTime).toISOString(),
                    duration: endTime - startTime,
                    error: success ? undefined : stderrData || 'Migration failed',
                };
                addHistoryEntry(historyEntry);

                sendProgress('Complete', 3, 3);
                sendComplete(success, success ? undefined : stderrData || 'Migration failed');
                
                if (success) {
                    resolve();
                } else {
                    reject(new Error(stderrData || 'Migration failed'));
                }
            });

            migrationProcess.on('error', (err: Error) => {
                const endTime = Date.now();
                
                // Clean up temp config file
                try {
                    fs.unlinkSync(configPath);
                } catch (e) {
                    // Ignore cleanup errors
                }

                migrationProcess = null;
                
                const historyEntry: IMigrationHistoryEntry = {
                    id: historyId,
                    sourceUrl: config.sourceUrl,
                    targetUrl: config.targetUrl,
                    sourceProcessName: config.sourceProcessName,
                    targetProcessName: config.targetProcessName || config.sourceProcessName,
                    mode: config.mode,
                    status: 'failed',
                    startedAt: new Date(startTime).toISOString(),
                    completedAt: new Date(endTime).toISOString(),
                    duration: endTime - startTime,
                    error: err.message,
                };
                addHistoryEntry(historyEntry);

                sendLog('error', err.message);
                sendComplete(false, err.message);
                reject(err);
            });
        });
    });

    // Cancel migration
    ipcMain.on('migration:cancel', () => {
        if (migrationProcess && migrationProcess.pid) {
            process.kill(migrationProcess.pid, 'SIGTERM');
            sendLog('warning', 'Migration cancelled by user');
        }
    });

    // Profile handlers
    ipcMain.handle('profiles:get', () => getProfiles());
    ipcMain.handle('profiles:save', (_event, profile) => saveProfile(profile));
    ipcMain.handle('profiles:delete', (_event, id) => deleteProfile(id));

    // History handlers
    ipcMain.handle('history:get', () => getHistory());
    ipcMain.handle('history:clear', () => clearHistory());
}
