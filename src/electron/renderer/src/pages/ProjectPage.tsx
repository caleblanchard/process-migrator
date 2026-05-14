import React, { useState, useEffect } from 'react';
import {
  Button,
  Radio,
  RadioGroup,
  Field,
  Input,
  Spinner,
  MessageBar,
  MessageBarBody,
  Dropdown,
  Option,
} from '@fluentui/react-components';
import { useMigrationStore } from '../store/migrationStore';

interface ProjectPageProps {
  onNext: () => void;
  onBack: () => void;
}

export function ProjectPage({ onNext, onBack }: ProjectPageProps) {
  const {
    source, target, sourceProcess,
    sourceProjectName, setSourceProjectName,
    targetProjectName, setTargetProjectName,
    project, setProject,
  } = useMigrationStore();

  const [sourceProjects, setSourceProjects] = useState<any[]>([]);
  const [targetProjects, setTargetProjects] = useState<any[]>([]);
  const [loadingSource, setLoadingSource] = useState(false);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  // Load source projects once source is connected
  useEffect(() => {
    if (!source.isConnected) { return; }
    setLoadingSource(true);
    window.electronAPI.listProjects(source.url, source.token)
      .then(setSourceProjects)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoadingSource(false));
  }, [source.isConnected]);

  // Load target projects when action is useExisting and target is connected
  useEffect(() => {
    if (!target.isConnected || project.action !== 'useExisting') { return; }
    setLoadingTarget(true);
    const loadFn = sourceProcess?.id
      ? window.electronAPI.listProjectsByProcess(target.url, target.token, sourceProcess.id)
      : window.electronAPI.listProjects(target.url, target.token);
    loadFn
      .then(setTargetProjects)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoadingTarget(false));
  }, [target.isConnected, project.action, sourceProcess?.id]);

  const handleCreateProject = async () => {
    setError(null);
    setCreating(true);
    try {
      await window.electronAPI.createProject(
        target.url,
        target.token,
        targetProjectName,
        project.description || '',
        sourceProcess?.id || ''
      );
      setCreated(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const canProceed = (() => {
    if (!sourceProjectName) { return false; }
    if (project.action === 'none') { return true; }
    if (project.action === 'create') { return !!targetProjectName && (created || true); }
    if (project.action === 'useExisting') { return !!targetProjectName; }
    return false;
  })();

  return (
    <div>
      <div className="page-header">
        <h2>Target Project</h2>
        <p>Select the source project and configure the target project</p>
      </div>

      {error && (
        <MessageBar intent="error" style={{ marginBottom: 16 }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {/* Source project */}
      <div className="card">
        <div className="card-title">Source Project</div>
        {loadingSource ? (
          <Spinner label="Loading projects..." />
        ) : (
          <Field label="Select source project to migrate work items from">
            <Dropdown
              placeholder="Select a project..."
              value={sourceProjectName}
              onOptionSelect={(_e, data) => setSourceProjectName(data.optionValue as string)}
            >
              {sourceProjects.map((p: any) => (
                <Option key={p.id || p.name} value={p.name}>{p.name}</Option>
              ))}
            </Dropdown>
          </Field>
        )}
        <p style={{ fontSize: 12, color: '#605e5c', marginTop: 8 }}>
          Only required for work item migration. Leave empty to skip work item migration.
        </p>
      </div>

      {/* Target project action */}
      <div className="card">
        <div className="card-title">Target Project Action</div>
        <RadioGroup
          value={project.action}
          onChange={(_e, data) => {
            setProject({ action: data.value as any });
            setCreated(false);
          }}
        >
          <Radio value="none" label="Skip — process migration only (no project or work items)" />
          <Radio value="create" label="Create a new project on the target org" disabled={!target.isConnected} />
          <Radio value="useExisting" label="Use an existing project on the target org" disabled={!target.isConnected} />
        </RadioGroup>

        {/* Create new project */}
        {project.action === 'create' && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="New project name" required>
              <Input
                value={targetProjectName}
                onChange={(_, d) => setTargetProjectName(d.value)}
                placeholder="e.g. MyProject"
              />
            </Field>
            <Field label="Description (optional)">
              <Input
                value={project.description || ''}
                onChange={(_, d) => setProject({ description: d.value })}
                placeholder="Project description"
              />
            </Field>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button
                appearance="secondary"
                onClick={handleCreateProject}
                disabled={!targetProjectName || creating || !sourceProcess?.id}
              >
                {creating ? <Spinner size="tiny" /> : null}
                {creating ? ' Creating...' : 'Create Project Now'}
              </Button>
              {created && (
                <span style={{ color: '#107c10', fontSize: 13 }}>✓ Project created successfully</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: '#605e5c' }}>
              The project will use the imported process template. You can also create it during migration.
            </p>
          </div>
        )}

        {/* Use existing project */}
        {project.action === 'useExisting' && (
          <div style={{ marginTop: 16 }}>
            {loadingTarget ? (
              <Spinner label="Loading target projects..." />
            ) : (
              <Field label="Select existing target project">
                <Dropdown
                  placeholder="Select a project..."
                  value={targetProjectName}
                  onOptionSelect={(_e, data) => setTargetProjectName(data.optionValue as string)}
                >
                  {targetProjects.map((p: any) => (
                    <Option key={p.id || p.name} value={p.name}>{p.name}</Option>
                  ))}
                </Dropdown>
              </Field>
            )}
            {targetProjects.length === 0 && !loadingTarget && (
              <p style={{ fontSize: 12, color: '#605e5c', marginTop: 8 }}>
                {sourceProcess ? 'No projects found using this process template.' : 'Connect target account to list projects.'}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="button-row" style={{ justifyContent: 'space-between' }}>
        <Button onClick={onBack}>Back</Button>
        <Button appearance="primary" onClick={onNext} disabled={!canProceed}>
          Next: Work Items
        </Button>
      </div>
    </div>
  );
}
