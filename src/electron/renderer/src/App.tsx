import React, { useState } from 'react';
import { 
  Tooltip,
} from '@fluentui/react-components';
import {
  Settings24Regular,
  ArrowSync24Regular,
  History24Regular,
  Eye24Regular,
  Folder24Regular,
  TagMultiple24Regular,
} from '@fluentui/react-icons';
import { SetupPage } from './pages/SetupPage';
import { PreviewPage } from './pages/PreviewPage';
import { ProjectPage } from './pages/ProjectPage';
import { WorkItemsPage } from './pages/WorkItemsPage';
import { MigratePage } from './pages/MigratePage';
import { HistoryPage } from './pages/HistoryPage';
import { useMigrationStore } from './store/migrationStore';

type Page = 'setup' | 'preview' | 'project' | 'workitems' | 'migrate' | 'history';

export function App() {
  const [currentPage, setCurrentPage] = useState<Page>('setup');
  const { source, target, sourceProcess } = useMigrationStore();

  const isConnected = source.isConnected && target.isConnected;

  const navItems = [
    { id: 'setup' as Page, label: 'Setup', icon: <Settings24Regular /> },
    { id: 'preview' as Page, label: 'Preview', icon: <Eye24Regular />, disabled: !sourceProcess },
    { id: 'project' as Page, label: 'Project', icon: <Folder24Regular />, disabled: !isConnected },
    { id: 'workitems' as Page, label: 'Work Items', icon: <TagMultiple24Regular />, disabled: !isConnected },
    { id: 'migrate' as Page, label: 'Migrate', icon: <ArrowSync24Regular />, disabled: !isConnected },
    { id: 'history' as Page, label: 'History', icon: <History24Regular /> },
  ];

  const renderPage = () => {
    switch (currentPage) {
      case 'setup':
        return <SetupPage onNext={() => setCurrentPage('preview')} onSkipToProject={() => setCurrentPage('project')} />;
      case 'preview':
        return <PreviewPage onNext={() => setCurrentPage('project')} onBack={() => setCurrentPage('setup')} />;
      case 'project':
        return <ProjectPage onNext={() => setCurrentPage('workitems')} onBack={() => sourceProcess ? setCurrentPage('preview') : setCurrentPage('setup')} />;
      case 'workitems':
        return <WorkItemsPage onNext={() => setCurrentPage('migrate')} onBack={() => setCurrentPage('project')} />;
      case 'migrate':
        return <MigratePage onBack={() => setCurrentPage('workitems')} />;
      case 'history':
        return <HistoryPage />;
      default:
        return <SetupPage onNext={() => setCurrentPage('preview')} />;
    }
  };

  return (
    <div className="app-container">
      <div className="titlebar" />
      <nav className="sidebar">
        <div className="sidebar-header">
          <h1>Process Migrator</h1>
          <p>Azure DevOps</p>
        </div>
        {navItems.map((item) => (
          <Tooltip
            content={
              item.disabled
                ? item.id === 'preview'
                  ? 'Select a source process first'
                  : 'Connect source and target accounts first'
                : item.label
            }
            relationship="label"
            key={item.id}
          >
            <div
              className={`nav-item ${currentPage === item.id ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
              onClick={() => !item.disabled && setCurrentPage(item.id)}
              style={{ opacity: item.disabled ? 0.5 : 1, cursor: item.disabled ? 'not-allowed' : 'pointer' }}
            >
              {item.icon}
              <span>{item.label}</span>
            </div>
          </Tooltip>
        ))}
      </nav>
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}
