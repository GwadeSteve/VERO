import { useState, useEffect } from 'react';
import { Plus, ArrowRight, Folder, Clock, Trash2, Loader2, FileText, CheckSquare, Square, X, Layers, Sparkles, Menu } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/ui/Toast';

export default function ProjectsPage({ onRefreshProjects, isMobile, onOpenMobileMenu }) {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [desc, setDesc] = useState('');
    const [creating, setCreating] = useState(false);

    // Selection
    const [selected, setSelected] = useState(new Set());
    const [hovered, setHovered] = useState(null);

    const navigate = useNavigate();
    const toast = useToast();

    useEffect(() => { load(); }, []);

    const load = async () => {
        try { setProjects(await api.getProjects()); }
        catch { toast?.('Failed to load projects', 'error'); }
        finally { setLoading(false); }
    };

    const create = async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setCreating(true);
        try {
            const p = await api.createProject(name, desc);
            setProjects(prev => [...prev, p]);
            setShowForm(false); setName(''); setDesc('');
            toast?.(`Project "${p.name}" successfully created!`, 'success');
            onRefreshProjects?.();
            select(p.id);
        } catch (err) { toast?.(err.message, 'error'); }
        finally { setCreating(false); }
    };

    const select = (id) => { navigate(`/p/${id}`); };

    // ── Deletion logic ────────────────────────────────
    const deleteSelected = async () => {
        if (selected.size === 0) return;
        const count = selected.size;
        if (!window.confirm(`Are you sure you want to delete ${count} project${count > 1 ? 's' : ''}?`)) return;

        const toDelete = Array.from(selected);

        // Optimistic UI update
        setProjects(prev => prev.filter(p => !toDelete.includes(p.id)));
        setSelected(new Set());

        let failed = 0;
        for (const id of toDelete) {
            try { await api.deleteProject(id); }
            catch (err) { failed++; }
        }

        if (failed === 0) {
            toast?.(`Successfully deleted ${count} project${count > 1 ? 's' : ''}.`, 'success');
            onRefreshProjects?.();
        } else {
            toast?.(`Failed deleting ${failed} project${failed > 1 ? 's' : ''}.`, 'error');
            load(); // Reload to restore failed ones
        }
    };

    const toggleSelect = (e, id) => {
        e.stopPropagation();
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    };

    const toggleAll = (e) => {
        e.stopPropagation();
        if (selected.size === projects.length && projects.length > 0) {
            setSelected(new Set());
        } else {
            setSelected(new Set(projects.map(p => p.id)));
        }
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
                            Library
                        </h2>
                    </div>
                </header>

                <div className="smooth-scroll" style={{ flex: 1, overflowY: 'auto' }}>
                    <div style={{ maxWidth: 1100, margin: '0 auto', padding: isMobile ? '24px 16px' : '48px 40px' }}>

                        {/* Header Context */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: 40 }}>
                            <div style={{ flex: '1 1 300px' }}>
                                <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Projects</h1>
                                <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Isolated knowledge bases with their own documents and chat history.</p>
                            </div>
                            {projects.length > 0 && (
                                <button onClick={() => setShowForm(f => !f)} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 18px',
                                    fontSize: 13, fontWeight: 500, fontFamily: 'var(--font)',
                                    background: 'var(--accent)', color: 'var(--accent-text)',
                                    border: 'none', borderRadius: 'var(--r)',
                                    cursor: 'pointer', flexShrink: 0,
                                    width: isMobile ? '100%' : 'auto'
                                }}
                                    onMouseEnter={e => { e.currentTarget.style.opacity = 0.9; }}
                                    onMouseLeave={e => { e.currentTarget.style.opacity = 1; }}
                                >
                                    <Plus size={15} /> New Project
                                </button>
                            )}
                        </div>

                        {/* Create Form */}
                        {showForm && (
                            <form onSubmit={create} style={{
                                display: 'flex', 
                                flexDirection: isMobile ? 'column' : 'row',
                                gap: isMobile ? 10 : 12, marginBottom: 32,
                                padding: isMobile ? 16 : 24, background: 'var(--bg-1)', borderRadius: 'var(--r-lg)',
                                border: '1px solid var(--border)', 
                                alignItems: isMobile ? 'stretch' : 'flex-end',
                                animation: 'fadeIn 0.2s ease both',
                            }}>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project Name</label>
                                    <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Q4 Financial Reports"
                                        style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', padding: isMobile ? '8px 12px' : '10px 14px', borderRadius: 'var(--r)', fontSize: 14, fontFamily: 'var(--font)', outline: 'none', width: '100%' }}
                                        onFocus={e => e.target.style.borderColor = 'var(--accent-border)'}
                                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                                    />
                                </div>
                                <div style={{ flex: isMobile ? 'none' : 2, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description (Optional)</label>
                                    <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What is this workspace for?"
                                        style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', padding: isMobile ? '8px 12px' : '10px 14px', borderRadius: 'var(--r)', fontSize: 14, fontFamily: 'var(--font)', outline: 'none', width: '100%' }}
                                        onFocus={e => e.target.style.borderColor = 'var(--accent-border)'}
                                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                                    />
                                </div>
                                
                                <div style={{ 
                                    display: 'flex', 
                                    gap: 12, 
                                    marginTop: isMobile ? 4 : 0,
                                    width: isMobile ? '100%' : 'auto' 
                                }}>
                                    <button type="button" onClick={() => setShowForm(false)} style={{
                                        flex: isMobile ? 1 : 'none',
                                        padding: isMobile ? '8px 16px' : '10px 16px', background: 'none', border: '1px solid var(--border)',
                                        color: 'var(--text-3)', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font)',
                                    }}>Cancel</button>
                                    <button type="submit" disabled={creating || !name.trim()} style={{
                                        flex: isMobile ? 1 : 'none',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        padding: isMobile ? '8px 24px' : '10px 24px', background: 'var(--accent)', color: 'var(--accent-text)',
                                        border: 'none', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 13,
                                        fontWeight: 600, fontFamily: 'var(--font)', opacity: (creating || !name.trim()) ? 0.4 : 1
                                    }}>
                                        {creating ? <Loader2 size={14} className="spin" /> : 'Create'}
                                    </button>
                                </div>
                            </form>
                        )}

                        {/* Action Bar (When selected) */}
                        {selected.size > 0 && (
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '12px 20px', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
                                borderRadius: 'var(--r-lg)', marginBottom: 20, animation: 'fadeIn 0.15s ease both'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <button onClick={() => setSelected(new Set())} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', display: 'flex' }}><X size={16} /></button>
                                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--accent)' }}>{selected.size} project{selected.size > 1 ? 's' : ''} selected</span>
                                </div>
                                <button onClick={deleteSelected} style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 'var(--r)',
                                    padding: '6px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                                }}><Trash2 size={14} /> Delete Selected</button>
                            </div>
                        )}

                        {/* Content */}
                        {loading ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {[1, 2, 3].map(i => <div key={i} className="skel" style={{ height: 64 }} />)}
                            </div>
                        ) : projects.length === 0 ? (
                            /* ═══════════════════════════════════════
                               EMPTY STATE — Improved
                               ═══════════════════════════════════════ */
                            <div style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                padding: '120px 40px', background: 'var(--bg-1)',
                                borderRadius: 'var(--r-lg)', border: '1px solid var(--border)',
                                position: 'relative', overflow: 'hidden',
                                boxShadow: 'var(--shadow-sm)',
                            }}>
                                {/* Ambient glow */}
                                <div style={{
                                    position: 'absolute', top: 0, left: '50%', transform: 'translate(-50%, -50%)',
                                    width: 400, height: 400, background: 'var(--accent)', opacity: 0.04,
                                    filter: 'blur(80px)', borderRadius: '50%', pointerEvents: 'none'
                                }} />

                                {/* Icon */}
                                <div style={{
                                    width: 72, height: 72, borderRadius: 20, marginBottom: 28,
                                    background: 'var(--bg-2)', border: '1px solid var(--border)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: 'var(--shadow-md)', position: 'relative',
                                }}>
                                    <Layers size={32} color="var(--accent)" strokeWidth={1.5} />
                                </div>

                                {/* Text */}
                                <h3 style={{
                                    fontSize: 28, fontWeight: 700, marginBottom: 12, letterSpacing: '-0.02em',
                                    color: 'var(--text)', textAlign: 'center'
                                }}>
                                    No workspaces yet
                                </h3>
                                <p style={{
                                    fontSize: 15, color: 'var(--text-3)', lineHeight: 1.6, textAlign: 'center',
                                    maxWidth: 420, marginBottom: 16
                                }}>
                                    Your knowledge architecture begins here. Create your first isolated intelligent project to start syncing and querying documents.
                                </p>

                                {/* Feature pills */}
                                <div style={{ display: 'flex', gap: 8, marginBottom: 36, flexWrap: 'wrap', justifyContent: 'center' }}>
                                    {['PDF & DOCX', 'Semantic Search', 'AI Chat', 'Citations'].map(f => (
                                        <span key={f} style={{
                                            padding: '4px 12px', borderRadius: 100, fontSize: 11, fontWeight: 600,
                                            background: 'var(--accent-dim)', color: 'var(--accent)',
                                            border: '1px solid var(--accent-border)',
                                        }}>
                                            {f}
                                        </span>
                                    ))}
                                </div>

                                {/* Button */}
                                <button onClick={() => setShowForm(true)} style={{
                                    padding: '12px 28px', borderRadius: 'var(--r)', fontSize: 14, fontWeight: 600,
                                    fontFamily: 'var(--font)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                                    background: 'var(--accent)', color: 'var(--accent-text)', border: 'none',
                                    boxShadow: 'var(--submit-shadow)',
                                    transition: 'opacity 0.2s ease',
                                }}
                                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
                                    onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                                >
                                    <Sparkles size={16} strokeWidth={2} />
                                    Create First Project
                                </button>
                            </div>
                        ) : (
                            /* ═══════════════════════════════════════
                               TABLE-STYLE PROJECT LIST
                               ═══════════════════════════════════════ */
                            <div style={{ background: 'var(--bg-1)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                                {isMobile ? (
                                    // MOBILE STACKED LIST
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        {projects.map((p, i) => {
                                            const isSelected = selected.has(p.id);
                                            return (
                                                <div key={p.id}
                                                    onClick={() => select(p.id)}
                                                    style={{
                                                        display: 'flex', flexDirection: 'column', gap: 12,
                                                        padding: '16px', borderBottom: i < projects.length - 1 ? '1px solid var(--border)' : 'none',
                                                        cursor: 'pointer', background: isSelected ? 'var(--accent-dim)' : 'transparent',
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                            <div onClick={e => toggleSelect(e, p.id)} style={{ color: isSelected ? 'var(--accent)' : 'var(--text-4)' }}>
                                                                {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                                                            </div>
                                                            <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>{p.name}</span>
                                                        </div>
                                                        <ArrowRight size={16} color="var(--text-4)" />
                                                    </div>
                                                    
                                                    {p.description && (
                                                        <div style={{ fontSize: 13, color: 'var(--text-3)', paddingLeft: 30 }}>
                                                            {p.description}
                                                        </div>
                                                    )}

                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingLeft: 30, marginTop: 4 }}>
                                                        <div style={{ fontSize: 12, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <Clock size={12} /> {new Date(p.updated_at).toLocaleDateString()}
                                                        </div>
                                                        <div style={{ fontSize: 12, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <FileText size={12} color="var(--text-4)" /> {p.document_count ?? 0} docs
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    // DESKTOP GRID LIST
                                    <>
                                        {/* Table header */}
                                        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>
                                            <div onClick={toggleAll} style={{ width: 36, cursor: 'pointer', display: 'flex', color: selected.size === projects.length ? 'var(--accent)' : 'var(--text-4)' }}>
                                                {selected.size === projects.length ? <CheckSquare size={16} /> : <Square size={16} />}
                                            </div>
                                            <div style={{ flex: 1.5 }}>Name</div>
                                            <div style={{ flex: 2 }}>Description</div>
                                            <div style={{ width: 140 }}>Last Activity</div>
                                            <div style={{ width: 100 }}>Documents</div>
                                            <div style={{ width: 60 }}></div>
                                        </div>
                                        {/* Rows */}
                                        {projects.map(p => {
                                            const isSelected = selected.has(p.id);
                                            return (
                                                <div key={p.id}
                                                    onClick={() => select(p.id)}
                                                    onMouseEnter={() => setHovered(p.id)}
                                                    onMouseLeave={() => setHovered(null)}
                                                    style={{
                                                        display: 'flex', alignItems: 'center',
                                                        padding: '14px 20px', borderBottom: '1px solid var(--border)',
                                                        cursor: 'pointer',
                                                        background: isSelected ? 'var(--accent-dim)' : hovered === p.id ? 'var(--bg-hover)' : 'transparent',
                                                        transition: 'background 0.15s ease',
                                                    }}
                                                >
                                                    <div onClick={e => toggleSelect(e, p.id)} style={{ width: 36, display: 'flex', color: isSelected ? 'var(--accent)' : 'var(--text-4)', cursor: 'pointer' }}>
                                                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                                    </div>
                                                    <div style={{ flex: 1.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <span style={{ fontWeight: 500, fontSize: 14 }}>{p.name}</span>
                                                    </div>
                                                    <div style={{ flex: 2, color: 'var(--text-3)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 20 }}>
                                                        {p.description || 'No description'}
                                                    </div>
                                                    <div style={{ width: 140, fontSize: 12, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <Clock size={14} /> {new Date(p.updated_at).toLocaleDateString()}
                                                    </div>
                                                    <div style={{ width: 100, fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <FileText size={14} color="var(--text-4)" /> {p.document_count ?? 0}
                                                    </div>
                                                    <div style={{ width: 60, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                                                        <button
                                                            title="Delete Workspace"
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                if (window.confirm(`Delete workspace "${p.name}"? This cannot be undone.`)) {
                                                                    try {
                                                                        await api.deleteProject(p.id);
                                                                        setProjects(prev => prev.filter(x => x.id !== p.id));
                                                                        onRefreshProjects?.();
                                                                        toast?.('Workspace deleted.', 'success');
                                                                    } catch { toast?.('Failed to delete workspace.', 'error'); }
                                                                }
                                                            }}
                                                            style={{
                                                                width: 28, height: 28, borderRadius: 6, border: 'none',
                                                                background: 'transparent', color: 'var(--text-4)',
                                                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                transition: 'all 0.15s ease', opacity: hovered === p.id ? 1 : 0
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.background = 'transparent'; }}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                        <ArrowRight size={16} color={hovered === p.id ? 'var(--accent)' : 'var(--text-4)'} style={{ flexShrink: 0, transition: 'color 0.15s ease' }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
