import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { Search, FileText, FileType, AlignLeft, Github, Globe, FileArchive, Sparkles, ArrowRight, Menu, Folder, FileCode } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';

const SOURCE_ICONS = {
  pdf: <FileText size={15} />,
  docx: <FileType size={15} />,
  txt: <AlignLeft size={15} />,
  repo: <Github size={15} />,
  repository: <Github size={15} />,
  web: <Globe size={15} />,
  md: <FileArchive size={15} />,
  markdown: <FileArchive size={15} />,
  text: <AlignLeft size={15} />,
  code: <FileCode size={15} />,
};

const SOURCE_COLORS = {
  pdf: { accent: '#ef4444', dim: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)' },
  docx: { accent: '#3b82f6', dim: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.2)' },
  txt: { accent: '#8b5cf6', dim: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.2)' },
  text: { accent: '#8b5cf6', dim: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.2)' },
  repo: { accent: '#10b981', dim: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)' },
  repository: { accent: '#10b981', dim: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)' },
  web: { accent: '#f59e0b', dim: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)' },
  md: { accent: '#0ea5e9', dim: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.2)' },
  markdown: { accent: '#0ea5e9', dim: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.2)' },
  code: { accent: '#f97316', dim: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.2)' },
};

export default function DiscoveryPage({ isMobile, onOpenMobileMenu }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [winWidth, setWinWidth] = useState(window.innerWidth);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    const handleResize = () => setWinWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    api.getGlobalDocuments()
      .then(docs => {
        setDocuments(docs || []);
        setLoading(false);
      })
      .catch(err => {
        toast?.(err.message, 'error');
        setLoading(false);
      });
  }, [toast]);

  const filteredDocs = useMemo(() => {
    if (!searchQuery) return documents;
    const q = searchQuery.toLowerCase();
    return documents.filter(d =>
      d.title.toLowerCase().includes(q) ||
      d.project_name.toLowerCase().includes(q) ||
      (d.summary && d.summary.toLowerCase().includes(q))
    );
  }, [documents, searchQuery]);

  // Top 3 recent docs as "Recently Added"
  const featured = useMemo(() => {
    if (searchQuery) return [];
    return [...documents].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 3);
  }, [documents, searchQuery]);

  const rest = useMemo(() => {
    if (searchQuery) return filteredDocs;
    const ids = new Set(featured.map(d => d.id));
    return documents.filter(d => !ids.has(d.id));
  }, [documents, featured, filteredDocs, searchQuery]);

  const getEffectiveType = (doc) => {
    let t = doc.source_type;
    if (t === 'web' && (doc.title?.toLowerCase().includes('github') || doc.source_url?.toLowerCase().includes('github'))) {
      return 'repository';
    }
    return t;
  };

  const sc = (doc) => {
    const type = getEffectiveType(doc);
    return SOURCE_COLORS[type] || { accent: 'var(--accent)', dim: 'var(--accent-dim)', border: 'var(--accent-border)' };
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-0)' }}>

        {/* Shared Workspace-style Header */}
        <header className="workspace-header" style={{
          padding: '0 20px', height: 60, borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          zIndex: 10, position: 'sticky', top: 0,
          backdropFilter: 'blur(30px)', background: 'var(--bg-glass)',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {isMobile && (
              <button className="hamburger-btn" onClick={onOpenMobileMenu} title="Open Menu" style={{
                width: 34, height: 34, borderRadius: 8, border: 'none',
                background: 'transparent', color: 'var(--text-3)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
              }}>
                <Menu size={18} />
              </button>
            )}
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.01em', margin: 0 }}>
              Global Discovery
            </h2>
          </div>
        </header>

        <div className="smooth-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: isMobile ? '24px 16px' : '48px 40px' }}>

            {/* Page Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: 32 }}>
              <div>
                <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, marginBottom: 6 }}>Discovery</h1>
                <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Explore all sources across your projects.</p>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                fontSize: 12, fontWeight: 600, background: 'var(--accent-dim)', color: 'var(--accent)',
                border: '1px solid var(--accent-border)', borderRadius: 100
              }}>
                <FileText size={14} />
                {winWidth < 680 ? documents.length : `${documents.length} sources`}
              </div>
            </div>

            {/* Search */}
            <div style={{ position: 'relative', marginBottom: 40 }}>
              <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
              <input
                type="text"
                placeholder="Search by title, workspace, or content..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%', padding: '14px 16px 14px 44px',
                  borderRadius: 'var(--r-lg)', border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-1)', color: 'var(--text)',
                  fontSize: 14, outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--accent-border)'; e.target.style.boxShadow = 'var(--input-focus-shadow)'; }}
                onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1, 2, 3].map(i => <div key={i} className="skel" style={{ height: 80 }} />)}
              </div>
            ) : documents.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '120px 40px', background: 'var(--bg-1)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)',
              }}>
                <FileText size={48} color="var(--text-4)" strokeWidth={1.5} style={{ marginBottom: 20 }} />
                <h3 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>No sources yet</h3>
                <p style={{ fontSize: 14, color: 'var(--text-3)' }}>Upload documents inside any project to see them here.</p>
              </div>
            ) : (
              <>
                {/* ═══ Recently Added ═══ */}
                {!searchQuery && featured.length > 0 && (
                  <section style={{ marginBottom: 48 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                      <Sparkles size={15} color="var(--accent)" />
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>Recently Added</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 16 }}>
                      {featured.map(doc => {
                        const c = sc(doc.source_type);
                        return (
                          <div key={doc.id} onClick={() => navigate(`/p/${doc.project_id}`)} style={{
                            background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                            padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
                            position: 'relative', overflow: 'hidden', cursor: 'pointer',
                            transition: 'border-color 0.2s ease',
                          }}
                            onMouseEnter={e => {
                              e.currentTarget.style.borderColor = c.border;
                              e.currentTarget.style.background = 'var(--bg-hover)';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.borderColor = 'var(--border)';
                              e.currentTarget.style.background = 'var(--bg-1)';
                            }}
                          >
                            {/* Colored top-right glow */}
                            <div style={{
                              position: 'absolute', top: -30, right: -30, width: 120, height: 120,
                              background: `radial-gradient(circle, ${c.accent}22 0%, transparent 70%)`,
                              pointerEvents: 'none'
                            }} />

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700,
                                textTransform: 'uppercase', letterSpacing: '0.04em', color: c.accent,
                                background: c.dim, padding: '4px 10px', borderRadius: 100,
                              }}>
                                {SOURCE_ICONS[getEffectiveType(doc)]} {getEffectiveType(doc)}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--text-4)' }}>{new Date(doc.created_at).toLocaleDateString()}</span>
                            </div>

                            <h3 style={{
                              fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0, lineHeight: 1.4, letterSpacing: '-0.01em',
                              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                            }}>
                              {doc.title}
                            </h3>

                            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, lineHeight: 1.5, flex: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {doc.source_url
                                ? new URL(doc.source_url).hostname.replace('www.', '')
                                : `${(doc.char_count / 1000).toFixed(0)}k chars · ${doc.source_type?.toUpperCase()}`
                              }
                            </p>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: 12 }}>
                              <span style={{ color: 'var(--text-3)' }}>
                                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{doc.project_name}</span>
                              </span>
                              <span style={{ color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                {(doc.char_count / 1000).toFixed(0)}k chars
                                <ArrowRight size={12} />
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* ═══ All Sources Table/Grid ═══ */}
                <section>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                    <FileArchive size={15} color="var(--text-3)" />
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>
                      {searchQuery ? 'Search Results' : 'All Sources'}
                    </span>
                  </div>

                  {(searchQuery && filteredDocs.length === 0) ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-3)', fontSize: 14 }}>No results for "{searchQuery}"</div>
                  ) : (
                    <div style={{
                      background: 'var(--bg-1)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden'
                    }}>
                      {isMobile ? (
                        // MOBILE STACKED VIEW
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          {rest.map((doc, i) => {
                            const c = sc(doc);
                            return (
                              <div key={doc.id} onClick={() => navigate(`/p/${doc.project_id}`)} style={{
                                padding: '16px', cursor: 'pointer',
                                display: 'flex', flexDirection: 'column', gap: 12,
                                borderBottom: i < rest.length - 1 ? '1px solid var(--border)' : 'none',
                                transition: 'background 0.15s ease'
                              }} onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                                  <div style={{ width: 32, height: 32, borderRadius: 'var(--r)', background: c.dim, color: c.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    {SOURCE_ICONS[getEffectiveType(doc)]}
                                  </div>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 }}>
                                      {doc.title}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                                      {(doc.char_count / 1000).toFixed(0)}k chars
                                    </div>
                                  </div>
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--bg-2)', padding: '6px 10px', borderRadius: 'var(--r)', alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Folder size={12} color="var(--text-4)" />
                                  <span className="workspace-link" style={{ transition: 'color 0.15s ease' }}>{doc.project_name}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        // DESKTOP GRID VIEW
                        <>
                          {/* Table Header */}
                          <div style={{
                            display: 'grid', gridTemplateColumns: '40% 30% 15% 15%',
                            padding: '12px 24px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.06em', color: 'var(--text-4)', borderBottom: '1px solid var(--border)'
                          }}>
                            <span style={{ paddingRight: 16 }}>Source</span>
                            <span style={{ paddingRight: 16 }}>Workspace</span>
                            <span style={{ paddingRight: 16 }}>Size</span>
                            <span style={{ textAlign: 'right' }}>Status</span>
                          </div>

                          {/* Table Rows */}
                          {rest.map((doc, i) => {
                            const c = sc(doc);
                            return (
                              <div key={doc.id} onClick={() => navigate(`/p/${doc.project_id}`)} style={{
                                display: 'grid', gridTemplateColumns: '40% 30% 15% 15%',
                                padding: '16px 24px', alignItems: 'center', cursor: 'pointer',
                                borderBottom: i < rest.length - 1 ? '1px solid var(--border)' : 'none',
                                transition: 'background 0.15s ease',
                              }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, paddingRight: 16 }}>
                                  <div style={{ width: 32, height: 32, borderRadius: 'var(--r)', background: c.dim, color: c.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    {SOURCE_ICONS[getEffectiveType(doc)]}
                                  </div>
                                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {doc.title}
                                  </div>
                                </div>

                                <div className="workspace-link" style={{ fontSize: 13, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 16, display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.15s ease' }}>
                                  <Folder size={14} color="var(--text-4)" style={{ flexShrink: 0 }} />
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.project_name}</span>
                                </div>

                                <div style={{ fontSize: 13, color: 'var(--text-3)', paddingRight: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {(doc.char_count / 1000).toFixed(0)}k chars
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
                                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
                                  Ready
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
