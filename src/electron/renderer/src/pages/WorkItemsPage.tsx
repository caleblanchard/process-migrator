import React, { useState } from 'react';
import {
  Button,
  Radio,
  RadioGroup,
  Field,
  Input,
  Checkbox,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Divider,
  Badge,
} from '@fluentui/react-components';
import { FolderOpen24Regular, Warning24Regular, Checkmark24Regular } from '@fluentui/react-icons';
import { useMigrationStore } from '../store/migrationStore';

interface WorkItemsPageProps {
  onNext: () => void;
  onBack: () => void;
}

interface PreflightReport {
  sourceProject: string;
  targetProject: string;
  totalWorkItems: number;
  workItemsByType: Record<string, number>;
  skippedByTypeFilter: number;
  warnings: string[];
  blockers: string[];
  fieldSkipList: string[];
}

export function WorkItemsPage({ onNext, onBack }: WorkItemsPageProps) {
  const {
    source, target,
    sourceProjectName, targetProjectName,
    workItems, setWorkItems,
  } = useMigrationStore();

  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [witFilterInput, setWitFilterInput] = useState('');

  const handleChooseSnapshot = async () => {
    if (workItems.mode === 'import') {
      const result = await window.electronAPI.showOpenDialog({});
      if (!result.canceled && result.filePath) {
        setWorkItems({ snapshotFilename: result.filePath });
      }
    } else {
      const result = await window.electronAPI.showSaveDialog({ defaultPath: 'workitems.json' });
      if (!result.canceled && result.filePath) {
        setWorkItems({ snapshotFilename: result.filePath });
      }
    }
  };

  const addWitFilter = () => {
    const val = witFilterInput.trim();
    if (!val) { return; }
    const existing = workItems.includeWorkItemTypes || [];
    if (!existing.includes(val)) {
      setWorkItems({ includeWorkItemTypes: [...existing, val] });
    }
    setWitFilterInput('');
  };

  const removeWitFilter = (refName: string) => {
    setWorkItems({
      includeWorkItemTypes: (workItems.includeWorkItemTypes || []).filter(w => w !== refName),
    });
  };

  const runPreflight = async () => {
    setPreflightRunning(true);
    setPreflightError(null);
    setPreflight(null);
    try {
      const report = await window.electronAPI.workItemsPreflight({
        sourceUrl: source.url,
        sourceToken: source.token,
        targetUrl: target.url,
        targetToken: target.token,
        sourceProjectName,
        targetProjectName,
        workItemOptions: workItems,
      });
      setPreflight(report);
    } catch (e: any) {
      setPreflightError(e.message);
    } finally {
      setPreflightRunning(false);
    }
  };

  const canProceed = workItems.mode === 'disabled' || (
    preflight !== null && preflight.blockers.length === 0
  );

  const modeRequiresConnections = workItems.mode !== 'disabled';

  return (
    <div>
      <div className="page-header">
        <h2>Work Items</h2>
        <p>Configure work item migration options</p>
      </div>

      {/* Mode selection */}
      <div className="card">
        <div className="card-title">Migration Mode</div>
        <RadioGroup
          value={workItems.mode}
          onChange={(_e, data) => {
            setWorkItems({ mode: data.value as any });
            setPreflight(null);
          }}
        >
          <Radio value="disabled" label="Disabled — skip work item migration" />
          <Radio value="online" label="Online — migrate directly from source to target" disabled={!source.isConnected || !target.isConnected} />
          <Radio value="export" label="Offline export — export work items to a snapshot file" disabled={!source.isConnected} />
          <Radio value="import" label="Offline import — import work items from a snapshot file" disabled={!target.isConnected} />
        </RadioGroup>
      </div>

      {modeRequiresConnections && (
        <>
          {/* Snapshot file (offline modes) */}
          {(workItems.mode === 'export' || workItems.mode === 'import') && (
            <div className="card">
              <div className="card-title">
                {workItems.mode === 'export' ? 'Export File' : 'Import File'}
              </div>
              <Field label={workItems.mode === 'export' ? 'Save snapshot to' : 'Load snapshot from'} required>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input
                    value={workItems.snapshotFilename || ''}
                    placeholder="workitems.json"
                    readOnly
                    style={{ flex: 1 }}
                  />
                  <Button icon={<FolderOpen24Regular />} onClick={handleChooseSnapshot}>
                    Choose...
                  </Button>
                </div>
              </Field>
            </div>
          )}

          {/* Options */}
          <div className="card">
            <div className="card-title">Options</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Checkbox
                checked={workItems.includeRelations !== false}
                onChange={(_, d) => setWorkItems({ includeRelations: !!d.checked })}
                label="Include work item links (parent/child, related, dependencies)"
              />

              <Field label="Limit items (leave empty for all)">
                <Input
                  type="number"
                  value={workItems.maxItems?.toString() || ''}
                  onChange={(_, d) => setWorkItems({ maxItems: d.value ? parseInt(d.value) : undefined })}
                  placeholder="No limit"
                  style={{ width: 160 }}
                />
              </Field>

              <Divider />

              {/* WIT type filter */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  Work Item Type Filter{' '}
                  <span style={{ fontWeight: 400, fontSize: 12, color: '#605e5c' }}>(leave empty to include all types)</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <Input
                    value={witFilterInput}
                    onChange={(_, d) => setWitFilterInput(d.value)}
                    placeholder="e.g. Bug, User Story, Task"
                    onKeyDown={(e) => e.key === 'Enter' && addWitFilter()}
                    style={{ flex: 1 }}
                  />
                  <Button onClick={addWitFilter} disabled={!witFilterInput.trim()}>Add</Button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(workItems.includeWorkItemTypes || []).map(w => (
                    <Badge
                      key={w}
                      appearance="outline"
                      style={{ cursor: 'pointer' }}
                      onClick={() => removeWitFilter(w)}
                    >
                      {w} ×
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Preflight */}
          <div className="card">
            <div className="card-title">Preflight Check</div>
            <p style={{ fontSize: 13, color: '#605e5c', marginBottom: 12 }}>
              Run a preflight check to validate the migration before writing any data.
              Blockers must be resolved; warnings are informational.
            </p>

            {preflightError && (
              <MessageBar intent="error" style={{ marginBottom: 12 }}>
                <MessageBarBody>
                  <MessageBarTitle>Preflight Failed</MessageBarTitle>
                  {preflightError}
                </MessageBarBody>
              </MessageBar>
            )}

            {preflight && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div className="card" style={{ padding: 12, margin: 0 }}>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{preflight.totalWorkItems}</div>
                    <div style={{ fontSize: 12, color: '#605e5c' }}>Total work items</div>
                  </div>
                  <div className="card" style={{ padding: 12, margin: 0 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: preflight.blockers.length > 0 ? '#a4262c' : '#107c10' }}>
                      {preflight.blockers.length}
                    </div>
                    <div style={{ fontSize: 12, color: '#605e5c' }}>Blockers</div>
                  </div>
                  <div className="card" style={{ padding: 12, margin: 0 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: preflight.warnings.length > 0 ? '#ca5010' : '#107c10' }}>
                      {preflight.warnings.length}
                    </div>
                    <div style={{ fontSize: 12, color: '#605e5c' }}>Warnings</div>
                  </div>
                </div>

                {/* Work items by type */}
                {Object.keys(preflight.workItemsByType).length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ fontSize: 13 }}>Work Items by Type</strong>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {Object.entries(preflight.workItemsByType).map(([type, count]) => (
                        <Badge key={type} appearance="filled" color="informative">
                          {type}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {preflight.blockers.length > 0 && (
                  <MessageBar intent="error" style={{ marginBottom: 8 }}>
                    <MessageBarBody>
                      <MessageBarTitle>
                        <Warning24Regular style={{ marginRight: 4 }} />
                        Blockers ({preflight.blockers.length})
                      </MessageBarTitle>
                      <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                        {preflight.blockers.map((b, i) => <li key={i}>{b}</li>)}
                      </ul>
                    </MessageBarBody>
                  </MessageBar>
                )}

                {preflight.warnings.length > 0 && (
                  <MessageBar intent="warning" style={{ marginBottom: 8 }}>
                    <MessageBarBody>
                      <MessageBarTitle>Warnings ({preflight.warnings.length})</MessageBarTitle>
                      <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                        {preflight.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </MessageBarBody>
                  </MessageBar>
                )}

                {preflight.blockers.length === 0 && (
                  <MessageBar intent="success">
                    <MessageBarBody>
                      <Checkmark24Regular style={{ marginRight: 4 }} />
                      Preflight passed — ready to migrate
                    </MessageBarBody>
                  </MessageBar>
                )}
              </div>
            )}

            <Button
              appearance="secondary"
              onClick={runPreflight}
              disabled={preflightRunning || !sourceProjectName || (workItems.mode !== 'import' && !source.isConnected)}
            >
              {preflightRunning ? <Spinner size="tiny" style={{ marginRight: 8 }} /> : null}
              {preflightRunning ? 'Running...' : 'Run Preflight Check'}
            </Button>
          </div>
        </>
      )}

      <div className="button-row" style={{ justifyContent: 'space-between' }}>
        <Button onClick={onBack}>Back</Button>
        <Button appearance="primary" onClick={onNext} disabled={!canProceed}>
          {workItems.mode === 'disabled' ? 'Next: Migrate' : 'Next: Migrate'}
        </Button>
      </div>
    </div>
  );
}
