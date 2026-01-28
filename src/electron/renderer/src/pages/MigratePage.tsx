import React, { useState, useEffect, useRef } from 'react';
import {
  Button,
  Checkbox,
  ProgressBar,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Field,
  Divider,
  Input,
} from '@fluentui/react-components';
import {
  Play24Regular,
  Stop24Regular,
  Checkmark24Filled,
  Dismiss24Filled,
  FolderOpen24Regular,
} from '@fluentui/react-icons';
import { useMigrationStore } from '../store/migrationStore';

interface MigratePageProps {
  onBack: () => void;
}

export function MigratePage({ onBack }: MigratePageProps) {
  const {
    source, target, sourceProcess, targetProcessName, mode, options, setOptions,
    exportFilePath, setExportFilePath,
    importFilePath,
    isRunning, setIsRunning, progress, setProgress, logs, addLog, clearLogs,
  } = useMigrationStore();

  const [completed, setCompleted] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Subscribe to migration events
    const unsubProgress = window.electronAPI.onMigrationProgress((progressData: any) => {
      setProgress(progressData);
    });

    const unsubLog = window.electronAPI.onMigrationLog((logData: any) => {
      addLog(logData);
    });

    const unsubComplete = window.electronAPI.onMigrationComplete((result: any) => {
      setIsRunning(false);
      setCompleted(true);
      setSuccess(result.success);
      if (!result.success) {
        setError(result.error);
      }
    });

    return () => {
      unsubProgress();
      unsubLog();
      unsubComplete();
    };
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleChooseExportFile = async () => {
    const defaultFileName = sourceProcess ? `${sourceProcess.name.replace(/\s+/g, '_')}.json` : 'process.json';
    const result = await window.electronAPI.showSaveDialog({ defaultPath: defaultFileName });
    
    if (!result.canceled && result.filePath) {
      setExportFilePath(result.filePath);
    }
  };

  const startMigration = async () => {
    clearLogs();
    setCompleted(false);
    setError(null);
    setIsRunning(true);

    const config = {
      sourceUrl: source.url,
      sourceToken: source.token,
      targetUrl: target.url,
      targetToken: target.token,
      sourceProcessName: sourceProcess?.name || '',
      targetProcessName: targetProcessName || sourceProcess?.name || '',
      mode,
      exportFilePath: (mode === 'export' || mode === 'migrate') && exportFilePath ? exportFilePath : undefined,
      importFilePath: mode === 'import' && importFilePath ? importFilePath : undefined,
      options: {
        overwritePicklist: options.overwritePicklist,
        continueOnRuleImportFailure: options.continueOnRuleImportFailure,
        continueOnFieldDefaultValueFailure: options.continueOnFieldDefaultValueFailure,
        skipImportFormContributions: options.skipImportFormContributions,
      },
    };

    try {
      await window.electronAPI.startMigration(config);
    } catch (err: any) {
      setError(err.message);
      setIsRunning(false);
      setCompleted(true);
      setSuccess(false);
    }
  };

  const cancelMigration = () => {
    window.electronAPI.cancelMigration();
  };

  const getModeLabel = () => {
    switch (mode) {
      case 'export': return 'Export';
      case 'import': return 'Import';
      case 'migrate': return 'Migration';
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Migrate Process</h2>
        <p>Configure options and execute the {getModeLabel().toLowerCase()}</p>
      </div>

      {/* Summary */}
      <div className="card">
        <div className="card-title">Summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <strong>Mode:</strong> {getModeLabel()}
          </div>
          {mode !== 'import' && (
            <div>
              <strong>Source Process:</strong> {sourceProcess?.name}
            </div>
          )}
          {mode === 'import' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <strong>Import File:</strong> {importFilePath || 'Not selected'}
            </div>
          )}
          {mode !== 'export' && mode !== 'import' && (
            <>
              <div>
                <strong>Source:</strong> {source.url}
              </div>
              <div>
                <strong>Target:</strong> {target.url}
              </div>
              <div>
                <strong>Target Process Name:</strong> {targetProcessName || sourceProcess?.name}
              </div>
            </>
          )}
          {mode === 'import' && (
            <div>
              <strong>Target:</strong> {target.url}
            </div>
          )}
        </div>
      </div>

      {/* Options */}
      {!isRunning && !completed && (
        <div className="card">
          <div className="card-title">Options</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Export file path for export-only mode */}
            {mode === 'export' && (
              <>
                <Field label="Export File Location">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Input
                      value={exportFilePath || ''}
                      placeholder="Default: output/process.json"
                      readOnly
                      style={{ flex: 1 }}
                    />
                    <Button
                      icon={<FolderOpen24Regular />}
                      onClick={handleChooseExportFile}
                    >
                      Choose...
                    </Button>
                  </div>
                </Field>
                <p style={{ fontSize: 12, color: '#605e5c', marginTop: -8 }}>
                  Select where to save the exported process file. Leave empty to use default location.
                </p>
              </>
            )}
            
            <Checkbox
              checked={options.overwritePicklist}
              onChange={(_, data) => setOptions({ overwritePicklist: !!data.checked })}
              label="Overwrite existing picklists"
            />
            <p style={{ fontSize: 12, color: '#605e5c', marginLeft: 28, marginTop: -8 }}>
              If enabled, existing picklist values will be replaced. Otherwise, import fails on picklist conflicts.
            </p>
            
            <Checkbox
              checked={options.continueOnRuleImportFailure}
              onChange={(_, data) => setOptions({ continueOnRuleImportFailure: !!data.checked })}
              label="Continue on rule import failure"
            />
            <p style={{ fontSize: 12, color: '#605e5c', marginLeft: 28, marginTop: -8 }}>
              If enabled, migration continues when a rule fails to import (e.g., missing identity).
            </p>
            
            <Checkbox
              checked={options.continueOnFieldDefaultValueFailure}
              onChange={(_, data) => setOptions({ continueOnFieldDefaultValueFailure: !!data.checked })}
              label="Continue on field default value failure"
            />
            <p style={{ fontSize: 12, color: '#605e5c', marginLeft: 28, marginTop: -8 }}>
              If enabled, migration continues when a field default value fails (e.g., missing identity).
            </p>
            
            <Checkbox
              checked={options.skipImportFormContributions}
              onChange={(_, data) => setOptions({ skipImportFormContributions: !!data.checked })}
              label="Skip form contributions (extensions)"
            />
            <p style={{ fontSize: 12, color: '#605e5c', marginLeft: 28, marginTop: -8 }}>
              If enabled, custom control contributions from extensions will not be imported.
            </p>
          </div>
        </div>
      )}

      {/* Progress */}
      {(isRunning || completed) && (
        <div className="card">
          <div className="card-title">
            {completed ? (
              success ? (
                <span style={{ color: '#107c10' }}>
                  <Checkmark24Filled style={{ marginRight: 8 }} />
                  {getModeLabel()} Completed Successfully
                </span>
              ) : (
                <span style={{ color: '#a4262c' }}>
                  <Dismiss24Filled style={{ marginRight: 8 }} />
                  {getModeLabel()} Failed
                </span>
              )
            ) : (
              'Progress'
            )}
          </div>

          {isRunning && progress && (
            <div className="progress-container">
              <div style={{ marginBottom: 8 }}>{progress.step}</div>
              <ProgressBar value={progress.progress / progress.total} />
              <div style={{ fontSize: 12, color: '#605e5c', marginTop: 4 }}>
                Step {progress.progress} of {progress.total}
              </div>
            </div>
          )}

          {error && (
            <MessageBar intent="error" style={{ marginBottom: 16 }}>
              <MessageBarBody>
                <MessageBarTitle>Error</MessageBarTitle>
                {error}
              </MessageBarBody>
            </MessageBar>
          )}

          <Divider style={{ margin: '16px 0' }} />

          <div className="card-title">Logs</div>
          <div className="log-container" ref={logContainerRef}>
            {logs.length === 0 ? (
              <div style={{ color: '#757575' }}>Waiting for logs...</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className={`log-entry ${log.level}`}>
                  <span className="log-timestamp">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  {log.message}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="button-row" style={{ justifyContent: 'space-between' }}>
        <Button onClick={onBack} disabled={isRunning}>
          Back to Preview
        </Button>
        <div style={{ display: 'flex', gap: 8 }}>
          {isRunning ? (
            <Button
              appearance="secondary"
              icon={<Stop24Regular />}
              onClick={cancelMigration}
            >
              Cancel
            </Button>
          ) : completed ? (
            <Button
              appearance="primary"
              icon={<Play24Regular />}
              onClick={() => {
                setCompleted(false);
                setError(null);
                clearLogs();
              }}
            >
              Run Again
            </Button>
          ) : (
            <Button
              appearance="primary"
              size="large"
              icon={<Play24Regular />}
              onClick={startMigration}
            >
              Start {getModeLabel()}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
