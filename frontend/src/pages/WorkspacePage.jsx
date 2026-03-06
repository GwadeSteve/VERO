import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/ui/Toast';
import {
    Send, Search, Loader2, FileText, ArrowUp,
    RefreshCw, User, Bot, CheckCircle2, UploadCloud, Globe,
    X, ChevronRight, FileArchive, Wand2, Info, Layers, Clock, Edit2, Pin, Trash2,
    FileType, AlignLeft, FileCode, Github, Link, Plus
} from 'lucide-react';

export default function WorkspacePage({ projectId, activeSessionId, setSessions, onRefreshProjects }) {
    // Project info
    const [project, setProject] = useState(null);

    // Docs & ingestion
    const [docs, setDocs] = useState([]);
    const [docsLoading, setDocsLoading] = useState(true);
    const [ingesting, setIngesting] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [url, setUrl] = useState('');
    const [showUrl, setShowUrl] = useState(false);

    // Chat
    const [messages, setMessages] = useState([]);
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [traceResults, setTraceResults] = useState([]);
    const [activeCitationDoc, setActiveCitationDoc] = useState(null);
    const [activeCitationChunk, setActiveCitationChunk] = useState(null); // { srcNum, text, doc_title }
    const [modelKnowledge, setModelKnowledge] = useState(false);

    const chatEndRef = useRef(null);
    const fileRef = useRef(null);
    const isCreatingSession = useRef(false);
    const toast = useToast();
    const navigate = useNavigate();

    // Load project & docs on PID change
    useEffect(() => {
        if (projectId) {
            // Reset chat state immediately on project switch
            setMessages([]);
            setTraceResults([]);
            setStreamingText('');
            setIsStreaming(false);
            setSearching(false);

            loadProject();
            fetchDocs();
        }
        return () => {
            setSearching(false);
            setIsStreaming(false);
        };
    }, [projectId]);

    // Load session messages on SID change
    useEffect(() => {
        if (activeSessionId) {
            // Skip loading if we just created this session optimistic update
            if (isCreatingSession.current) {
                isCreatingSession.current = false;
                return;
            }
            loadSession(activeSessionId);
        } else {
            setMessages([]);
            setTraceResults([]);
            setStreamingText('');
            setIsStreaming(false);
        }
    }, [activeSessionId]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streamingText, searching, isStreaming]);

    const loadProject = async () => {
        try { setProject(await api.getProject(projectId)); } catch { }
    };

    const fetchDocs = async () => {
        setDocsLoading(true);
        try { setDocs((await api.getDocuments(projectId)) || []); }
        catch (e) { console.error(e); }
        finally { setDocsLoading(false); }
    };

    const loadSession = async (sid) => {
        try {
            const s = await api.getSession(sid);
            if (!s) throw new Error("Session not found");
            setMessages((s.messages || []).map(m => ({ role: m.role, text: m.content })));
            // Reset trace/citations when switching sessions
            setTraceResults([]);
            setActiveCitationDoc(null);
        } catch (err) {
            toast?.('Failed to load conversation history.', 'error');
            navigate(`/p/${projectId}`);
        }
    };

    const handleDeleteProject = async () => {
        if (window.confirm('Are you sure you want to delete this workspace? This action cannot be undone.')) {
            try {
                await api.deleteProject(projectId);
                toast?.('Workspace deleted.', 'success');
                onRefreshProjects?.();
                navigate('/');
            } catch (err) {
                toast?.('Failed to delete workspace.', 'error');
            }
        }
    };

    // ── Streaming simulation ─────────────────────────
    const streamText = (fullText, onDone) => {
        setIsStreaming(true);
        setStreamingText('');
        const words = fullText.split(' ');
        let i = 0;
        const iv = setInterval(() => {
            if (i < words.length) {
                setStreamingText(prev => prev + (i > 0 ? ' ' : '') + words[i]);
                i++;
            } else {
                clearInterval(iv);
                setIsStreaming(false);
                setStreamingText('');
                onDone(fullText);
            }
        }, 25);
    };

    const pollStatus = (docTitle) => {
        const iv = setInterval(async () => {
            try {
                const allDocs = await api.getDocuments(projectId);
                setDocs(allDocs);
                const doc = allDocs.find(d => d.title === docTitle);
                if (doc?.processing_status === 'ready') {
                    toast?.(`"${docTitle}" is ready for chat.`, 'success');
                    clearInterval(iv);
                } else if (doc?.processing_status === 'error') {
                    clearInterval(iv);
                }
            } catch { clearInterval(iv); }
        }, 2500);
        setTimeout(() => clearInterval(iv), 60000);
    };

    // ── Ingestion ────────────────────────────────────
    const ingestFile = async (file) => {
        if (!file || !projectId) return;

        const allowedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
            'text/plain',
            'text/markdown',
            'text/csv'
        ];

        if (!allowedTypes.includes(file.type) && !file.name.endsWith('.md') && !file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
            toast?.(`Unsupported file format: ${file.name}. Please upload PDF, DOCX, TXT, MD, or CSV.`, 'error');
            return;
        }

        setIngesting(true);
        const shortName = file.name.length > 20 ? file.name.substring(0, 20) + '...' : file.name;
        toast?.(`File ${shortName} processing...`, 'info');
        try {
            const doc = await api.ingestFile(projectId, file);
            if (fileRef.current) fileRef.current.value = '';
            await fetchDocs();
            pollStatus(doc.title);
            onRefreshProjects?.();
        } catch (err) { toast?.('Import failed.', 'error'); }
        finally { setIngesting(false); }
    };

    const handleDrop = useCallback((e) => {
        e.preventDefault(); setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) ingestFile(f);
    }, [projectId]);

    const handleUrlIngest = async (e) => {
        e.preventDefault();
        if (!url.trim() || !projectId) return;

        const isRepo = url.includes('github.com');
        const prefix = isRepo ? 'Repo' : 'Web';
        const cleanUrl = url.replace(/https?:\/\/(www\.)?/, '');
        const shortUrl = cleanUrl.length > 25 ? cleanUrl.substring(0, 25) + '...' : cleanUrl;

        setIngesting(true);
        toast?.(`${prefix} ${shortUrl} processing...`, 'info');
        try {
            const doc = await api.ingestUrl(projectId, url);
            setUrl(''); setShowUrl(false);
            await fetchDocs();
            pollStatus(doc.title);
            onRefreshProjects?.();
        } catch (err) { toast?.('Import failed', 'error'); }
        finally { setIngesting(false); }
    };

    // ── Chat ─────────────────────────────────────────
    const send = async (e) => {
        e?.preventDefault();
        if (!query.trim() || !projectId || searching || docs.length === 0) return;

        const q = query.trim();
        setQuery('');
        setMessages(prev => [...prev, { role: 'user', text: q }]);
        setSearching(true);
        setTraceResults([]); setActiveCitationDoc(null);

        try {
            let sid = activeSessionId;
            if (!sid) {
                isCreatingSession.current = true;
                const s = await api.createSession(projectId, q.substring(0, 40));
                sid = s.id;
                navigate(`/p/${projectId}/c/${sid}`, { replace: true });
                if (setSessions) setSessions(prev => [s, ...prev]);
                onRefreshProjects?.();
            }

            // 1. Semantic Retrieval
            const sr = await api.hybridSearch(projectId, q);
            const searchResults = sr?.results || [];
            setTraceResults(searchResults);

            // 2. LLM Chat
            const cr = await api.chat(sid, q, modelKnowledge);
            onRefreshProjects?.(); // Re-sort project list on activity

            setSearching(false);
            streamText(cr?.answer || "No response generated.", (fullText) => {
                setMessages(prev => [...prev, {
                    role: 'assistant', text: fullText,
                    citations: cr?.citations || [],
                    traces: searchResults, // Store traces with this message
                    sufficient: cr?.found_sufficient_info,
                }]);
            });
        } catch (err) {
            setMessages(prev => [...prev, { role: 'error', text: 'Issues connecting to VERO intelligence.' }]);
            setSearching(false);
        }
    };

    const getPreciseStatus = (doc) => {
        const s = doc.processing_status;
        if (s === 'ready') return { label: 'Knowledge Ready', color: 'var(--green)', icon: CheckCircle2 };
        if (s === 'processing') return { label: 'Step 1/3: Extracting Text', color: 'var(--accent)', icon: Loader2 };
        if (s === 'chunking') return { label: 'Step 2/3: Semantic Splitting', color: 'var(--accent)', icon: Loader2 };
        if (s === 'embedding') return { label: 'Step 3/3: Vectorizing Context', color: 'var(--accent)', icon: Loader2 };
        if (s === 'error') return { label: 'Sync Failed', color: 'var(--red)', icon: X };
        return { label: 'In Queue', color: 'var(--text-4)', icon: Clock };
    };

    if (!projectId) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-4)', background: 'var(--bg-0)' }}>
                <Layers size={48} strokeWidth={1} style={{ marginBottom: 20, opacity: 0.2 }} />
                <p style={{ fontSize: 16, color: 'var(--text-3)', fontWeight: 500 }}>Select a workspace to begin</p>
            </div>
        );
    }

    const isFile = (t) => {
        const ext = t?.toLowerCase() || '';
        return ext.endsWith('.pdf') || ext.endsWith('.doc') || ext.endsWith('.docx') || ext.endsWith('.txt') || ext.endsWith('.md') || ext.endsWith('.csv');
    };

    // ── Document type icon helper ─────────────────────
    const getDocIcon = (title) => {
        const t = title?.toLowerCase() || '';
        if (t.endsWith('.pdf')) return { icon: FileText, color: 'var(--red)' };
        if (t.endsWith('.doc') || t.endsWith('.docx')) return { icon: FileType, color: '#2b579a' };
        if (t.endsWith('.txt')) return { icon: AlignLeft, color: 'var(--text-2)' };
        if (t.endsWith('.md')) return { icon: FileCode, color: '#e34c26' };
        if (t.includes('github')) return { icon: Github, color: 'var(--text)' };
        if (!isFile(t)) return { icon: Globe, color: 'var(--accent)' };
        return { icon: FileArchive, color: 'var(--text-4)' };
    };

    const pdfCount = docs.filter(d => d.title?.toLowerCase()?.endsWith('.pdf')).length;
    const wordCount = docs.filter(d => d.title?.toLowerCase()?.endsWith('.doc') || d.title?.toLowerCase()?.endsWith('.docx')).length;
    const txtCount = docs.filter(d => d.title?.toLowerCase()?.endsWith('.txt')).length;
    const mdCount = docs.filter(d => d.title?.toLowerCase()?.endsWith('.md')).length;
    const githubCount = docs.filter(d => d.title?.toLowerCase()?.includes('github')).length;

    // Web links usually don't have file extensions, and are not github repos
    const linkCount = docs.filter(d => !isFile(d.title) && !d.title?.toLowerCase()?.includes('github')).length;

    // For anything absolutely unknown
    const otherCount = docs.length - (pdfCount + wordCount + txtCount + mdCount + githubCount + linkCount);

    const lastActive = project?.updated_at ? new Date(project.updated_at).toLocaleDateString() : 'Active Now';

    // Pre-calculate traces by doc
    const docTraces = {};
    traceResults.forEach((r, i) => {
        if (!docTraces[r.doc_title]) docTraces[r.doc_title] = [];
        docTraces[r.doc_title].push({ ...r, index: i });
    });

    // ── Inline [Source N] parser ─────────────────────
    const renderTextWithSources = (text, traces) => {
        if (!text || !traces?.length) return text;
        const parts = text.split(/(\[Source \d+\])/gi);
        return parts.map((part, i) => {
            const match = part.match(/^\[Source (\d+)\]$/i);
            if (match) {
                const num = parseInt(match[1]);
                const trace = traces[num - 1];
                const isChunkActive = activeCitationChunk?.srcNum === num;
                return (
                    <span key={i}
                        onClick={() => {
                            if (trace) {
                                // Toggle the chunk drill-down
                                setActiveCitationChunk(isChunkActive ? null : { srcNum: num, text: trace.text, doc_title: trace.doc_title, score: trace.score });
                                setActiveCitationDoc(trace.doc_title);
                                setTimeout(() => {
                                    const el = document.getElementById(`doc-${trace.doc_title}`);
                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }, 50);
                            }
                        }}
                        title={trace ? `From: ${trace.doc_title}` : `Source ${num}`}
                        style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            padding: '0 7px', margin: '0 2px', borderRadius: 5, minWidth: 20,
                            background: isChunkActive ? 'var(--accent)' : 'var(--accent-dim)',
                            border: '1px solid var(--accent-border)',
                            color: isChunkActive ? 'var(--bg-0)' : 'var(--accent)',
                            fontSize: 11, fontWeight: 800,
                            cursor: trace ? 'pointer' : 'default', lineHeight: '20px',
                            verticalAlign: 'middle', transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => { if (trace && !isChunkActive) { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = 'var(--bg-0)'; } }}
                        onMouseLeave={e => { if (trace && !isChunkActive) { e.currentTarget.style.background = 'var(--accent-dim)'; e.currentTarget.style.color = 'var(--accent)'; } }}
                    >
                        {num}
                    </span>
                );
            }
            return part;
        });
    };

    return (
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

            {/* ═══════ CENTER: Main Chat ═══════ */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-0)' }}>

                {/* Workspace Header - Minimal & Rich */}
                <header style={{
                    padding: '12px 32px', borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', zIndex: 10, position: 'sticky', top: 0,
                    backdropFilter: 'blur(30px)', background: 'rgba(11, 13, 16, 0.75)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div>
                            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.01em', marginBottom: 2 }}>
                                {project?.name || 'Workspace'}
                            </h2>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--text-4)', fontWeight: 500 }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Clock size={12} /> {lastActive}
                                </span>
                                {docs.length > 0 && (
                                    <>
                                        <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--border)' }} />
                                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                            {pdfCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-3)' }}><FileText size={12} color="var(--red)" /> {pdfCount} PDFs</span>}
                                            {wordCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-3)' }}><FileType size={12} color="#2b579a" /> {wordCount} Words</span>}
                                            {txtCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-3)' }}><AlignLeft size={12} color="var(--text-2)" /> {txtCount} Texts</span>}
                                            {mdCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-3)' }}><FileCode size={12} color="#e34c26" /> {mdCount} MDs</span>}
                                            {githubCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-3)' }}><Github size={12} color="var(--text)" /> {githubCount} Repos</span>}
                                            {linkCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-3)' }}><Globe size={12} color="var(--accent)" /> {linkCount} Links</span>}
                                            {otherCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-3)' }}><FileArchive size={12} color="var(--text-4)" /> {otherCount} Docs</span>}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                    {/* Header Quick Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button title="Pin Workspace" style={{
                            width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent',
                            color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.2s ease'
                        }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-1)'; e.currentTarget.style.color = 'var(--text)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; }}>
                            <Pin size={16} />
                        </button>
                        <button title="Rename Workspace" style={{
                            width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent',
                            color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.2s ease'
                        }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-1)'; e.currentTarget.style.color = 'var(--text)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; }}>
                            <Edit2 size={16} />
                        </button>
                        <button title="Delete Workspace" onClick={handleDeleteProject} style={{
                            width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent',
                            color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.2s ease'
                        }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--red-dim)'; e.currentTarget.style.color = 'var(--red)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; }}>
                            <Trash2 size={16} />
                        </button>
                    </div>
                </header>

                {/* Main Header End */}

                {/* Chat Feed */}
                <div style={{ flex: 1, overflowY: 'auto', scrollPaddingBottom: 100 }}>
                    {messages.length === 0 && !searching && !isStreaming ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
                            <div style={{
                                width: 80, height: 80, borderRadius: 24, background: 'var(--accent-dim)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid var(--accent-border)', marginBottom: 24,
                                animation: 'pulse 3s infinite ease-in-out'
                            }}>
                                <Layers size={40} color="var(--accent)" />
                            </div>
                            <h3 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>
                                AI Knowledge Hub
                            </h3>
                            <p style={{ fontSize: 15, maxWidth: 460, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.6 }}>
                                {docs.length === 0
                                    ? "Import documents to build your workspace intelligence."
                                    : "Ask questions, explore documents, and generate insights based on your imported data."}
                            </p>

                            {docs.length === 0 && (
                                <button onClick={() => fileRef.current?.click()} style={{
                                    marginTop: 24, padding: '12px 24px', background: 'var(--accent)', color: 'var(--bg-0)',
                                    border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 10px 20px var(--accent-dim)'
                                }}>
                                    <UploadCloud size={18} /> Import First Document
                                </button>
                            )}
                        </div>
                    ) : (
                        <div style={{ paddingBottom: 40, padding: '32px 32px' }}>
                            {messages.map((m, i) => (
                                <div key={i} style={{
                                    maxWidth: 840, margin: '0 auto',
                                    display: 'flex',
                                    justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                                    marginBottom: 32,
                                    animation: 'fadeIn 0.3s ease both',
                                }}>
                                    {m.role === 'assistant' || m.role === 'error' ? (
                                        <div style={{ display: 'flex', gap: 20, maxWidth: '100%' }}>
                                            <div style={{
                                                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                                                background: 'var(--accent)', color: 'var(--bg-0)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                boxShadow: '0 4px 12px var(--accent-dim)'
                                            }}>
                                                <Layers size={16} strokeWidth={2.5} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
                                                <div style={{
                                                    fontSize: 15, lineHeight: 1.7, color: m.role === 'error' ? 'var(--red)' : 'var(--text)',
                                                    whiteSpace: 'pre-wrap', fontWeight: 400
                                                }}>
                                                    {m.traces?.length > 0 ? renderTextWithSources(m.text, m.traces) : m.text}
                                                </div>

                                                {/* Grouped Source Documents */}
                                                {m.traces?.length > 0 && (() => {
                                                    const grouped = {};
                                                    m.traces.forEach((t, idx) => {
                                                        if (!grouped[t.doc_title]) grouped[t.doc_title] = { title: t.doc_title, items: [] };
                                                        grouped[t.doc_title].items.push({ ...t, srcNum: idx + 1 });
                                                    });
                                                    const docList = Object.values(grouped);
                                                    return (
                                                        <div style={{ marginTop: 20, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
                                                            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                                                                Sources Referenced
                                                            </div>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                                {docList.map((doc, di) => {
                                                                    const isActive = activeCitationDoc === doc.title;
                                                                    return (
                                                                        <div key={di} onClick={() => {
                                                                            setActiveCitationDoc(isActive ? null : doc.title);
                                                                            if (!isActive) setTimeout(() => {
                                                                                const el = document.getElementById(`doc-${doc.title}`);
                                                                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                            }, 50);
                                                                        }} style={{
                                                                            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                                                                            borderRadius: 10, cursor: 'pointer',
                                                                            background: isActive ? 'var(--accent-dim)' : 'var(--bg-1)',
                                                                            border: isActive ? '1px solid var(--accent-border)' : '1px solid transparent',
                                                                            transition: 'all 0.2s ease'
                                                                        }}
                                                                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                                                                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-1)'; }}
                                                                        >
                                                                            <FileText size={14} color={isActive ? 'var(--accent)' : 'var(--text-4)'} />
                                                                            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: isActive ? 'var(--text)' : 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                                {doc.title}
                                                                            </span>
                                                                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                                                {doc.items.map(item => {
                                                                                    const isChunkActive = activeCitationChunk?.srcNum === item.srcNum;
                                                                                    return (
                                                                                        <span key={item.srcNum}
                                                                                            onClick={(e) => {
                                                                                                e.stopPropagation();
                                                                                                setActiveCitationChunk(isChunkActive ? null : { srcNum: item.srcNum, text: item.text, doc_title: item.doc_title, score: item.score });
                                                                                                setActiveCitationDoc(item.doc_title);
                                                                                                if (!isChunkActive) setTimeout(() => {
                                                                                                    const el = document.getElementById(`doc-${item.doc_title}`);
                                                                                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                                                }, 50);
                                                                                            }}
                                                                                            style={{
                                                                                                fontSize: 10, fontWeight: 800, width: 20, height: 20,
                                                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                                borderRadius: 5, cursor: 'pointer',
                                                                                                background: isChunkActive ? 'var(--accent)' : 'var(--accent-dim)',
                                                                                                color: isChunkActive ? 'var(--bg-0)' : 'var(--accent)',
                                                                                                border: '1px solid var(--accent-border)',
                                                                                                transition: 'all 0.15s ease'
                                                                                            }}
                                                                                        >
                                                                                            {item.srcNum}
                                                                                        </span>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{
                                            background: 'var(--bg-1)', color: 'var(--text)',
                                            padding: '12px 20px', borderRadius: '18px', borderBottomRightRadius: 4,
                                            border: '1px solid var(--border)',
                                            maxWidth: '85%', fontSize: 15, lineHeight: 1.6, fontWeight: 400,
                                            whiteSpace: 'pre-wrap'
                                        }}>
                                            {m.text}
                                        </div>
                                    )}
                                </div>
                            ))}

                            {isStreaming && (
                                <div style={{ padding: '0 32px 32px', maxWidth: 840, margin: '0 auto', display: 'flex', gap: 20 }}>
                                    <div style={{
                                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                                        background: 'var(--accent)', color: 'var(--bg-0)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        boxShadow: '0 4px 12px var(--accent-dim)'
                                    }}>
                                        <Layers size={16} strokeWidth={2.5} />
                                    </div>
                                    <div style={{ flex: 1, paddingTop: 4 }}>
                                        <div className="streaming-cursor" style={{ fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap', fontWeight: 400 }}>
                                            {streamingText}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {searching && !isStreaming && (
                                <div style={{ padding: '0 32px 32px', maxWidth: 840, margin: '0 auto', display: 'flex', gap: 20, alignItems: 'center' }}>
                                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <Loader2 size={16} className="spin" />
                                    </div>
                                    <div>
                                        <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 700, letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                            Synthesizing...
                                        </span>
                                    </div>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>
                    )}
                </div>

                {/* Input Zone */}
                <div style={{ padding: '24px 32px', background: 'var(--bg-0)' }}>
                    <form onSubmit={send} style={{
                        maxWidth: 840, margin: '0 auto', position: 'relative',
                        background: 'rgba(21, 24, 32, 0.4)', backdropFilter: 'blur(24px)',
                        border: '1px solid var(--border)',
                        borderRadius: 24, padding: '12px 16px',
                        display: 'flex', flexDirection: 'column', gap: 12,
                        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                        ...(docs.length === 0 ? { opacity: 0.7, pointerEvents: 'none' } : {})
                    }}
                        onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--text-4)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.2)'; }}
                        onBlurCapture={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)'; }}
                    >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 4 }}>
                                <Layers size={18} color="var(--text-3)" />
                            </div>
                            <textarea
                                value={query}
                                onChange={e => {
                                    setQuery(e.target.value);
                                    e.target.style.height = 'auto';
                                    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                                }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        send(e);
                                    }
                                }}
                                disabled={docs.length === 0 || searching || isStreaming}
                                placeholder={docs.length === 0 ? "Import documents to start your workspace..." : "Ask VERO anything about this workspace..."}
                                rows={1}
                                style={{
                                    flex: 1, border: 'none', background: 'transparent', color: 'var(--text)',
                                    padding: '8px 0', fontSize: 15, fontFamily: 'var(--font)',
                                    outline: 'none', fontWeight: 500, resize: 'none',
                                    minHeight: 40, maxHeight: 200, lineHeight: 1.5,
                                    overflowY: 'auto'
                                }}
                            />
                            <button type="submit" disabled={!query.trim() || searching || isStreaming || docs.length === 0}
                                style={{
                                    width: 40, height: 40, borderRadius: 12, border: 'none', flexShrink: 0,
                                    background: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'var(--bg-3)' : 'var(--text)',
                                    color: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'var(--text-3)' : 'var(--bg-0)',
                                    cursor: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.2s ease', alignSelf: 'flex-end',
                                    boxShadow: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'none' : '0 4px 12px rgba(255,255,255,0.2)'
                                }}>
                                <ArrowUp size={20} strokeWidth={3} />
                            </button>
                        </div>

                        {/* SOTA Toolbar / Model Knowledge Toggle */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 2 }}>
                            <div
                                onClick={() => setModelKnowledge(!modelKnowledge)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                                    padding: '4px 8px 4px 4px', borderRadius: 20,
                                    background: modelKnowledge ? 'var(--accent-dim)' : 'transparent',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <div style={{
                                    width: 32, height: 18, borderRadius: 10, background: modelKnowledge ? 'var(--accent)' : 'var(--bg-3)',
                                    position: 'relative', transition: 'background 0.3s ease',
                                }}>
                                    <div style={{
                                        position: 'absolute', top: 2, left: modelKnowledge ? 16 : 2, width: 14, height: 14,
                                        borderRadius: '50%', background: '#fff', transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                    }}></div>
                                </div>
                                <span style={{ fontSize: 12, fontWeight: 700, color: modelKnowledge ? 'var(--accent)' : 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Model Knowledge
                                </span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Info size={12} /> Press Shift + Enter for new line
                            </div>
                        </div>
                    </form>
                    <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-4)', marginTop: 16, fontWeight: 600 }}>
                        VERO might produce hallucinated answers. Always verify critical information.
                    </p>
                </div>
            </div>

            {/* ═══════ RIGHT: Insight & Context ═══════ */}
            <div style={{
                width: 360, flexShrink: 0, background: 'var(--bg-1)',
                borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column'
            }}>
                {/* ── Compact Unified Ingest Zone ── */}
                <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>Add Sources</span>
                        {ingesting && <Loader2 size={14} className="spin" color="var(--accent)" />}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                            onClick={() => fileRef.current?.click()}
                            style={{
                                flex: 1, height: 36, borderRadius: 8,
                                border: dragOver ? '1px solid var(--accent)' : '1px dashed var(--border)',
                                background: dragOver ? 'var(--accent-dim)' : 'var(--bg-2)',
                                color: 'var(--text-3)', fontSize: 12, fontWeight: 600,
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                transition: 'all 0.15s ease'
                            }}
                        >
                            <UploadCloud size={14} /> {ingesting ? 'Processing...' : 'File'}
                        </button>
                        <input ref={fileRef} type="file" multiple onChange={e => ingestFile(e.target.files[0])} hidden />
                        <div style={{ flex: 1.5, display: 'flex', gap: 4 }}>
                            <form onSubmit={handleUrlIngest} style={{ display: 'flex', flex: 1, gap: 4 }}>
                                <input
                                    value={url}
                                    onChange={e => setUrl(e.target.value)}
                                    placeholder="Paste URL or GitHub..."
                                    style={{
                                        flex: 1, height: 36, padding: '0 10px', background: 'var(--bg-2)',
                                        border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
                                        fontSize: 12, outline: 'none', fontWeight: 500
                                    }}
                                />
                                <button type="submit" disabled={!url.trim() || ingesting} style={{
                                    width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: (!url.trim() || ingesting) ? 'var(--bg-3)' : 'var(--accent)',
                                    color: (!url.trim() || ingesting) ? 'var(--text-4)' : 'var(--bg-0)',
                                    border: 'none', borderRadius: 8, cursor: (!url.trim() || ingesting) ? 'not-allowed' : 'pointer',
                                    flexShrink: 0, transition: 'all 0.15s ease'
                                }}>
                                    <Plus size={16} strokeWidth={2.5} />
                                </button>
                            </form>
                        </div>
                    </div>
                    {ingesting && (
                        <div style={{ marginTop: 8, height: 2, borderRadius: 1, background: 'var(--bg-3)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: '40%', background: 'var(--accent)', borderRadius: 1, animation: 'shimmer 1.5s infinite' }} />
                        </div>
                    )}
                </div>

                {/* ── Citation Chunk Drill-Down ── */}
                {activeCitationChunk && (
                    <div style={{ padding: 16, borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                            <span style={{
                                fontSize: 10, fontWeight: 800, width: 20, height: 20, borderRadius: 5,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'var(--accent)', color: 'var(--bg-0)'
                            }}>
                                {activeCitationChunk.srcNum}
                            </span>
                            <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {activeCitationChunk.doc_title}
                            </span>
                            <button onClick={() => setActiveCitationChunk(null)} style={{
                                width: 20, height: 20, borderRadius: 4, border: 'none',
                                background: 'var(--bg-3)', color: 'var(--text-3)', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                <X size={12} />
                            </button>
                        </div>
                        <div style={{
                            fontSize: 12, lineHeight: 1.6, color: 'var(--text-3)', fontWeight: 400,
                            maxHeight: 160, overflowY: 'auto', padding: '10px 12px',
                            background: 'var(--bg-0)', borderRadius: 8, border: '1px solid var(--border)',
                            fontStyle: 'italic'
                        }}>
                            "{activeCitationChunk.text?.substring(0, 600)}{activeCitationChunk.text?.length > 600 ? '...' : ''}"
                        </div>
                    </div>
                )}

                {/* ── Document List ── */}
                <div style={{ padding: '12px 16px 12px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Sources ({docs.length})
                        </span>
                        <button onClick={fetchDocs} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', padding: 2 }}>
                            <RefreshCw size={12} className={docsLoading ? 'spin' : ''} />
                        </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {docsLoading ? [1, 2, 3].map(i => <div key={i} className="skel" style={{ height: 44, borderRadius: 8 }} />) :
                            docs.length === 0 ? (
                                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-4)' }}>
                                    <FileArchive size={32} strokeWidth={1} style={{ marginBottom: 12, opacity: 0.3 }} />
                                    <p style={{ fontSize: 12, margin: 0 }}>No sources yet</p>
                                </div>
                            ) :
                                docs.map(d => {
                                    const status = getPreciseStatus(d);
                                    const StatusIcon = status.icon;
                                    const traces = docTraces[d.title] || [];
                                    const isActive = activeCitationDoc === d.title;
                                    const docType = getDocIcon(d.title);
                                    const DocIcon = docType.icon;

                                    return (
                                        <div id={`doc-${d.title}`} key={d.id} style={{
                                            display: 'flex', alignItems: 'center', gap: 10,
                                            padding: '8px 10px', borderRadius: 8,
                                            background: isActive ? 'var(--accent-dim)' : 'transparent',
                                            border: isActive ? '1px solid var(--accent-border)' : '1px solid transparent',
                                            cursor: 'pointer', transition: 'all 0.15s ease'
                                        }}
                                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-2)'; }}
                                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                                        >
                                            <DocIcon size={15} color={docType.color} style={{ flexShrink: 0 }} />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {d.title}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                                                    <StatusIcon size={10} color={status.color} className={status.label.includes('Step') ? 'spin' : ''} />
                                                    <span style={{ fontSize: 10, fontWeight: 600, color: status.color }}>{status.label}</span>
                                                    {traces.length > 0 && (
                                                        <span style={{
                                                            fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 4,
                                                            background: 'var(--accent-dim)', color: 'var(--accent)',
                                                            marginLeft: 2
                                                        }}>
                                                            {traces.length} cited
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                title="Remove source"
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    if (window.confirm(`Remove "${d.title}"?`)) {
                                                        try {
                                                            await api.deleteDocument(d.id);
                                                            fetchDocs();
                                                            toast?.('Source removed.', 'success');
                                                        } catch { toast?.('Failed to remove.', 'error'); }
                                                    }
                                                }}
                                                style={{
                                                    width: 24, height: 24, borderRadius: 6, border: 'none',
                                                    background: 'transparent', color: 'var(--text-4)',
                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    flexShrink: 0, transition: 'color 0.15s ease'
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; }}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    );
                                })}
                    </div>
                </div>
            </div>
        </div>
    );
}
