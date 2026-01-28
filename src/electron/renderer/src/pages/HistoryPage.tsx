import React, { useState, useEffect } from 'react';
import {
  Button,
  Spinner,
} from '@fluentui/react-components';
import {
  Delete24Regular,
  History24Regular,
} from '@fluentui/react-icons';

interface HistoryEntry {
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

export function HistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const entries = await window.electronAPI.getHistory();
      setHistory(entries);
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    if (confirm('Are you sure you want to clear all history?')) {
      await window.electronAPI.clearHistory();
      setHistory([]);
    }
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getStatusBadge = (status: string) => {
    return <span className={`status-badge ${status}`}>{status}</span>;
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'export': return 'Export';
      case 'import': return 'Import';
      case 'migrate': return 'Migrate';
      default: return mode;
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <Spinner size="large" label="Loading history..." />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Migration History</h2>
          <p>View past migration operations</p>
        </div>
        {history.length > 0 && (
          <Button icon={<Delete24Regular />} onClick={clearHistory}>
            Clear History
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <History24Regular style={{ fontSize: 48, marginBottom: 16, color: '#605e5c' }} />
            <h3>No Migration History</h3>
            <p>Your migration history will appear here after you run your first migration.</p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Mode</th>
                <th>Process</th>
                <th>Source → Target</th>
                <th>Duration</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    {new Date(entry.startedAt).toLocaleDateString()}<br />
                    <span style={{ fontSize: 12, color: '#605e5c' }}>
                      {new Date(entry.startedAt).toLocaleTimeString()}
                    </span>
                  </td>
                  <td>{getModeLabel(entry.mode)}</td>
                  <td>
                    {entry.sourceProcessName}
                    {entry.targetProcessName !== entry.sourceProcessName && (
                      <span style={{ color: '#605e5c' }}> → {entry.targetProcessName}</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {new URL(entry.sourceUrl).hostname}
                    {entry.mode !== 'export' && (
                      <><br />→ {new URL(entry.targetUrl).hostname}</>
                    )}
                  </td>
                  <td>{formatDuration(entry.duration)}</td>
                  <td>
                    {getStatusBadge(entry.status)}
                    {entry.error && (
                      <div style={{ fontSize: 11, color: '#a4262c', marginTop: 4 }}>
                        {entry.error.substring(0, 50)}...
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
