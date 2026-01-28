import React, { useState, useEffect } from 'react';
import {
  Button,
  Input,
  Label,
  Dropdown,
  Option,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Field,
  Divider,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
} from '@fluentui/react-components';
import {
  Checkmark24Regular,
  Dismiss24Regular,
  Save24Regular,
  Delete24Regular,
  FolderOpen24Regular,
  MoreVertical24Regular,
} from '@fluentui/react-icons';
import { useMigrationStore } from '../store/migrationStore';

declare global {
  interface Window {
    electronAPI: any;
  }
}

interface SetupPageProps {
  onNext: () => void;
}

interface Profile {
  id: string;
  name: string;
  sourceUrl: string;
  sourceToken: string;
  targetUrl: string;
  targetToken: string;
}

export function SetupPage({ onNext }: SetupPageProps) {
  const {
    source, target, setSource, setTarget,
    sourceProcesses, setSourceProcesses,
    targetProcesses, setTargetProcesses,
    sourceProcess, setSourceProcess,
    targetProcessName, setTargetProcessName,
    mode, setMode,
    importFilePath, setImportFilePath,
  } = useMigrationStore();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [newProfileName, setNewProfileName] = useState('');
  const [testingSource, setTestingSource] = useState(false);
  const [testingTarget, setTestingTarget] = useState(false);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      const loadedProfiles = await window.electronAPI.getProfiles();
      setProfiles(loadedProfiles);
    } catch (err) {
      console.error('Failed to load profiles:', err);
    }
  };

  const loadProfile = (profileId: string) => {
    const profile = profiles.find(p => p.id === profileId);
    if (profile) {
      setSource({ url: profile.sourceUrl, token: profile.sourceToken, isConnected: false });
      setTarget({ url: profile.targetUrl, token: profile.targetToken, isConnected: false });
      setSelectedProfileId(profileId);
    }
  };

  const saveProfile = async () => {
    if (!newProfileName.trim()) return;
    
    const profile: Profile = {
      id: selectedProfileId || crypto.randomUUID(),
      name: newProfileName,
      sourceUrl: source.url,
      sourceToken: source.token,
      targetUrl: target.url,
      targetToken: target.token,
    };
    
    await window.electronAPI.saveProfile(profile);
    await loadProfiles();
    setNewProfileName('');
    setSaveDialogOpen(false);
    setSelectedProfileId(profile.id);
  };

  const loadProfileById = (profileId: string) => {
    const profile = profiles.find(p => p.id === profileId);
    if (profile) {
      setSource({ url: profile.sourceUrl, token: profile.sourceToken, isConnected: false });
      setTarget({ url: profile.targetUrl, token: profile.targetToken, isConnected: false });
      setSelectedProfileId(profileId);
      setLoadDialogOpen(false);
    }
  };

  const deleteProfile = async (id: string) => {
    await window.electronAPI.deleteProfile(id);
    await loadProfiles();
    if (selectedProfileId === id) {
      setSelectedProfileId('');
    }
  };

  const getUrlHostname = (url: string): string => {
    try {
      return new URL(url).hostname;
    } catch {
      return url || 'Invalid URL';
    }
  };

  const testConnection = async (type: 'source' | 'target') => {
    const config = type === 'source' ? source : target;
    const setConfig = type === 'source' ? setSource : setTarget;
    const setTesting = type === 'source' ? setTestingSource : setTestingTarget;

    if (!config.url || !config.token) {
      setError(`Please enter ${type} URL and PAT`);
      return;
    }

    setTesting(true);
    setError(null);

    try {
      const result = await window.electronAPI.testConnection(config.url, config.token);
      if (result.success) {
        setConfig({ isConnected: true, error: undefined });
        // Load processes after successful connection
        await loadProcesses(type);
      } else {
        setConfig({ isConnected: false, error: result.error });
        setError(`${type} connection failed: ${result.error}`);
      }
    } catch (err: any) {
      setConfig({ isConnected: false, error: err.message });
      setError(`${type} connection failed: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  const loadProcesses = async (type: 'source' | 'target') => {
    const config = type === 'source' ? source : target;
    const setProcesses = type === 'source' ? setSourceProcesses : setTargetProcesses;

    setLoadingProcesses(true);
    try {
      const processes = await window.electronAPI.listProcesses(config.url, config.token);
      setProcesses(processes);
    } catch (err: any) {
      setError(`Failed to load ${type} processes: ${err.message}`);
    } finally {
      setLoadingProcesses(false);
    }
  };

  const handleProcessSelect = (processId: string) => {
    const process = sourceProcesses.find(p => p.id === processId);
    setSourceProcess(process || null);
    if (process && !targetProcessName) {
      setTargetProcessName(process.name);
    }
  };

  const handleChooseImportFile = async () => {
    const result = await window.electronAPI.showOpenDialog({ defaultPath: 'process.json' });
    
    if (!result.canceled && result.filePath) {
      setImportFilePath(result.filePath);
    }
  };

  const canProceed = mode === 'import' 
    ? target.isConnected && importFilePath  // Import needs target connection and file
    : source.isConnected && sourceProcess && (mode === 'export' || target.isConnected);

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Setup Connection</h2>
          <p>Configure source and target Azure DevOps accounts</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button 
            appearance="secondary" 
            icon={<FolderOpen24Regular />}
            onClick={() => setLoadDialogOpen(true)}
            disabled={profiles.length === 0}
          >
            Load Profile
          </Button>
          <Button 
            appearance="secondary" 
            icon={<Save24Regular />}
            onClick={() => setSaveDialogOpen(true)}
            disabled={!source.url || !source.token}
          >
            Save Profile
          </Button>
        </div>
      </div>

      {error && (
        <MessageBar intent="error" style={{ marginBottom: 16 }}>
          <MessageBarBody>
            <MessageBarTitle>Error</MessageBarTitle>
            {error}
          </MessageBarBody>
        </MessageBar>
      )}

      {/* Migration Mode Selection - Always visible */}
      <div className="card">
        <div className="card-title">Migration Mode</div>
        <Field label="Select Mode">
          <Dropdown
            value={mode}
            onOptionSelect={(_, data) => setMode(data.optionValue as any)}
          >
            <Option value="migrate">Migrate (Export + Import)</Option>
            <Option value="export">Export Only</Option>
            <Option value="import">Import Only</Option>
          </Dropdown>
        </Field>
        <p style={{ fontSize: 12, color: '#605e5c', marginTop: 8 }}>
          {mode === 'export' && 'Export a process from source account to a file'}
          {mode === 'import' && 'Import a process from a file to target account'}
          {mode === 'migrate' && 'Export from source and import to target in one operation'}
        </p>
      </div>

      {/* Source Connection */}
      {mode !== 'import' && (
        <div className="card">
          <div className="card-title">
            Source Account
            {source.isConnected && <Checkmark24Regular style={{ color: '#107c10', marginLeft: 8 }} />}
          </div>
          <div className="form-row">
            <Field label="Organization URL" required>
              <Input
                placeholder="https://dev.azure.com/your-org"
                value={source.url}
                onChange={(_, data) => setSource({ url: data.value, isConnected: false })}
              />
            </Field>
            <Field label="Personal Access Token" required>
              <Input
                type="password"
                placeholder="Enter PAT"
                value={source.token}
                onChange={(_, data) => setSource({ token: data.value, isConnected: false })}
              />
            </Field>
          </div>
          <div className="button-row">
            <Button
              appearance="primary"
              onClick={() => testConnection('source')}
              disabled={testingSource || !source.url || !source.token}
            >
              {testingSource ? <Spinner size="tiny" /> : 'Test Connection'}
            </Button>
          </div>
        </div>
      )}

      {/* Process Selection */}
      {mode !== 'import' && source.isConnected && (
        <div className="card">
          <div className="card-title">Process Selection</div>
          <div className="form-row">
            <Field label="Source Process" required>
              <Dropdown
                placeholder={loadingProcesses ? 'Loading...' : 'Select process to migrate'}
                value={sourceProcess?.name || ''}
                onOptionSelect={(_, data) => handleProcessSelect(data.optionValue as string)}
                disabled={loadingProcesses}
              >
                {sourceProcesses.map(process => (
                  <Option key={process.id} value={process.id}>
                    {process.name}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label="Target Process Name">
              <Input
                placeholder="Name for imported process"
                value={targetProcessName}
                onChange={(_, data) => setTargetProcessName(data.value)}
              />
            </Field>
          </div>
        </div>
      )}

      {/* Import File Selection (for import mode) */}
      {mode === 'import' && (
        <div className="card">
          <div className="card-title">Import File</div>
          <Field label="Process File" required>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={importFilePath || ''}
                placeholder="Select the exported process.json file"
                readOnly
                style={{ flex: 1 }}
              />
              <Button
                icon={<FolderOpen24Regular />}
                onClick={handleChooseImportFile}
              >
                Browse...
              </Button>
            </div>
          </Field>
          <p style={{ fontSize: 12, color: '#605e5c', marginTop: 8 }}>
            Select the process.json file that was previously exported.
          </p>
          <Field label="Target Process Name" style={{ marginTop: 16 }}>
            <Input
              placeholder="Name for imported process (optional)"
              value={targetProcessName}
              onChange={(_, data) => setTargetProcessName(data.value)}
            />
          </Field>
          <p style={{ fontSize: 12, color: '#605e5c', marginTop: 8 }}>
            Leave empty to use the original process name from the export file.
          </p>
        </div>
      )}

      {/* Target Connection (hidden for export-only mode) */}
      {mode !== 'export' && (
        <div className="card">
          <div className="card-title">
            Target Account
            {target.isConnected && <Checkmark24Regular style={{ color: '#107c10', marginLeft: 8 }} />}
          </div>
          <div className="form-row">
            <Field label="Organization URL" required>
              <Input
                placeholder="https://dev.azure.com/target-org"
                value={target.url}
                onChange={(_, data) => setTarget({ url: data.value, isConnected: false })}
              />
            </Field>
            <Field label="Personal Access Token" required>
              <Input
                type="password"
                placeholder="Enter PAT"
                value={target.token}
                onChange={(_, data) => setTarget({ token: data.value, isConnected: false })}
              />
            </Field>
          </div>
          <div className="button-row">
            <Button
              appearance="primary"
              onClick={() => testConnection('target')}
              disabled={testingTarget || !target.url || !target.token}
            >
              {testingTarget ? <Spinner size="tiny" /> : 'Test Connection'}
            </Button>
          </div>
        </div>
      )}

      {/* Next Button */}
      <div className="button-row" style={{ justifyContent: 'flex-end' }}>
        <Button
          appearance="primary"
          size="large"
          onClick={onNext}
          disabled={!canProceed}
        >
          Continue to Preview
        </Button>
      </div>

      {/* Save Profile Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={(_, data) => setSaveDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Save Configuration Profile</DialogTitle>
            <DialogContent>
              <Field label="Profile Name" required>
                <Input
                  placeholder="Enter a name for this profile"
                  value={newProfileName}
                  onChange={(_, data) => setNewProfileName(data.value)}
                  autoFocus
                />
              </Field>
              <p style={{ marginTop: 12, fontSize: 14, color: '#605e5c' }}>
                This will save your source and target connection settings for quick access later.
              </p>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setSaveDialogOpen(false)}>
                Cancel
              </Button>
              <Button appearance="primary" onClick={saveProfile} disabled={!newProfileName.trim()}>
                Save Profile
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Load Profile Dialog */}
      <Dialog open={loadDialogOpen} onOpenChange={(_, data) => setLoadDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Load Saved Profile</DialogTitle>
            <DialogContent>
              {profiles.length === 0 ? (
                <p style={{ color: '#605e5c' }}>No saved profiles found. Save your current configuration to create one.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {profiles.map(profile => (
                    <div
                      key={profile.id}
                      style={{
                        padding: 12,
                        border: '1px solid #d1d1d1',
                        borderRadius: 4,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f2f1')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      onClick={() => loadProfileById(profile.id)}
                    >
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{profile.name}</div>
                        <div style={{ fontSize: 12, color: '#605e5c' }}>
                          {getUrlHostname(profile.sourceUrl)} → {getUrlHostname(profile.targetUrl)}
                        </div>
                      </div>
                      <Button
                        appearance="subtle"
                        icon={<Delete24Regular />}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteProfile(profile.id);
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setLoadDialogOpen(false)}>
                Close
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
