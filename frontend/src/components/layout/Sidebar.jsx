import { useState, useEffect } from 'react';
import {
  Home, Search, MessageSquare, Plus, PanelLeftClose, PanelLeftOpen,
  Layers, X, MoreHorizontal, ChevronDown, ChevronRight, User, Settings, LogOut, Folder,
  Compass, Activity, BookOpen
} from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../ui/Toast';

export default function Sidebar({
  currentPath, onNavigate, collapsed, setCollapsed,
  sessions, setSessions, projectId, activeSessionId, onSelectSession, onNewSession, projectName, onRefreshProjects, refreshToggle, isFetchingSessions
}) {
  const [recentProjects, setRecentProjects] = useState([]);
  const [projectsListOpen, setProjectsListOpen] = useState(true);
  const [expandedProjectIds, setExpandedProjectIds] = useState(new Set());
  const [cachedSessions, setCachedSessions] = useState({}); // { projectId: { data: sessions[], timestamp: ms } }
  const [loadingProjectIds, setLoadingProjectIds] = useState(new Set()); // Which project sessions are being fetched
  const [hoveredSessionId, setHoveredSessionId] = useState(null);
  const [hoveredProjectId, setHoveredProjectId] = useState(null);
  const [openSessionMenuId, setOpenSessionMenuId] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const toast = useToast();

  // Update cache when active project sessions change
  useEffect(() => {
    if (projectId && sessions) {
      setCachedSessions(prev => ({ ...prev, [projectId]: { data: sessions, timestamp: Date.now() } }));
    }
  }, [projectId, sessions]);

  // Auto-expand active project
  useEffect(() => {
    if (projectId) {
      setExpandedProjectIds(prev => new Set(prev).add(projectId));
    }
  }, [projectId]);

  const fetchProjects = () => {
    api.getProjects().then(data => setRecentProjects(data.slice(0, 8))).catch(() => { });
  };

  useEffect(() => {
    fetchProjects();
    // Simply fetch projects on activity. Do not wipe the cache violently here, 
    // to preserve snappy "offline" toggling back to recently opened projects.
  }, [currentPath, projectId, sessions, refreshToggle]);

  const expandAndFetchProject = async (pid) => {
    setExpandedProjectIds(prev => new Set(prev).add(pid));
    setLoadingProjectIds(prev => new Set(prev).add(pid));
    try {
      const s = await api.getSessions(pid);
      setCachedSessions(prev => ({ ...prev, [pid]: { data: s, timestamp: Date.now() } }));
    } catch { }
    setLoadingProjectIds(prev => {
      const n = new Set(prev);
      n.delete(pid);
      return n;
    });
  };

  const toggleProject = async (pid) => {
    const next = new Set(expandedProjectIds);
    if (next.has(pid)) {
      next.delete(pid);
      setExpandedProjectIds(next);
    } else {
      expandAndFetchProject(pid);
    }
  };

  const w = collapsed ? 64 : 260;

  const DropdownItemStyle = {
    background: 'transparent', border: 'none', color: 'var(--text-2)',
    padding: '6px 8px', borderRadius: 4, cursor: 'pointer',
    fontSize: 13, display: 'flex', alignItems: 'center',
    width: '100%', textAlign: 'left',
  };

  const handleDeleteSession = async (sid) => {
    if (!window.confirm('Are you sure you want to delete this conversation?')) return;
    try {
      await api.deleteSession(sid);
      setSessions(prev => prev.filter(s => s.id !== sid));
      if (activeSessionId === sid) {
        onSelectSession(null);
      }
      toast?.('Conversation removed.', 'success');
    } catch (err) {
      toast?.('Failed removing conversation.', 'error');
    }
    setOpenSessionMenuId(null);
  };

  const quickActions = [
    { id: 'new', icon: Plus, label: 'New Chat', action: onNewSession, primary: true },
    { id: 'library', icon: BookOpen, label: 'Library', action: () => onNavigate('/') },
    { id: 'discovery', icon: Compass, label: 'Discovery', action: () => toast?.('Global Discovery coming soon', 'info') },
    { id: 'activity', icon: Activity, label: 'Activity', action: () => toast?.('Activity monitoring coming soon', 'info') },
  ];

  return (
    <aside style={{
      width: w, minWidth: w, height: '100vh',
      background: 'var(--bg-1)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', flexShrink: 0,
      position: 'relative',
    }}>
      {/* 1. Header: Logo & Toggle */}
      <div
        style={{
          padding: '16px 16px',
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          height: 60, flexShrink: 0,
        }}
      >
        {!collapsed && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '4px', borderRadius: 8,
            }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'var(--accent-dim)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--accent-border)',
              flexShrink: 0,
            }}>
              <Layers size={16} color="var(--accent)" />
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text)' }}>
              VERO
            </span>
          </div>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); setCollapsed(c => !c); }}
          style={{
            background: 'transparent', border: 'none',
            width: 30, height: 30, borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-4)', cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.background = 'transparent'; }}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', paddingTop: 16 }}>
        {/* 2. Quick Actions */}
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 32 }}>
          {quickActions.map((action, i) => {
            const Icon = action.icon;
            const isPrimary = action.primary;
            return (
              <button
                key={i}
                onClick={action.action}
                title={collapsed ? action.label : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: collapsed ? '10px 0' : (isPrimary ? '10px 14px' : '8px 12px'),
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  background: isPrimary ? '#FFFFFF' : 'transparent',
                  color: isPrimary ? '#000000' : 'var(--text-2)',
                  border: '1px solid transparent',
                  borderRadius: 8, cursor: 'pointer', fontSize: 13,
                  fontWeight: isPrimary ? 600 : 500,
                  width: '100%',
                  boxShadow: 'none',
                  marginBottom: isPrimary ? 8 : 0
                }}
                onMouseEnter={e => {
                  if (!isPrimary) {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                    e.currentTarget.style.color = 'var(--text)';
                  }
                }}
                onMouseLeave={e => {
                  if (!isPrimary) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-2)';
                  }
                }}
              >
                <Icon size={16} strokeWidth={isPrimary ? 2.5 : 2} color={isPrimary ? '#000000' : undefined} />
                {!collapsed && <span>{action.label}</span>}
              </button>
            );
          })}
        </div>

        {/* 3. Your Recent Projects */}
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginTop: 8 }}>
            <div
              onClick={() => setProjectsListOpen(!projectsListOpen)}
              style={{
                padding: '4px 24px', display: 'flex', alignItems: 'center', gap: 6,
                color: 'var(--text-4)', fontSize: 11, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4,
                cursor: 'pointer'
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-2)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-4)'}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 14 }}>
                {projectsListOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>
              Recent Projects
            </div>

            <div style={{ display: projectsListOpen ? 'flex' : 'none', flexDirection: 'column', gap: 6, padding: '0 16px' }}>
              {recentProjects.length === 0 ? (
                <div style={{ padding: '12px', color: 'var(--text-4)', fontSize: 12, textAlign: 'center' }}>
                  No recent projects.
                </div>
              ) : (
                recentProjects.map(p => {
                  const isProjectActive = p.id === projectId;
                  const isHoveredProject = hoveredProjectId === p.id;

                  return (
                    <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div
                        style={{
                          display: 'flex', alignItems: 'center', gap: 2,
                          paddingRight: 4, borderRadius: 8,
                          background: isProjectActive ? 'var(--bg-3)' : (isHoveredProject ? 'var(--bg-hover)' : 'transparent'),
                          color: isProjectActive ? 'var(--text)' : (isHoveredProject ? 'var(--text)' : 'var(--text-2)'),
                        }}
                        onMouseEnter={() => setHoveredProjectId(p.id)}
                        onMouseLeave={() => setHoveredProjectId(null)}
                      >
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleProject(p.id); }}
                          style={{
                            background: 'none', border: 'none', color: isHoveredProject ? 'var(--text-2)' : 'var(--text-4)',
                            width: 24, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', padding: 0
                          }}
                        >
                          {expandedProjectIds.has(p.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>

                        <div
                          onClick={() => {
                            if (!isProjectActive) {
                              onNavigate(`/p/${p.id}`);
                              expandAndFetchProject(p.id);
                            } else {
                              toggleProject(p.id);
                            }
                          }}
                          style={{
                            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 4px', cursor: 'pointer',
                            fontSize: 13, fontWeight: isProjectActive ? 600 : 500,
                            color: 'inherit',
                            overflow: 'hidden'
                          }}
                        >
                          <Folder size={14} color={isProjectActive ? 'var(--accent)' : (isHoveredProject ? 'var(--text)' : 'var(--text-3)')} fill={isProjectActive ? 'var(--accent-dim)' : 'transparent'} />
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {p.name}
                          </span>
                        </div>
                      </div>

                      {expandedProjectIds.has(p.id) && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 12, marginTop: 2, marginBottom: 8 }}>
                          {(() => {
                            const cachedEntry = cachedSessions[p.id];
                            const pSessions = isProjectActive ? sessions : (cachedEntry?.data || []);
                            const isLoading = loadingProjectIds.has(p.id) || (isProjectActive && isFetchingSessions);

                            if (isLoading) {
                              return [1, 2, 3].map(k => (
                                <div key={k} style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 14, height: 14, borderRadius: 4, background: 'var(--bg-2)', opacity: 0.5 }} className="skel" />
                                  <div style={{ height: 10, borderRadius: 4, flex: 1, background: 'var(--bg-2)', opacity: 0.5 }} className="skel" />
                                </div>
                              ));
                            }
                            if (pSessions.length === 0) {
                              return <div style={{ fontSize: 12, color: 'var(--text-4)', padding: '4px 20px' }}>No chats yet.</div>;
                            }
                            return pSessions.map(s => {
                              const isActive = activeSessionId === s.id;
                              const isHovered = hoveredSessionId === s.id;

                              return (
                                <div
                                  key={s.id}
                                  onClick={() => onSelectSession(s.id, p.id)}
                                  onMouseEnter={() => setHoveredSessionId(s.id)}
                                  onMouseLeave={() => setHoveredSessionId(null)}
                                  style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                                    fontSize: 13, minHeight: 34,
                                    color: isActive ? 'var(--text)' : (isHovered ? 'var(--text)' : 'var(--text-3)'),
                                    background: isActive ? 'var(--bg-1)' : (isHovered ? 'var(--bg-hover)' : 'transparent'),
                                    position: 'relative',
                                  }}
                                >
                                  {isActive && <div style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 3, background: 'var(--accent)', borderRadius: '0 4px 4px 0' }} />}

                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                                    <MessageSquare size={13} color={isActive ? 'var(--text)' : (isHovered ? 'var(--text)' : 'var(--text-4)')} fill={isActive ? 'var(--bg-1)' : 'transparent'} />
                                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: isActive ? 500 : 400 }}>
                                      {s.title || "Untitled Session"}
                                    </span>
                                  </div>

                                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: 24, height: 22, justifyContent: 'center', flexShrink: 0 }}>
                                    {(isHovered || isActive || openSessionMenuId === s.id) && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setOpenSessionMenuId(openSessionMenuId === s.id ? null : s.id); }}
                                        style={{
                                          background: openSessionMenuId === s.id ? 'var(--bg-2)' : 'none',
                                          border: 'none', color: isHovered ? 'var(--text)' : 'var(--text-4)', cursor: 'pointer', padding: 4, borderRadius: 4,
                                          display: 'flex', alignItems: 'center', justifyContent: 'center', height: 22, width: 22
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--bg-2)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = openSessionMenuId === s.id ? 'var(--bg-2)' : 'transparent'; }}
                                      >
                                        <MoreHorizontal size={14} />
                                      </button>
                                    )}
                                  </div>

                                  {openSessionMenuId === s.id && (
                                    <div style={{
                                      position: 'absolute', top: '100%', right: 0, marginTop: 4,
                                      background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6,
                                      padding: 4, display: 'flex', flexDirection: 'column', gap: 2,
                                      boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 50, minWidth: 120,
                                    }}>
                                      <button onClick={(e) => { e.stopPropagation(); toast?.('Rename not yet implemented', 'info'); setOpenSessionMenuId(null); }} style={DropdownItemStyle}>Rename</button>
                                      <button onClick={(e) => { e.stopPropagation(); toast?.('Pin not yet implemented', 'info'); setOpenSessionMenuId(null); }} style={DropdownItemStyle}>Pin</button>
                                      <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
                                      <button onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }} style={{ ...DropdownItemStyle, color: 'var(--red)' }}>Delete</button>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* 4. User Profile Footer */}
      <div style={{
        padding: '16px', borderTop: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 12,
        background: 'linear-gradient(to top, var(--bg-0), transparent)'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: collapsed ? '8px 0' : '10px 12px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderRadius: 12, cursor: 'pointer', position: 'relative',
          background: profileMenuOpen ? 'var(--bg-hover)' : 'transparent',
          border: profileMenuOpen ? '1px solid var(--border)' : '1px solid transparent',
        }}
          onClick={() => !collapsed && setProfileMenuOpen(!profileMenuOpen)}
          onMouseEnter={e => !profileMenuOpen && (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={e => !profileMenuOpen && (e.currentTarget.style.background = 'transparent')}
        >
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}>
            <User size={18} color="var(--bg-0)" />
          </div>
          {!collapsed && (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Admin User
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 500 }}>
                AI Researcher
              </div>
            </div>
          )}
          {!collapsed && <div style={{ color: 'var(--text-4)' }}><MoreHorizontal size={14} /></div>}

          {/* Profile Dropdown */}
          {profileMenuOpen && !collapsed && (
            <div style={{
              position: 'absolute', bottom: '115%', left: 0, width: '100%', marginBottom: 4,
              background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12,
              padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 60,
              backdropFilter: 'blur(10px)'
            }}>
              <button onClick={(e) => { e.stopPropagation(); toast?.('Settings not implemented', 'info'); setProfileMenuOpen(false); }} style={{ ...DropdownItemStyle, padding: '10px 12px', borderRadius: 8 }}>
                <Settings size={14} style={{ marginRight: 10 }} /> Settings
              </button>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              <button onClick={(e) => { e.stopPropagation(); toast?.('Logged out', 'info'); setProfileMenuOpen(false); }} style={{ ...DropdownItemStyle, padding: '10px 12px', borderRadius: 8, color: 'var(--red)' }}>
                <LogOut size={14} style={{ marginRight: 10 }} /> Log Out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
