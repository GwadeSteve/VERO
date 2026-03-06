const BASE_URL = "http://127.0.0.1:8000";

async function handle(res) {
    if (!res.ok) {
        let msg = `Error ${res.status}`;
        try { const d = await res.json(); msg = d.detail || JSON.stringify(d); } catch { msg = await res.text(); }
        throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
}

export const api = {
    // ── Projects ──────────────────────────────────────
    getProjects: () => fetch(`${BASE_URL}/projects`).then(handle),
    getProject: (id) => fetch(`${BASE_URL}/projects/${id}`).then(handle),
    createProject: (name, description = "") =>
        fetch(`${BASE_URL}/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }) }).then(handle),
    deleteProject: (id) => fetch(`${BASE_URL}/projects/${id}`, { method: 'DELETE' }).then(handle),

    // ── Documents ─────────────────────────────────────
    getDocuments: (pid) => fetch(`${BASE_URL}/projects/${pid}/documents`).then(handle),
    ingestFile: (pid, file) => {
        const fd = new FormData(); fd.append("file", file);
        return fetch(`${BASE_URL}/projects/${pid}/ingest`, { method: 'POST', body: fd }).then(handle);
    },
    ingestUrl: (pid, url) =>
        fetch(`${BASE_URL}/projects/${pid}/ingest-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }).then(handle),

    // ── Sessions ──────────────────────────────────────
    getSessions: (pid) => fetch(`${BASE_URL}/projects/${pid}/sessions`).then(handle),
    createSession: (pid, title) =>
        fetch(`${BASE_URL}/projects/${pid}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title || "New Conversation" }) }).then(handle),
    getSession: (sid) => fetch(`${BASE_URL}/sessions/${sid}`).then(handle),
    deleteSession: (sid) => fetch(`${BASE_URL}/sessions/${sid}`, { method: 'DELETE' }).then(handle),

    // ── Chat ──────────────────────────────────────────
    chat: (sid, message, allowModelKnowledge = false) =>
        fetch(`${BASE_URL}/sessions/${sid}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, top_k: 5, mode: "hybrid", allow_model_knowledge: allowModelKnowledge }) }).then(handle),

    // ── Search ────────────────────────────────────────
    hybridSearch: (pid, query) =>
        fetch(`${BASE_URL}/projects/${pid}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, top_k: 5, mode: "hybrid" }) }).then(handle),
};
