import React, { useState } from 'react';
import { 
  Tooltip,
} from '@fluentui/react-components';
import {
  Settings24Regular,
  ArrowSync24Regular,
  History24Regular,
  Eye24Regular,
} from '@fluentui/react-icons';
import { SetupPage } from './pages/SetupPage';
import { PreviewPage } from './pages/PreviewPage';
import { MigratePage } from './pages/MigratePage';
import { HistoryPage } from './pages/HistoryPage';
import { useMigrationStore } from './store/migrationStore';

type Page = 'setup' | 'preview' | 'migrate' | 'history';

export function App() {
  const [currentPage, setCurrentPage] = useState<Page>('setup');
  const { sourceProcess } = useMigrationStore();

  const navItems = [
    { id: 'setup' as Page, label: 'Setup', icon: <Settings24Regular /> },
    { id: 'preview' as Page, label: 'Preview', icon: <Eye24Regular />, disabled: !sourceProcess },
    { id: 'migrate' as Page, label: 'Migrate', icon: <ArrowSync24Regular />, disabled: !sourceProcess },
    { id: 'history' as Page, label: 'History', icon: <History24Regular /> },
  ];

  const renderPage = () => {
    switch (currentPage) {
      case 'setup':
        return <SetupPage onNext={() => setCurrentPage('preview')} />;
      case 'preview':
        return <PreviewPage onNext={() => setCurrentPage('migrate')} onBack={() => setCurrentPage('setup')} />;
      case 'migrate':
        return <MigratePage onBack={() => setCurrentPage('preview')} />;
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
          <Tooltip content={item.disabled ? 'Complete setup first' : item.label} relationship="label" key={item.id}>
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
