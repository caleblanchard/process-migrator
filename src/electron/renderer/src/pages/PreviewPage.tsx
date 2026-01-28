import React, { useState, useEffect } from 'react';
import {
  Button,
  Spinner,
  Badge,
  Divider,
  Tab,
  TabList,
} from '@fluentui/react-components';
import {
  ChevronRight24Regular,
  ChevronDown24Regular,
  Document24Regular,
  Folder24Regular,
  Settings24Regular,
} from '@fluentui/react-icons';
import { useMigrationStore } from '../store/migrationStore';

interface PreviewPageProps {
  onNext: () => void;
  onBack: () => void;
}

interface ProcessDetails {
  name: string;
  description?: string;
  workItemTypes: WorkItemTypeDetails[];
}

interface WorkItemTypeDetails {
  name: string;
  referenceName: string;
  description?: string;
  color?: string;
  icon?: string;
  fields: any[];
  states: any[];
}

export function PreviewPage({ onNext, onBack }: PreviewPageProps) {
  const { source, target, sourceProcess, mode, importFilePath, targetProcessName } = useMigrationStore();
  const [loading, setLoading] = useState(true);
  const [sourceDetails, setSourceDetails] = useState<ProcessDetails | null>(null);
  const [targetDetails, setTargetDetails] = useState<ProcessDetails | null>(null);
  const [selectedTab, setSelectedTab] = useState<'source' | 'diff'>('source');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadProcessDetails();
  }, [sourceProcess]);

  const loadProcessDetails = async () => {
    // Skip loading for import mode - no source process to preview
    if (mode === 'import') {
      setLoading(false);
      return;
    }
    
    if (!sourceProcess) return;
    
    setLoading(true);
    try {
      const srcDetails = await window.electronAPI.getProcessDetails(
        source.url, source.token, sourceProcess.id
      );
      setSourceDetails(srcDetails);

      // Load target process if it exists and we're not in export-only mode
      if (mode !== 'export' && target.isConnected) {
        try {
          const targetProcesses = await window.electronAPI.listProcesses(target.url, target.token);
          const existingTarget = targetProcesses.find((p: any) => p.name === sourceProcess.name);
          if (existingTarget) {
            const tgtDetails = await window.electronAPI.getProcessDetails(
              target.url, target.token, existingTarget.id
            );
            setTargetDetails(tgtDetails);
          }
        } catch {
          // Target process doesn't exist, which is fine
        }
      }
    } catch (err: any) {
      console.error('Failed to load process details:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    console.log('Toggling:', id, 'Current expanded:', Array.from(expandedItems));
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    console.log('New expanded:', Array.from(newExpanded));
    setExpandedItems(newExpanded);
  };

  const renderWorkItemType = (wit: WorkItemTypeDetails) => {
    const witId = `wit-${wit.referenceName || wit.id || wit.name}`;
    const isExpanded = expandedItems.has(witId);
    const fieldsExpanded = expandedItems.has(`${witId}-fields`);
    const statesExpanded = expandedItems.has(`${witId}-states`);
    
    console.log('Rendering WIT:', wit.name, 'referenceName:', wit.referenceName, 'id:', wit.id, 'Final ID:', witId, 'isExpanded:', isExpanded);

    return (
      <div key={witId} style={{ marginLeft: 0, marginBottom: 8 }}>
        {/* Work Item Type Header */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand(witId, e);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            cursor: 'pointer',
            borderRadius: 4,
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f2f1')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {isExpanded ? <ChevronDown24Regular /> : <ChevronRight24Regular />}
          <Folder24Regular />
          <span style={{ fontWeight: 500 }}>{wit.name}</span>
          <Badge appearance="outline" size="small">{wit.fields?.length || 0} fields</Badge>
          <Badge appearance="outline" size="small">{wit.states?.length || 0} states</Badge>
        </div>

        {/* Nested Content */}
        {isExpanded && (
          <div style={{ marginLeft: 32 }}>
            {/* Fields Section */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(`${witId}-fields`, e);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                cursor: 'pointer',
                borderRadius: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f2f1')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {fieldsExpanded ? <ChevronDown24Regular /> : <ChevronRight24Regular />}
              <span>Fields ({wit.fields?.length || 0})</span>
            </div>
            
            {fieldsExpanded && (
              <div style={{ marginLeft: 32 }}>
                {wit.fields?.map((field: any) => (
                  <div
                    key={field.referenceName}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 12px',
                      fontSize: 14,
                    }}
                  >
                    <Document24Regular />
                    <span>{field.name || field.referenceName}</span>
                    {field.required && (
                      <Badge appearance="filled" color="danger" size="small">
                        Required
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* States Section */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(`${witId}-states`, e);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                cursor: 'pointer',
                borderRadius: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f2f1')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {statesExpanded ? <ChevronDown24Regular /> : <ChevronRight24Regular />}
              <span>States ({wit.states?.length || 0})</span>
            </div>
            
            {statesExpanded && (
              <div style={{ marginLeft: 32 }}>
                {wit.states?.map((state: any) => (
                  <div
                    key={state.id || state.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 12px',
                      fontSize: 14,
                    }}
                  >
                    <Settings24Regular />
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        backgroundColor: state.color ? `#${state.color}` : '#999',
                      }}
                    />
                    <span>{state.name}</span>
                    <Badge appearance="outline" size="small">{state.stateCategory}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderDiff = () => {
    if (!targetDetails) {
      return (
        <div className="empty-state">
          <p>Target process does not exist yet. All items will be created.</p>
        </div>
      );
    }

    const sourceWITs = new Set(sourceDetails?.workItemTypes.map(w => w.referenceName) || []);
    const targetWITs = new Set(targetDetails.workItemTypes.map(w => w.referenceName));

    const added = sourceDetails?.workItemTypes.filter(w => !targetWITs.has(w.referenceName)) || [];
    const existing = sourceDetails?.workItemTypes.filter(w => targetWITs.has(w.referenceName)) || [];

    return (
      <div>
        {added.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h4 style={{ color: '#107c10', marginBottom: 8 }}>New Work Item Types ({added.length})</h4>
            {added.map(wit => (
              <div key={wit.referenceName} className="diff-added" style={{ padding: 8, marginBottom: 4, borderRadius: 4 }}>
                {wit.name}
              </div>
            ))}
          </div>
        )}
        
        {existing.length > 0 && (
          <div>
            <h4 style={{ color: '#797673', marginBottom: 8 }}>Existing Work Item Types ({existing.length})</h4>
            <p style={{ fontSize: 12, color: '#605e5c', marginBottom: 8 }}>
              Fields and states may be added or updated
            </p>
            {existing.map(wit => (
              <div key={wit.referenceName} className="diff-modified" style={{ padding: 8, marginBottom: 4, borderRadius: 4 }}>
                {wit.name}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <Spinner size="large" label="Loading process details..." />
      </div>
    );
  }

  // Import mode - show simplified preview
  if (mode === 'import') {
    return (
      <div>
        <div className="page-header">
          <h2>Preview Import</h2>
          <p>Review import settings before proceeding</p>
        </div>

        <div className="card">
          <div className="card-title">Import Summary</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <strong>Import File:</strong>
              <div style={{ fontSize: 14, color: '#605e5c', marginTop: 4 }}>
                {importFilePath || 'Not selected'}
              </div>
            </div>
            <div>
              <strong>Target Account:</strong>
              <div style={{ fontSize: 14, color: '#605e5c', marginTop: 4 }}>
                {target.url}
              </div>
            </div>
            {targetProcessName && (
              <div style={{ gridColumn: '1 / -1' }}>
                <strong>Target Process Name:</strong>
                <div style={{ fontSize: 14, color: '#605e5c', marginTop: 4 }}>
                  {targetProcessName}
                </div>
              </div>
            )}
          </div>
          <p style={{ marginTop: 16, padding: 12, background: '#f3f2f1', borderRadius: 4, fontSize: 14 }}>
            The process will be imported from the selected file to the target account. 
            {targetProcessName 
              ? ` It will be created with the name "${targetProcessName}".`
              : ' The original process name from the file will be used.'
            }
          </p>
        </div>

        <div className="button-row" style={{ justifyContent: 'space-between' }}>
          <Button onClick={onBack}>Back to Setup</Button>
          <Button appearance="primary" size="large" onClick={onNext}>
            Continue to Import
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>Preview Process</h2>
        <p>Review the process structure before migration</p>
      </div>

      <div className="card">
        <div className="card-title">{sourceProcess?.name}</div>
        <p style={{ color: '#605e5c', marginBottom: 16 }}>{sourceDetails?.description || 'No description'}</p>
        
        <TabList selectedValue={selectedTab} onTabSelect={(_, data) => setSelectedTab(data.value as any)}>
          <Tab value="source">Process Structure</Tab>
          {mode !== 'export' && <Tab value="diff">Comparison</Tab>}
        </TabList>

        <Divider style={{ margin: '16px 0' }} />

        {selectedTab === 'source' ? (
          <div>
            {sourceDetails?.workItemTypes.map(wit => renderWorkItemType(wit))}
          </div>
        ) : (
          renderDiff()
        )}
      </div>

      <div className="button-row" style={{ justifyContent: 'space-between' }}>
        <Button onClick={onBack}>Back to Setup</Button>
        <Button appearance="primary" size="large" onClick={onNext}>
          Continue to Migrate
        </Button>
      </div>
    </div>
  );
}
