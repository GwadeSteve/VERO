import { useState, useEffect } from 'react';
import {
  Home, Search, MessageSquare, Plus, PanelLeftClose, PanelLeftOpen,
  Layers, X, MoreHorizontal, ChevronDown, ChevronRight, User, Settings, LogOut, Folder
} from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../ui/Toast';

export default function Sidebar({
  currentPath, onNavigate, collapsed, setCollapsed,
  sessions, setSessions, projectId, activeSessionId, onSelectSession, onNewSession, projectName,
}) {
  const [recentProjects, setRecentProjects] = useState([]);
  const [hoveredSessionId, setHoveredSessionId] = useState(null);
  const [openSessionMenuId, setOpenSessionMenuId] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.getProjects().then(data => setRecentProjects(data.slice(0, 8))).catch(() => { });
  }, [currentPath, projectId, sessions]);

  const w = collapsed ? 64 : 260; // Claude style is spacious but balanced

  const DropdownItemStyle = {
    background: 'transparent', border: 'none', color: 'var(--text-2)',
    padding: '6px 8px', borderRadius: 4, cursor: 'pointer',
    fontSize: 13, display: 'flex', alignItems: 'center', transition: 'all 0.1s',
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
    { path: '/', icon: Home, label: 'Projects', action: () => onNavigate('/') },
    { path: 'new', icon: Plus, label: 'New Chat', action: onNewSession, primary: true },
    { path: '/workspace', icon: Search, label: 'Workspace', action: () => onNavigate(projectId ? `/p/${projectId}` : '/') },
  ];

  return (
    <aside style={{
      width: w, minWidth: w, height: '100vh',
      background: 'var(--bg-1)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
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
            <span style={{
              fontSize: 16, fontWeight: 700, letterSpacing: '-0.3px',
              color: 'var(--text)', transition: 'opacity 0.2s',
            }}>
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
            color: 'var(--text-4)', cursor: 'pointer', transition: 'all 0.2s',
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
                  padding: collapsed ? '10px 0' : '8px 12px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  background: isPrimary ? 'var(--text)' : 'transparent',
                  color: isPrimary ? 'var(--bg-0)' : 'var(--text-2)',
                  border: '1px solid transparent',
                  borderRadius: 8, cursor: 'pointer', fontSize: 13,
                  fontWeight: isPrimary ? 600 : 500,
                  transition: 'all 0.2s',
                  width: '100%',
                }}
                onMouseEnter={e => {
                  if (isPrimary) {
                    e.currentTarget.style.opacity = '0.9';
                  } else {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                    e.currentTarget.style.color = 'var(--text)';
                  }
                }}
                onMouseLeave={e => {
                  if (isPrimary) {
                    e.currentTarget.style.opacity = '1';
                  } else {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-2)';
                  }
                }}
              >
                <Icon size={16} strokeWidth={isPrimary ? 2.5 : 2} />
                {!collapsed && <span>{action.label}</span>}
              </button>
            );
          })}
        </div>

        {/* 3. Your Recent Projects */}
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginTop: 8 }}>
            <div
              style={{
                padding: '4px 24px', display: 'flex', alignItems: 'center', gap: 6,
                color: 'var(--text-4)', fontSize: 11, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4
              }}
            >
              Recent Projects
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 16px' }}>
              {recentProjects.length === 0 ? (
                <div style={{ padding: '12px', color: 'var(--text-4)', fontSize: 12, textAlign: 'center' }}>
                  No recent projects.
                </div>
              ) : (
                recentProjects.map(p => {
                  const isProjectActive = p.id === projectId;

                  return (
                    <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {/* Project Header */}
                      <div
                        onClick={() => { if (!isProjectActive) onNavigate(`/p/${p.id}`); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 10px', borderRadius: 8, cursor: isProjectActive ? 'default' : 'pointer',
                          fontSize: 13, fontWeight: isProjectActive ? 600 : 500,
                          color: isProjectActive ? 'var(--text)' : 'var(--text-2)',
                          background: isProjectActive ? 'var(--bg-3)' : 'transparent',
                          transition: 'all 0.1s',
                        }}
                        onMouseEnter={e => { if (!isProjectActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                        onMouseLeave={e => { if (!isProjectActive) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <Folder size={14} color={isProjectActive ? 'var(--accent)' : 'var(--text-3)'} fill={isProjectActive ? 'var(--accent-dim)' : 'transparent'} />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.name}
                        </span>
                      </div>

                      {/* Sessions nested under active project */}
                      {isProjectActive && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 12, marginTop: 2, marginBottom: 8 }}>
                          {sessions.length === 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--text-4)', padding: '4px 12px' }}>No chats yet.</div>
                          ) : sessions.map(s => {
                            const isActive = activeSessionId === s.id;
                            const isHovered = hoveredSessionId === s.id;

                            return (
                              <div
                                key={s.id}
                                onClick={() => onSelectSession(s.id)}
                                onMouseEnter={() => setHoveredSessionId(s.id)}
                                onMouseLeave={() => setHoveredSessionId(null)}
                                style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                  padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                                  fontSize: 13,
                                  color: isActive ? 'var(--text)' : 'var(--text-3)',
                                  background: isActive ? 'var(--bg-1)' : (isHovered ? 'var(--bg-hover)' : 'transparent'),
                                  position: 'relative',
                                }}
                              >
                                {/* Active indicator pill */}
                                {isActive && <div style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 3, background: 'var(--accent)', borderRadius: '0 4px 4px 0' }} />}

                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', paddingLeft: isActive ? 6 : 0 }}>
                                  <MessageSquare size={13} color="var(--text-4)" />
                                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: isActive ? 500 : 400 }}>
                                    {s.title || "Untitled Session"}
                                  </span>
                                </div>

                                {/* Options Menu on Hover */}
                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                  {(isHovered || isActive || openSessionMenuId === s.id) && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setOpenSessionMenuId(openSessionMenuId === s.id ? null : s.id); }}
                                      style={{
                                        background: openSessionMenuId === s.id ? 'var(--bg-2)' : 'none',
                                        border: 'none', color: 'var(--text-4)', cursor: 'pointer', padding: 4, borderRadius: 4,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      }}
                                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.background = openSessionMenuId === s.id ? 'var(--bg-2)' : 'transparent'; }}
                                    >
                                      <MoreHorizontal size={14} />
                                    </button>
                                  )}

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
                              </div>
                            );
                          })}
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
        padding: '12px', borderTop: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 8
      }}>
        {!collapsed && projectName && currentPath === '/workspace' && (
          <div style={{
            padding: '10px 12px',
            background: 'var(--bg-2)', borderRadius: 8,
            border: '1px solid var(--border)',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: 'var(--text-4)',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4
            }}>
              Active Workspace
            </div>
            <div style={{
              fontSize: 12, color: 'var(--accent)', fontWeight: 600,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
              {projectName}
            </div>
          </div>
        )}

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: collapsed ? '8px 0' : '8px 12px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderRadius: 8, cursor: 'pointer', position: 'relative',
          background: profileMenuOpen ? 'var(--bg-hover)' : 'transparent',
          transition: 'background 0.2s',
        }}
          onClick={() => !collapsed && setProfileMenuOpen(!profileMenuOpen)}
          onMouseEnter={e => !profileMenuOpen && (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={e => !profileMenuOpen && (e.currentTarget.style.background = 'transparent')}
        >
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--bg-3)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, overflow: 'hidden'
          }}>
            <User size={14} color="var(--text-3)" />
          </div>
          {!collapsed && (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Admin User
              </div>
            </div>
          )}
          {!collapsed && <MoreHorizontal size={14} color="var(--text-4)" />}

          {/* Profile Dropdown */}
          {profileMenuOpen && !collapsed && (
            <div style={{
              position: 'absolute', bottom: '110%', left: 0, width: '100%', marginBottom: 4,
              background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8,
              padding: 4, display: 'flex', flexDirection: 'column', gap: 2,
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 60,
            }}>
              <button onClick={(e) => { e.stopPropagation(); toast?.('Settings not implemented', 'info'); setProfileMenuOpen(false); }} style={{ ...DropdownItemStyle, padding: '8px 10px' }}>
                <Settings size={14} style={{ marginRight: 8 }} /> Settings
              </button>
              <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
              <button onClick={(e) => { e.stopPropagation(); toast?.('Logged out', 'info'); setProfileMenuOpen(false); }} style={{ ...DropdownItemStyle, padding: '8px 10px', color: 'var(--red)' }}>
                <LogOut size={14} style={{ marginRight: 8 }} /> Log Out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
