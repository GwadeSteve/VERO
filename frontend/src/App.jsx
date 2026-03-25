import { Routes, Route, useNavigate, useLocation, matchPath } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api, waitForServer } from './api';
import Sidebar from './components/layout/Sidebar';
import ProjectsPage from './pages/ProjectsPage';
import WorkspacePage from './pages/WorkspacePage';
import DiscoveryPage from './pages/DiscoveryPage';
import ActivityPage from './pages/ActivityPage';
import { useToast } from './components/ui/Toast';
import { useIsMobile } from './hooks/useMediaQuery';

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [serverReady, setServerReady] = useState(false);

  // Gate: poll /health before allowing any API calls
  useEffect(() => {
    let cancelled = false;
    waitForServer().then(ok => {
      if (!cancelled) {
        setServerReady(ok);
        if (!ok) console.error('[VERO] Server did not respond after retries');
      }
    });
    return () => { cancelled = true; };
  }, []);

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

  // Load project info — only after server is ready
  useEffect(() => {
    if (!serverReady) return;
    if (projectId) {
      setIsFetchingSessions(true);
      api.getProject(projectId).then(p => {
        if (!p) throw new Error('Not found');
        setProjectName(p.name);
      }).catch(() => {
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
  }, [projectId, navigate, serverReady]);

  const handleNewSession = async () => {
    if (!projectId) {
      toast?.('Please select or create a project first.', 'info');
      navigate('/');
      return;
    }
    try {
      const s = await api.createSession(projectId);
      setSessions(prev => [s, ...prev]);
      setRefreshToggle(t => !t);
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

  // ── Loading screen while server warms up ──
  if (!serverReady) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', width: '100vw', background: 'var(--bg-0)', gap: 20,
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'pulse 2s ease-in-out infinite',
        }}>
          <img src="/vero.svg" alt="VERO" style={{ width: 32, height: 32, objectFit: 'contain' }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            Starting VERO
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 500 }}>
            Warming up ML models…
          </div>
        </div>
        <div style={{
          width: 120, height: 3, borderRadius: 2, background: 'var(--bg-2)', overflow: 'hidden',
        }}>
          <div style={{
            width: '40%', height: '100%', borderRadius: 2,
            background: 'var(--accent)',
            animation: 'loading-bar 1.5s ease-in-out infinite',
          }} />
        </div>
        <style>{`
          @keyframes loading-bar {
            0%   { transform: translateX(-100%); }
            50%  { transform: translateX(200%); }
            100% { transform: translateX(-100%); }
          }
        `}</style>
      </div>
    );
  }

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
          <Route path="/" element={<ProjectsPage onRefreshProjects={() => setRefreshToggle(t => !t)} isMobile={isMobile} onOpenMobileMenu={() => setMobileMenuOpen(true)} />} />
          <Route path="/discovery" element={<DiscoveryPage isMobile={isMobile} onOpenMobileMenu={() => setMobileMenuOpen(true)} />} />
          <Route path="/activity" element={<ActivityPage isMobile={isMobile} onOpenMobileMenu={() => setMobileMenuOpen(true)} />} />
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
