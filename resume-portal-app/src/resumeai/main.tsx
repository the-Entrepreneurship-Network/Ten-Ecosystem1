import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './AppShell';
import Agent from './pages/Agent';
import Applications from './pages/Applications';
import Cover from './pages/Cover';
import Create from './pages/Create';
import Dashboard from './pages/Dashboard';
import Hunt from './pages/Hunt';
import Keywords from './pages/Keywords';
import Library from './pages/Library';
import Review from './pages/Review';
import Settings from './pages/Settings';
import './theme.css';

/*
 * Hash routing, on purpose.
 *
 * This ships as static files under /resume-ai/ behind an Express server that
 * knows nothing about the client's routes — so a browser refresh on
 * /resume-ai/review would ask the server for a file that does not exist and
 * get a 404. A hash keeps every route on one real document, which is the
 * whole requirement.
 */
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="create" element={<Create />} />
          <Route path="agent" element={<Agent />} />
          <Route path="review" element={<Review />} />
          <Route path="keywords" element={<Keywords />} />
          <Route path="cover" element={<Cover />} />
          <Route path="hunt" element={<Hunt />} />
          <Route path="applications" element={<Applications />} />
          <Route path="library" element={<Library />} />
          <Route path="settings" element={<Settings />} />
          {/* Anything else is a typo, not a page. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
