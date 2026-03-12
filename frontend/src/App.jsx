import { Routes, Route, useNavigate, useLocation, matchPath } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from './api';
import Sidebar from './components/layout/Sidebar';
import ProjectsPage from './pages/ProjectsPage';
import WorkspacePage from './pages/WorkspacePage';
import { useToast } from './components/ui/Toast';
import { useIsMobile } from './hooks/useMediaQuery';

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const match = matchPath("/p/:projectId/c/:sessionId", location.pathname) || matchPath("/p/:projectId", location.pathname);
  const projectId = match?.params?.projectId || null;
  const activeSessionId = match?.params?.sessionId || null;

  const [projectName, setProjectName] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [isFetchingSessions, setIsFetchingSessions] = useState(false);
  const [refreshToggle, setRefreshToggle] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();

  // Load project info
  useEffect(() => {
    if (projectId) {
      setIsFetchingSessions(true);
      api.getProject(projectId).then(p => {
        if (!p) throw new Error('Not found');
        setProjectName(p.name);
      }).catch(() => {
        // If project not found, redirect to home
        navigate('/');
      });
      api.getSessions(projectId).then(s => {
        setSessions(s || []);
        setIsFetchingSessions(false);
      }).catch(() => {
        setSessions([]);
        setIsFetchingSessions(false);
      });
    } else {
      setProjectName('');
      setSessions([]);
      setIsFetchingSessions(false);
    }
  }, [projectId, navigate]);

  const handleNewSession = async () => {
    if (!projectId) {
      toast?.('Please select or create a project first.', 'info');
      navigate('/');
      return;
    }
    try {
      const s = await api.createSession(projectId);
      setSessions(prev => [s, ...prev]);
      setRefreshToggle(t => !t); // Move to top of recent projects
      navigate(`/p/${projectId}/c/${s.id}`);
    } catch { }
  };

  const handleSelectSession = async (sid, pid = projectId) => {
    if (!sid) {
      navigate(`/p/${pid}`);
    } else {
      navigate(`/p/${pid}/c/${sid}`);
    }
  };



  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      {/* Mobile sidebar overlay backdrop */}
      {isMobile && (
        <div
          className={`sidebar-overlay ${mobileMenuOpen ? 'active' : ''}`}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile sidebar (overlay drawer) */}
      {isMobile && (
        <div className={`sidebar-mobile ${mobileMenuOpen ? 'open' : ''}`}>
          <Sidebar
            currentPath={location.pathname}
            onNavigate={p => { navigate(p); setMobileMenuOpen(false); }}
            collapsed={false}
            setCollapsed={setCollapsed}
            sessions={sessions}
            setSessions={setSessions}
            activeSessionId={activeSessionId}
            onSelectSession={(sid, pid) => { handleSelectSession(sid, pid); setMobileMenuOpen(false); }}
            onNewSession={() => { handleNewSession(); setMobileMenuOpen(false); }}
            projectName={projectName}
            projectId={projectId}
            onRefreshProjects={() => setRefreshToggle(t => !t)}
            refreshToggle={refreshToggle}
            isFetchingSessions={isFetchingSessions}
            isMobile={true}
            onCloseMobile={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Desktop sidebar (hidden on mobile via CSS) */}
      <div className="sidebar-desktop">
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
          projectId={projectId}
          onRefreshProjects={() => setRefreshToggle(t => !t)}
          refreshToggle={refreshToggle}
          isFetchingSessions={isFetchingSessions}
        />
      </div>

      <main style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <Routes location={location}>
          <Route path="/" element={<ProjectsPage onRefreshProjects={() => setRefreshToggle(t => !t)} />} />
          <Route path="/p/:projectId/*" element={
            <WorkspacePage
              key={projectId}
              projectId={projectId}
              activeSessionId={activeSessionId}
              setSessions={setSessions}
              onRefreshProjects={() => setRefreshToggle(t => !t)}
              isMobile={isMobile}
              onOpenMobileMenu={() => setMobileMenuOpen(true)}
            />
          } />
        </Routes>
      </main>
    </div>
  );
}

export default App;
