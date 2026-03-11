import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { api } from '../api';
import { useToast } from '../components/ui/Toast';
import {
    Send, Search, Loader2, FileText, ArrowUp,
    RefreshCw, User, Bot, CheckCircle2, UploadCloud, Globe,
    X, ChevronRight, ChevronDown, BookOpen, FileArchive, Wand2, Info, Layers, Clock, Edit2, Pin, Trash2,
    FileType, AlignLeft, FileCode, Github, Link, Plus, PanelRightClose, PanelRightOpen, Square, Copy, Check, Pencil
} from 'lucide-react';

/**
 * Convert [Source N] and [N] citation patterns into markdown links [N](cite:N)
 * so ReactMarkdown's `a` tag handler can render them as clickable bubbles.
 */
function preprocessTextForMarkdown(text) {
    if (!text) return text;
    // First pass: [Source N] → [N](cite:N)
    let result = text.replace(/\[Source\s+(\d+)\]/gi, (_, num) => `[${num}](cite:${num})`);
    // Second pass: standalone [N] that aren't already part of a markdown link
    // Match [N] not followed by ( which would mean it's already a link like [N](...)
    result = result.replace(/\[(\d+)\](?!\()/g, (_, num) => `[${num}](cite:${num})`);
    return result;
}

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
    const [openCitations, setOpenCitations] = useState(new Set()); // Message indices that have their citations accordion open
    const [modelKnowledge, setModelKnowledge] = useState(false);
    const [loadingText, setLoadingText] = useState('Analyzing sources...');
    const [rightPanelOpen, setRightPanelOpen] = useState(() => {
        const saved = localStorage.getItem('vero-right-panel');
        return saved !== null ? saved === 'true' : true;
    });

    // Persist right panel state
    useEffect(() => {
        localStorage.setItem('vero-right-panel', String(rightPanelOpen));
    }, [rightPanelOpen]);

    // Cycle loading text
    useEffect(() => {
        if (!searching) return;
        const texts = ['Analyzing sources...', 'Cross-referencing docs...', 'Synthesizing insights...', 'Formulating response...'];
        let i = 0;
        setLoadingText(texts[0]);
        const iv = setInterval(() => {
            i = (i + 1) % texts.length;
            setLoadingText(texts[i]);
        }, 1500);
        return () => clearInterval(iv);
    }, [searching]);

    const chatEndRef = useRef(null);
    const fileRef = useRef(null);
    const isCreatingSession = useRef(false);
    const streamIntervalRef = useRef(null);
    const [copiedIndex, setCopiedIndex] = useState(null);
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
            setMessages((s.messages || []).map(m => ({
                id: m.id,
                role: m.role,
                text: m.content,
                traces: m.citations || [],
                citations: m.citations || [],
                timestamp: m.created_at,
            })));
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
    const streamText = (fullText, onChunk, onDone) => {
        setIsStreaming(true);
        const words = fullText.split(' ');
        let currentText = '';
        let i = 0;
        const iv = setInterval(() => {
            if (i < words.length) {
                // Stream 2-3 words at a time for natural speed
                const batch = Math.min(2, words.length - i);
                for (let b = 0; b < batch; b++) {
                    currentText += (i + b > 0 ? ' ' : '') + words[i + b];
                }
                i += batch;
                if (onChunk) onChunk(currentText);
            } else {
                clearInterval(iv);
                streamIntervalRef.current = null;
                setIsStreaming(false);
                if (onDone) onDone(fullText);
            }
        }, 25);
        streamIntervalRef.current = iv;
    };

    const pollStatus = (docTitle) => {
        let lastStatus = '';
        const iv = setInterval(async () => {
            try {
                const allDocs = await api.getDocuments(projectId);
                setDocs(allDocs);
                const doc = allDocs.find(d => d.title === docTitle);

                if (doc && doc.processing_status !== lastStatus) {
                    lastStatus = doc.processing_status;
                    if (doc.processing_status === 'ready') {
                        toast?.(`"${docTitle}" is ready for chat.`, 'success');
                        clearInterval(iv);
                    } else if (doc.processing_status === 'error') {
                        toast?.(`Failed to process "${docTitle}".`, 'error');
                        clearInterval(iv);
                    } else if (doc.processing_status.includes('/')) {
                        // Show progress steps like 1/3, 2/3...
                        toast?.(`Processing "${docTitle}": Step ${doc.processing_status}`, 'info');
                    }
                }
            } catch { clearInterval(iv); }
        }, 2500);
        setTimeout(() => clearInterval(iv), 60000);
    };

    // ── Ingestion ────────────────────────────────────
    const handleFiles = async (files) => {
        if (!files || files.length === 0 || !projectId) return;

        const allowedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
            'text/plain',
            'text/markdown',
            'text/csv'
        ];

        const validFiles = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!allowedTypes.includes(file.type) && !file.name.endsWith('.md') && !file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
                toast?.(`Unsupported format: ${file.name}. Skipping.`, 'error');
                continue;
            }
            if (docs.some(d => d.title === file.name)) {
                toast?.(`"${file.name}" is already in this project. Skipping.`, 'info');
                continue;
            }
            validFiles.push(file);
        }

        if (validFiles.length === 0) return;

        setIngesting(true);
        if (validFiles.length > 1) {
            toast?.(`Uploading ${validFiles.length} files...`, 'info');
        } else {
            const shortName = validFiles[0].name.length > 20 ? validFiles[0].name.substring(0, 20) + '...' : validFiles[0].name;
            toast?.(`Uploading ${shortName}...`, 'info');
        }

        try {
            const uploadedDocs = [];
            for (const file of validFiles) {
                const doc = await api.ingestFile(projectId, file);
                uploadedDocs.push(doc);
            }
            if (fileRef.current) fileRef.current.value = '';
            await fetchDocs();
            uploadedDocs.forEach(doc => pollStatus(doc.title));
            onRefreshProjects?.();
        } catch (err) { toast?.('Import failed for some documents.', 'error'); }
        finally { setIngesting(false); }
    };

    const handleDrop = useCallback((e) => {
        e.preventDefault(); setDragOver(false);
        if (e.dataTransfer.files?.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    }, [projectId, docs]);

    const handleUrlIngest = async (e) => {
        e.preventDefault();
        if (!url.trim() || !projectId) return;

        const isRepo = url.includes('github.com');
        const prefix = isRepo ? 'Repo' : 'Web';
        const cleanUrl = url.replace(/https?:\/\/(www\.)?/, '');
        const shortUrl = cleanUrl.length > 25 ? cleanUrl.substring(0, 25) + '...' : cleanUrl;

        if (docs.some(d => d.title === url || d.title.includes(cleanUrl))) {
            toast?.(`This link has already been added to this project.`, 'info');
            return;
        }

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
        if (!query.trim() || !projectId || searching || isStreaming || docs.length === 0) return;

        const q = query.trim();
        setQuery('');
        const now = new Date().toISOString();
        setMessages(prev => [...prev, { role: 'user', text: q, timestamp: now }]);
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

            if (setSessions) {
                setSessions(prev => {
                    const idx = prev.findIndex(s => s.id === sid);
                    if (idx >= 0) {
                        const next = [...prev];
                        next[idx] = { ...next[idx], updated_at: new Date().toISOString() };
                        return next;
                    }
                    return prev;
                });
            }
            onRefreshProjects?.();

            setSearching(false);
            const answerTime = new Date().toISOString();
            
            // Push an empty streaming message first
            setMessages(prev => [...prev, {
                role: 'assistant', text: '',
                citations: cr?.citations || [],
                traces: searchResults,
                sufficient: cr?.found_sufficient_info,
                isStreaming: true,
                timestamp: answerTime
            }]);

            streamText(cr?.answer || "No response generated.", 
                (chunk) => {
                    setMessages(prev => {
                        const next = [...prev];
                        if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], text: chunk };
                        return next;
                    });
                },
                (fullText) => {
                    setMessages(prev => {
                        const next = [...prev];
                        if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], text: fullText, isStreaming: false };
                        return next;
                    });
                }
            );
        } catch (err) {
            setMessages(prev => [...prev, { role: 'error', text: 'Issues connecting to VERO intelligence.', timestamp: new Date().toISOString() }]);
            setSearching(false);
        }
    };

    const stopGenerating = () => {
        if (streamIntervalRef.current) {
            clearInterval(streamIntervalRef.current);
            streamIntervalRef.current = null;
        }
        setIsStreaming(false);
        setSearching(false);
        // Mark last message as done
        setMessages(prev => {
            const next = [...prev];
            if (next.length > 0 && next[next.length - 1].isStreaming) {
                next[next.length - 1] = { ...next[next.length - 1], isStreaming: false, stopped: true };
            }
            return next;
        });
    };

    const copyMessage = (text, index) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 2000);
        });
    };

    const formatTimestamp = (ts) => {
        if (!ts) return '';
        const d = new Date(ts);
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        return `${date}, ${time}`;
    };

    const deleteMessagePair = async (msgIndex) => {
        const msg = messages[msgIndex];
        // If this is a user message, find its corresponding AI response
        const userIdx = msg.role === 'user' ? msgIndex : msgIndex - 1;
        const aiIdx = msg.role === 'user' ? msgIndex + 1 : msgIndex;
        const userMsg = messages[userIdx];
        const aiMsg = messages[aiIdx];

        // Determine which message ID to send to backend
        const targetId = userMsg?.id || aiMsg?.id;

        if (targetId && activeSessionId) {
            try {
                await api.deleteMessagePair(activeSessionId, targetId);
            } catch (err) {
                toast?.('Failed to delete message.', 'error');
                return;
            }
        }

        // Remove both messages from UI state
        setMessages(prev => {
            const next = [...prev];
            const removeIndices = new Set();
            if (userIdx >= 0 && userIdx < next.length && next[userIdx]?.role === 'user') removeIndices.add(userIdx);
            if (aiIdx >= 0 && aiIdx < next.length && (next[aiIdx]?.role === 'assistant' || next[aiIdx]?.role === 'error')) removeIndices.add(aiIdx);
            return next.filter((_, idx) => !removeIndices.has(idx));
        });
        toast?.('Message deleted.', 'success');
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

    // ── Pre-process Text for ReactMarkdown Citations ────────────────
    const preprocessTextForMarkdown = (text) => {
        if (!text) return '';
        
        // This regex aggressively looks for bracketed numbers like [Source 1], [1], [Sources 1, 2], [1 and 2]
        const citationPattern = /\[(?:Sources?\s*)?((?:\d+(?:,\s*|\s+and\s+)*)+)\]/gi;
        
        return text.replace(citationPattern, (match, numbersStr) => {
            const numbers = numbersStr.match(/\d+/g);
            if (numbers) {
                // Convert to a custom markdown link that we'll intercept in the Custom Components
                return numbers.map(n => `[${n}](cite:${n})`).join(' ');
            }
            return match;
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
                    backdropFilter: 'blur(30px)', background: 'var(--bg-glass)'
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button title="Pin Workspace" style={{
                            width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent',
                            color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.2s ease'
                        }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; }}>
                            <Pin size={16} />
                        </button>
                        <button title="Rename Workspace" style={{
                            width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent',
                            color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.2s ease'
                        }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)'; }}
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
                        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
                        <button
                            title={rightPanelOpen ? 'Hide Sources Panel' : 'Show Sources Panel'}
                            onClick={() => setRightPanelOpen(p => !p)}
                            style={{
                                width: 32, height: 32, borderRadius: 8, border: 'none',
                                background: rightPanelOpen ? 'var(--accent-dim)' : 'transparent',
                                color: rightPanelOpen ? 'var(--accent)' : 'var(--text-3)',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={e => { if (!rightPanelOpen) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)'; } }}
                            onMouseLeave={e => { if (!rightPanelOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; } }}
                        >
                            {rightPanelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
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
                                <img src="/vero.svg" alt="VERO" style={{ width: 44, height: 44, objectFit: 'contain' }} />
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
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                                    marginBottom: 28,
                                    animation: 'fadeIn 0.3s ease both',
                                }}>
                                    {m.role === 'assistant' || m.role === 'error' ? (
                                        <div style={{ display: 'flex', gap: 16, maxWidth: '100%', width: '100%' }}>
                                            {/* VERO Avatar */}
                                            <div style={{
                                                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                                                background: 'var(--accent-dim)',
                                                border: `1.5px solid ${m.isStreaming ? 'var(--accent)' : 'var(--accent-border)'}`,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                boxShadow: m.isStreaming ? '0 0 12px var(--accent-dim)' : 'var(--shadow-sm)',
                                                transition: 'all 0.3s ease',
                                                animation: m.isStreaming ? 'pulse 2s ease-in-out infinite' : 'none',
                                            }}>
                                                <img src="/vero.svg" alt="V" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                                                {/* Header: VERO label + timestamp */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>VERO</span>
                                                    {m.timestamp && <span style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 500 }}>{formatTimestamp(m.timestamp)}</span>}
                                                    {m.stopped && <span style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 600 }}>· Stopped</span>}
                                                </div>
                                                <div className={`vero-md ${m.isStreaming ? "streaming-cursor" : ""}`} style={{
                                                    color: m.role === 'error' ? 'var(--red)' : 'var(--text)'
                                                }}>
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkGfm, remarkMath]}
                                                        rehypePlugins={[rehypeKatex]}
                                                        urlTransform={(value) => {
                                                            if (value.startsWith('cite:')) return value;
                                                            // Provide a simple default transform for other URLs if needed,
                                                            // or rely on ReactMarkdown's default behavior for legitimate links.
                                                            return value.replace(/^javascript:/i, ''); // basic XSS prevention
                                                        }}
                                                        components={{
                                                            code({ node, inline, className, children, ...props }) {
                                                                const match = /language-(\w+)/.exec(className || '');
                                                                return !inline && match ? (
                                                                    <div style={{ position: 'relative', marginTop: 12, marginBottom: 16 }}>
                                                                        <div style={{
                                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                                            background: 'var(--bg-3)', padding: '6px 14px',
                                                                            borderTopLeftRadius: 8, borderTopRightRadius: 8,
                                                                            border: '1px solid var(--border)', borderBottom: 'none'
                                                                        }}>
                                                                            <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                                                {match[1]}
                                                                            </span>
                                                                            <button
                                                                                onClick={() => { navigator.clipboard.writeText(String(children).replace(/\n$/, '')); /* Optional: toast here */ }}
                                                                                style={{
                                                                                    background: 'none', border: 'none', color: 'var(--text-4)',
                                                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                                                                    fontSize: 11, fontWeight: 500, padding: '4px 8px', borderRadius: 4,
                                                                                    transition: 'all 0.15s ease'
                                                                                }}
                                                                                onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                                                                                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.background = 'transparent'; }}
                                                                            >
                                                                                <Copy size={12} /> Copy
                                                                            </button>
                                                                        </div>
                                                                        <pre style={{
                                                                            margin: 0, padding: '16px 20px', background: 'var(--bg-1)',
                                                                            overflowX: 'auto', borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
                                                                            border: '1px solid var(--border)'
                                                                        }}>
                                                                            <code className={className} {...props} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-2)' }}>
                                                                                {children}
                                                                            </code>
                                                                        </pre>
                                                                    </div>
                                                                ) : (
                                                                    <code className={className} {...props} style={{ background: 'var(--bg-1)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.85em', color: 'var(--accent)' }}>
                                                                        {children}
                                                                    </code>
                                                                );
                                                            },
                                                            p({ children }) {
                                                                return <p style={{ margin: '0 0 12px 0', lineHeight: 1.6 }}>{children}</p>;
                                                            },
                                                            a: ({ node, href, children, ...props }) => {
                                                                if (href && href.startsWith('cite:')) {
                                                                    const num = parseInt(href.replace('cite:', ''));
                                                                    const trace = m.traces?.[num - 1];
                                                                    if (!trace) return <span style={{ opacity: 0.5 }}>[{num}]</span>;

                                                                    const isChunkActive = activeCitationChunk?.srcNum === num;
                                                                    
                                                                    return (
                                                                        <span 
                                                                            onClick={() => {
                                                                                setActiveCitationChunk(isChunkActive ? null : { srcNum: num, text: trace.text, doc_title: trace.doc_title, score: trace.score });
                                                                                setActiveCitationDoc(trace.doc_title);
                                                                                if (!rightPanelOpen) setRightPanelOpen(true);
                                                                                setTimeout(() => {
                                                                                    const el = document.getElementById(`doc-${trace.doc_title}`);
                                                                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                                }, 100);
                                                                            }}
                                                                            title={`From: ${trace.doc_title}`}
                                                                            style={{
                                                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                                padding: '0 7px', margin: '0 3px', borderRadius: 5, minWidth: 20,
                                                                                background: isChunkActive ? 'var(--accent)' : 'var(--accent-dim)',
                                                                                border: '1px solid var(--accent-border)',
                                                                                color: isChunkActive ? 'var(--bg-0)' : 'var(--accent)',
                                                                                fontSize: 11, fontWeight: 800,
                                                                                cursor: 'pointer', lineHeight: '20px',
                                                                                verticalAlign: 'middle', transition: 'all 0.15s ease',
                                                                                textDecoration: 'none'
                                                                            }}
                                                                            onMouseEnter={e => { if (!isChunkActive) { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = 'var(--bg-0)'; } }}
                                                                            onMouseLeave={e => { if (!isChunkActive) { e.currentTarget.style.background = 'var(--accent-dim)'; e.currentTarget.style.color = 'var(--accent)'; } }}
                                                                        >
                                                                            {num}
                                                                        </span>
                                                                    );
                                                                }
                                                                return <a href={href} target="_blank" rel="noopener noreferrer" {...props} style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 2 }}>{children}</a>;
                                                            }
                                                        }}
                                                    >
                                                        {preprocessTextForMarkdown(m.text)}
                                                    </ReactMarkdown>
                                                </div>

                                                {/* Message Actions */}
                                                {!m.isStreaming && m.role === 'assistant' && (
                                                    <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
                                                        <button
                                                            onClick={() => copyMessage(m.text, i)}
                                                            title="Copy response"
                                                            style={{
                                                                display: 'flex', alignItems: 'center', gap: 4,
                                                                padding: '4px 8px', borderRadius: 6, border: 'none',
                                                                background: 'transparent', color: copiedIndex === i ? 'var(--green)' : 'var(--text-4)',
                                                                cursor: 'pointer', fontSize: 11, fontWeight: 500,
                                                                transition: 'all 0.15s ease'
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-2)'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = copiedIndex === i ? 'var(--green)' : 'var(--text-4)'; }}
                                                        >
                                                            {copiedIndex === i ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Grouped Source Documents (Collapsible Accordion) */}
                                                {!m.isStreaming && m.traces?.length > 0 && (() => {
                                                    const grouped = {};
                                                    m.traces.forEach((t, idx) => {
                                                        if (!grouped[t.doc_title]) grouped[t.doc_title] = { title: t.doc_title, items: [] };
                                                        grouped[t.doc_title].items.push({ ...t, srcNum: idx + 1 });
                                                    });
                                                    const docList = Object.values(grouped);
                                                    const isAccordionOpen = openCitations.has(i);

                                                    return (
                                                        <div style={{ marginTop: 20 }}>
                                                            {/* Accordion Toggle */}
                                                            <div
                                                                onClick={() => setOpenCitations(prev => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(i)) next.delete(i); else next.add(i);
                                                                    return next;
                                                                })}
                                                                style={{
                                                                    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px 6px 8px',
                                                                    background: isAccordionOpen ? 'var(--bg-2)' : 'var(--bg-1)',
                                                                    border: '1px solid', borderColor: isAccordionOpen ? 'var(--border)' : 'transparent',
                                                                    borderRadius: 100, cursor: 'pointer', userSelect: 'none',
                                                                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                                                                }}
                                                                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                                                                onMouseLeave={e => { e.currentTarget.style.background = isAccordionOpen ? 'var(--bg-2)' : 'var(--bg-1)'; e.currentTarget.style.borderColor = isAccordionOpen ? 'var(--border)' : 'transparent'; }}
                                                            >
                                                                <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                                                                    <BookOpen size={12} strokeWidth={2.5} />
                                                                </div>
                                                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)' }}>
                                                                    {m.traces.length} {m.traces.length === 1 ? 'Source' : 'Sources'} Cited
                                                                </span>
                                                                <ChevronDown size={14} color="var(--text-4)" style={{ marginLeft: 4, transform: isAccordionOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }} />
                                                            </div>

                                                            {/* Accordion Content (CSS Grid Animation) */}
                                                            <div style={{
                                                                display: 'grid', gridTemplateRows: isAccordionOpen ? '1fr' : '0fr',
                                                                transition: 'grid-template-rows 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                                                            }}>
                                                                <div style={{ overflow: 'hidden' }}>
                                                                    <div style={{
                                                                        marginTop: 12, padding: '14px 16px', borderRadius: 12,
                                                                        background: 'var(--surface)', border: '1px solid var(--border)',
                                                                        display: 'flex', flexDirection: 'column', gap: 6,
                                                                        opacity: isAccordionOpen ? 1 : 0, transform: isAccordionOpen ? 'translateY(0)' : 'translateY(-10px)',
                                                                        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                                                    }}>
                                                                        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                                                                            Extracted References
                                                                        </div>
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
                                                                                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
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
                                                                                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                                                        padding: '0 7px', margin: '0 2px', borderRadius: 5, minWidth: 20, height: 20,
                                                                                                        background: isChunkActive ? 'var(--accent)' : 'var(--accent-dim)',
                                                                                                        border: '1px solid var(--accent-border)',
                                                                                                        color: isChunkActive ? 'var(--bg-0)' : 'var(--accent)',
                                                                                                        fontSize: 11, fontWeight: 800,
                                                                                                        cursor: 'pointer', lineHeight: '20px',
                                                                                                        transition: 'all 0.15s ease'
                                                                                                    }}
                                                                                                    onMouseEnter={e => { 
                                                                                                        if (!isChunkActive) { 
                                                                                                            e.currentTarget.style.background = 'var(--accent)'; 
                                                                                                            e.currentTarget.style.color = 'var(--bg-0)'; 
                                                                                                        } 
                                                                                                    }}
                                                                                                    onMouseLeave={e => { 
                                                                                                        if (!isChunkActive) { 
                                                                                                            e.currentTarget.style.background = 'var(--accent-dim)'; 
                                                                                                            e.currentTarget.style.color = 'var(--accent)'; 
                                                                                                        } 
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
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', maxWidth: '85%' }}>
                                            <div style={{
                                                background: 'var(--user-bubble)', color: 'var(--text)',
                                                padding: '10px 16px', borderRadius: '16px', borderBottomRightRadius: 4,
                                                border: '1px solid var(--user-bubble-border)',
                                                fontSize: 14, lineHeight: 1.6, fontWeight: 400,
                                                whiteSpace: 'pre-wrap'
                                            }}>
                                                {m.text}
                                            </div>
                                            {/* User message actions + timestamp row */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                                                {m.timestamp && (
                                                    <span style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 500, paddingRight: 2 }}>
                                                        {formatTimestamp(m.timestamp)}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => copyMessage(m.text, i)}
                                                    title="Copy message"
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 3,
                                                        padding: '2px 6px', borderRadius: 5, border: 'none',
                                                        background: 'transparent', color: copiedIndex === i ? 'var(--green)' : 'var(--text-4)',
                                                        cursor: 'pointer', fontSize: 10, fontWeight: 500,
                                                        transition: 'all 0.15s ease'
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-2)'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.color = copiedIndex === i ? 'var(--green)' : 'var(--text-4)'; }}
                                                >
                                                    {copiedIndex === i ? <Check size={10} /> : <Copy size={10} />}
                                                </button>
                                                <button
                                                    onClick={() => toast?.('Edit feature coming soon.', 'info')}
                                                    title="Edit message"
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 3,
                                                        padding: '2px 6px', borderRadius: 5, border: 'none',
                                                        background: 'transparent', color: 'var(--text-4)',
                                                        cursor: 'pointer', fontSize: 10, fontWeight: 500,
                                                        transition: 'all 0.15s ease'
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-2)'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; }}
                                                >
                                                    <Pencil size={10} />
                                                </button>
                                                <button
                                                    onClick={() => { if (window.confirm('Delete this Q&A pair?')) deleteMessagePair(i); }}
                                                    title="Delete this exchange"
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 3,
                                                        padding: '2px 6px', borderRadius: 5, border: 'none',
                                                        background: 'transparent', color: 'var(--text-4)',
                                                        cursor: 'pointer', fontSize: 10, fontWeight: 500,
                                                        transition: 'all 0.15s ease'
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; }}
                                                >
                                                    <Trash2 size={10} />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}



                            {/* VERO Thinking Indicator */}
                            {(searching && !isStreaming) && (
                                <div style={{ maxWidth: 840, margin: '0 auto', display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 28 }}>
                                    <div style={{
                                        width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                                        background: 'var(--accent-dim)', border: '1.5px solid var(--accent)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        animation: 'pulse 1.5s ease-in-out infinite',
                                        boxShadow: '0 0 16px var(--accent-dim)',
                                    }}>
                                        <img src="/vero.svg" alt="V" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                                    </div>
                                    <div style={{ paddingTop: 4 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>VERO</span>
                                            <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>thinking...</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <div style={{ display: 'flex', gap: 3 }}>
                                                {[0, 1, 2].map(d => (
                                                    <div key={d} style={{
                                                        width: 6, height: 6, borderRadius: '50%',
                                                        background: 'var(--accent)',
                                                        animation: `pulse 1.2s ease-in-out ${d * 0.2}s infinite`,
                                                    }} />
                                                ))}
                                            </div>
                                            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>
                                                {loadingText}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Stop Generating Button */}
                            {(isStreaming || searching) && (
                                <div style={{ maxWidth: 840, margin: '0 auto 20px', display: 'flex', justifyContent: 'center' }}>
                                    <button
                                        onClick={stopGenerating}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            padding: '6px 16px', borderRadius: 100,
                                            background: 'var(--bg-2)', border: '1px solid var(--border)',
                                            color: 'var(--text-2)', cursor: 'pointer',
                                            fontSize: 12, fontWeight: 600,
                                            transition: 'all 0.15s ease',
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-3)'; e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--border-light)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                                    >
                                        <Square size={12} fill="currentColor" /> Stop generating
                                    </button>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>
                    )}
                </div>

                {/* Input Zone */}
                <div style={{ padding: '0px 32px 16px', background: 'var(--bg-0)' }}>
                    <form onSubmit={send} style={{
                        maxWidth: 840, margin: '0 auto', position: 'relative',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: 16, padding: '10px 14px',
                        display: 'flex', flexDirection: 'column', gap: 10,
                        boxShadow: 'var(--shadow-md)',
                        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                        ...(docs.length === 0 ? { opacity: 0.5, pointerEvents: 'none', filter: 'grayscale(1)' } : {})
                    }}
                        onFocusCapture={e => {
                            e.currentTarget.style.borderColor = 'var(--input-focus-border)';
                            e.currentTarget.style.boxShadow = 'var(--shadow-md), var(--input-focus-shadow)';
                        }}
                        onBlurCapture={e => {
                            e.currentTarget.style.borderColor = 'var(--input-border)';
                            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
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
                                disabled={docs.length === 0}
                                placeholder={docs.length === 0 ? "Import documents to start..." : (isStreaming || searching) ? "VERO is answering..." : "Ask VERO anything..."}
                                rows={1}
                                style={{
                                    flex: 1, border: 'none', background: 'transparent', color: 'var(--text)',
                                    padding: '4px 0', fontSize: 14, fontFamily: 'var(--font)',
                                    outline: 'none', fontWeight: 500, resize: 'none',
                                    minHeight: 28, maxHeight: 200, lineHeight: 1.5,
                                    overflowY: 'auto'
                                }}
                            />
                            <button type="submit" disabled={!query.trim() || searching || isStreaming || docs.length === 0}
                                title={isStreaming ? 'Wait for VERO to finish' : 'Send message'}
                                style={{
                                    width: 36, height: 36, borderRadius: '50%', border: 'none', flexShrink: 0,
                                    background: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'var(--bg-2)' : 'var(--submit-bg)',
                                    color: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'var(--text-4)' : 'var(--submit-fg)',
                                    cursor: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                    transform: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'scale(0.9)' : 'scale(1)',
                                    boxShadow: (!query.trim() || searching || isStreaming || docs.length === 0) ? 'none' : 'var(--submit-shadow)'
                                }}
                                onMouseEnter={e => {
                                    if (query.trim() && !searching && !isStreaming && docs.length > 0) {
                                        e.currentTarget.style.transform = 'scale(1.08)';
                                    }
                                }}
                                onMouseLeave={e => {
                                    if (query.trim() && !searching && !isStreaming && docs.length > 0) {
                                        e.currentTarget.style.transform = 'scale(1)';
                                    }
                                }}
                            >
                                <ArrowUp size={20} strokeWidth={2.5} />
                            </button>
                        </div>

                        {/* Compact Toolbar */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
                            <div
                                onClick={() => setModelKnowledge(!modelKnowledge)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                                    padding: '4px 10px 4px 6px', borderRadius: 100,
                                    background: modelKnowledge ? 'var(--accent-dim)' : 'transparent',
                                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                                }}
                                onMouseEnter={e => {
                                    if (!modelKnowledge) e.currentTarget.style.background = 'var(--bg-hover)';
                                }}
                                onMouseLeave={e => {
                                    if (!modelKnowledge) e.currentTarget.style.background = 'transparent';
                                }}
                            >
                                {/* The Switch Track */}
                                <div style={{
                                    width: 32, height: 18, borderRadius: 9,
                                    background: modelKnowledge ? 'var(--accent)' : 'var(--bg-3)',
                                    border: `1px solid ${modelKnowledge ? 'transparent' : 'var(--border)'}`,
                                    position: 'relative', transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                }}>
                                    {/* The Switch Thumb */}
                                    <div style={{
                                        position: 'absolute', top: 1, left: modelKnowledge ? 15 : 1,
                                        width: 14, height: 14, borderRadius: '50%',
                                        background: modelKnowledge ? '#fff' : 'var(--text-3)',
                                        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                    }} />
                                </div>
                                <span style={{
                                    fontSize: 11, fontWeight: 600,
                                    color: modelKnowledge ? 'var(--accent)' : 'var(--text-4)',
                                    transition: 'color 0.3s ease'
                                }}>
                                    Model Knowledge
                                </span>
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4, opacity: 0.6 }}>
                                <Info size={10} /> ⏎ Send · ⇧⏎ Newline
                            </div>
                        </div>
                    </form>
                    <p style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-4)', marginTop: 8, fontWeight: 500, opacity: 0.7 }}>
                        VERO might produce hallucinated answers. Always verify critical information.
                    </p>
                </div>
            </div>

            {/* ═══════ RIGHT: Insight & Context ═══════ */}
            <div style={{
                width: rightPanelOpen ? 360 : 0, flexShrink: 0, background: 'var(--bg-1)',
                borderLeft: rightPanelOpen ? '1px solid var(--border)' : 'none',
                display: 'flex', flexDirection: 'column',
                overflow: 'hidden',
                transition: 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }}>
                {/* ── Compact Unified Ingest Zone ── */}
                <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>Add Sources</span>
                        {ingesting && <Loader2 size={14} className="spin" color="var(--accent)" />}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <label
                            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                            title="Click or drag & drop files here (PDF, DOCX, TXT, MD, CSV)"
                            style={{
                                flex: 1, height: 36, borderRadius: 8,
                                border: `1px ${dragOver ? 'solid' : 'dashed'} ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
                                background: dragOver ? 'var(--bg-hover)' : 'var(--bg-2)',
                                color: dragOver ? 'var(--accent)' : 'var(--text-3)', fontSize: 12, fontWeight: 600,
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                transition: 'all 0.15s ease', margin: 0
                            }}
                            onMouseEnter={e => {
                                if (!dragOver) {
                                    e.currentTarget.style.borderColor = 'var(--accent-dim)';
                                    e.currentTarget.style.background = 'var(--bg-hover)';
                                    e.currentTarget.style.color = 'var(--text)';
                                }
                            }}
                            onMouseLeave={e => {
                                if (!dragOver) {
                                    e.currentTarget.style.borderColor = 'var(--border)';
                                    e.currentTarget.style.background = 'var(--bg-2)';
                                    e.currentTarget.style.color = 'var(--text-3)';
                                }
                            }}
                        >
                            <UploadCloud size={14} /> {ingesting ? 'Processing...' : 'File'}
                            <input ref={fileRef} type="file" multiple onChange={e => handleFiles(e.target.files)} style={{ display: 'none' }} accept=".pdf,.txt,.md,.docx,.csv" />
                        </label>
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
                                width: 22, height: 22, borderRadius: 6, border: 'none',
                                background: 'transparent', color: 'var(--text-4)', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
                            }}
                                onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'var(--red-dim)'; }}
                                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.background = 'transparent'; }}
                            >
                                <X size={14} />
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
