import { Routes, Route, useNavigate, useLocation, matchPath } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from './api';
import Sidebar from './components/layout/Sidebar';
import ProjectsPage from './pages/ProjectsPage';
import WorkspacePage from './pages/WorkspacePage';

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const match = matchPath("/p/:projectId/c/:sessionId", location.pathname) || matchPath("/p/:projectId", location.pathname);
  const projectId = match?.params?.projectId || null;
  const activeSessionId = match?.params?.sessionId || null;

  const [projectName, setProjectName] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [sessions, setSessions] = useState([]);

  // Load project info
  useEffect(() => {
    if (projectId) {
      api.getProject(projectId).then(p => setProjectName(p.name)).catch(() => {
        // If project not found, redirect to home
        navigate('/');
      });
      api.getSessions(projectId).then(setSessions).catch(() => setSessions([]));
    } else {
      setProjectName('');
      setSessions([]);
    }
  }, [projectId, navigate]);

  const handleNewSession = async () => {
    if (!projectId) return;
    try {
      const s = await api.createSession(projectId);
      setSessions(prev => [s, ...prev]);
      navigate(`/p/${projectId}/c/${s.id}`);
    } catch { }
  };

  const handleSelectSession = async (sid) => {
    if (!sid) {
      navigate(`/p/${projectId}`);
    } else {
      navigate(`/p/${projectId}/c/${sid}`);
    }
  };

  // Refresh sessions when navigating to workspace
  useEffect(() => {
    if (location.pathname === '/workspace' && projectId) {
      api.getSessions(projectId).then(setSessions).catch(() => { });
    }
  }, [location.pathname, projectId]);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <Sidebar
        currentPath={location.pathname}
        onNavigate={p => navigate(p)}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        sessions={sessions}
        setSessions={setSessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        projectName={projectName}
      />
      <main style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <Routes location={location}>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/p/:projectId" element={<WorkspacePage projectId={projectId} activeSessionId={activeSessionId} setSessions={setSessions} />} />
          <Route path="/p/:projectId/c/:sessionId" element={<WorkspacePage projectId={projectId} activeSessionId={activeSessionId} setSessions={setSessions} />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
