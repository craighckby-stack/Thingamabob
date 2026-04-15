/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  signInAnonymously, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  serverTimestamp, 
  query, 
  orderBy,
  DocumentData
} from 'firebase/firestore';
import { GoogleGenAI, Type } from "@google/genai";
import { auth, db } from './firebase';
import { 
  Layout, 
  Github, 
  Terminal, 
  History, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  ExternalLink,
  Search,
  Filter,
  Eye,
  EyeOff,
  Cpu,
  RefreshCw,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const appId = 'balanced-auditor-v5-2';

// Error handling for Firestore
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ghToken, setGhToken] = useState('');
  const [targetUser, setTargetUser] = useState('');
  const [repos, setRepos] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState(new Set<number>());
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'private'>('all'); 
  const [logs, setLogs] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [activeTask, setActiveTask] = useState<number | null>(null);
  const [tokenScopes, setTokenScopes] = useState<string[]>([]);
  
  // Splash State
  const [splash, setSplash] = useState<any>(null); // { name, uiUrl, status, summary, notes }

  const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }), []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (e) { 
        console.error("Auth init failed", e); 
      }
    };
    initAuth();
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  useEffect(() => {
    if (!user) return;
    const path = `artifacts/${appId}/users/${user.uid}/deployments`;
    const q = query(collection(db, path), orderBy('timestamp', 'desc'));
    
    return onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setHistory(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  }, [user]);

  const addLog = (msg: string, type: 'INFO' | 'ERROR' | 'SUCCESS' = 'INFO') => {
    setLogs(prev => [{ msg, type, time: new Date().toLocaleTimeString(), id: Math.random() }, ...prev].slice(0, 50));
  };

  const generateUIPreview = async (repoName: string, repoContext: string) => {
    try {
      addLog(`GENERATING UI PREVIEW: ${repoName}...`);
      const prompt = `A high-quality 4k UI screenshot of a software application named "${repoName}". The design style should be modern, clean, and professional. Based on this technical context: ${repoContext.substring(0, 500)}. Dark mode interface, sleek typography, dashboard aesthetic.`;
      
      const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: '16:9',
        },
      });

      const base64EncodeString = response.generatedImages[0].image.imageBytes;
      return `data:image/png;base64,${base64EncodeString}`;
    } catch (e) {
      console.error("UI Generation failed", e);
      addLog(`UI PREVIEW FAILED: ${e instanceof Error ? e.message : String(e)}`, "ERROR");
      return null;
    }
  };

  const scan = async () => {
    if (!ghToken) return addLog("GitHub Token required.", "ERROR");
    setIsScanning(true);
    try {
      const userRes = await fetch(`https://api.github.com/user`, { headers: { 'Authorization': `token ${ghToken}` } });
      if (!userRes.ok) throw new Error("Invalid GitHub Token");
      
      const userData = await userRes.json();
      setTokenScopes(userRes.headers.get('x-oauth-scopes')?.split(', ') || []);
      
      const currentTarget = targetUser || userData.login;
      if (!targetUser) setTargetUser(userData.login);

      const endpoint = currentTarget === userData.login 
        ? `https://api.github.com/user/repos?sort=pushed&per_page=100&type=all` 
        : `https://api.github.com/users/${currentTarget}/repos?sort=pushed&per_page=100`;
      
      const repoRes = await fetch(endpoint, { headers: { 'Authorization': `token ${ghToken}` } });
      const repoData = await repoRes.json();
      
      if (!Array.isArray(repoData)) throw new Error("Failed to fetch repositories");
      
      setRepos(repoData.filter(r => !r.fork));
      addLog(`Sync complete. Indexed ${repoData.length} repos.`, "SUCCESS");
    } catch (e) { 
      addLog(e instanceof Error ? e.message : String(e), "ERROR"); 
    } finally { 
      setIsScanning(false); 
    }
  };

  const auditWithBuildTest = async (repo: any) => {
    setActiveTask(repo.id);
    addLog(`PIPELINE START: ${repo.name}...`);
    try {
      const treeRes = await fetch(`https://api.github.com/repos/${repo.owner.login}/${repo.name}/git/trees/${repo.default_branch}?recursive=1`, {
        headers: { 'Authorization': `token ${ghToken}` }
      });
      const treeData = await treeRes.json();
      const allFiles = treeData.tree || [];
      const logicFiles = allFiles.filter((f: any) => f.type === 'blob' && f.path.match(/\.(js|ts|jsx|tsx|py|go|json|yml|txt|md)$/)).sort((a: any, b: any) => b.size - a.size).slice(0, 15);

      let context = `FILES:\n${allFiles.map((f: any) => f.path).slice(0, 50).join('\n')}\n\nCODE:`;
      for (let f of logicFiles) {
        const fRes = await fetch(f.url, { headers: { 'Authorization': `token ${ghToken}` } });
        const fData = await fRes.json();
        context += `\n\n### ${f.path}\n${atob(fData.content).substring(0, 3000)}\n---`;
      }

      // Generate UI Preview Image
      const uiUrl = await generateUIPreview(repo.name, context);

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `Analyze and audit the following repository: ${repo.name}.\n\nSOURCE CONTEXT:\n${context}`,
        config: {
          systemInstruction: "You are a senior software architect. Analyze the provided code and file structure. Output ONLY JSON.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              readme: { type: Type.STRING, description: "Professional markdown README content with visual audit details." },
              build_status: { type: Type.STRING, enum: ["PASS", "FAIL"], description: "Predicted build status." },
              build_notes: { type: Type.STRING, description: "Technical architectural notes." },
              maturity: { type: Type.STRING, description: "System maturity level (e.g., Prototype, Production-Ready)." },
              summary: { type: Type.STRING, description: "One-sentence summary of the audit." }
            },
            required: ["readme", "build_status", "build_notes", "maturity", "summary"]
          }
        }
      });

      const audit = JSON.parse(response.text);

      let finalReadme = audit.readme;
      if (uiUrl) finalReadme = `![App Preview](${uiUrl})\n\n` + finalReadme;
      
      const fileStatus = await fetch(`https://api.github.com/repos/${repo.owner.login}/${repo.name}/contents/README.md?ref=${repo.default_branch}`, { headers: { 'Authorization': `token ${ghToken}` } });
      const sha = fileStatus.ok ? (await fileStatus.json()).sha : null;

      addLog(`UPDATING README: ${repo.name}...`);
      await fetch(`https://api.github.com/repos/${repo.owner.login}/${repo.name}/contents/README.md`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${ghToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: 'docs: visual build audit by Balanced Auditor', 
          content: btoa(unescape(encodeURIComponent(finalReadme))), 
          sha, 
          branch: repo.default_branch 
        })
      });

      if (user) {
        const path = `artifacts/${appId}/users/${user.uid}/deployments`;
        try {
          await addDoc(collection(db, path), {
            repoName: repo.name, 
            status: audit.build_status, 
            maturity: audit.maturity, 
            timestamp: serverTimestamp(), 
            summary: audit.summary, 
            uiUrl: uiUrl || ''
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, path);
        }
      }

      // Trigger Splash Screen
      setSplash({ 
        name: repo.name, 
        uiUrl, 
        status: audit.build_status, 
        summary: audit.summary,
        notes: audit.build_notes 
      });

      addLog(`SUCCESS: ${repo.name} [${audit.build_status}]`, "SUCCESS");
    } catch (e) {
      addLog(`CRITICAL: ${e instanceof Error ? e.message : String(e)}`, "ERROR");
    } finally {
      setActiveTask(null);
    }
  };

  const filteredRepos = useMemo(() => {
    if (visibilityFilter === 'all') return repos;
    return repos.filter(r => visibilityFilter === 'private' ? r.private : !r.private);
  }, [repos, visibilityFilter]);

  return (
    <div className="h-screen w-full grid grid-cols-[1fr_300px] grid-rows-[60px_80px_1fr_180px] gap-[1px] bg-[var(--border)] overflow-hidden font-mono text-[11px]">
      
      {/* Header */}
      <header className="col-span-2 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-[var(--accent)] shadow-[0_0_10px_var(--accent)]"></div>
          <div className="text-[var(--text-primary)] font-black italic uppercase tracking-tighter text-sm">Balanced_Auditor_v5.2</div>
        </div>
        <div className="flex gap-2">
          {tokenScopes.map(s => (
            <span key={s} className="text-[9px] px-2 py-0.5 bg-[var(--border)] text-[var(--text-secondary)] uppercase rounded-sm">
              {s}
            </span>
          ))}
          {!user && <span className="text-[var(--error)] animate-pulse uppercase font-black">Auth_Offline</span>}
          {ghToken && <span className="text-[9px] px-2 py-0.5 bg-[var(--border)] text-[var(--text-secondary)] uppercase rounded-sm">AUTH_TOKEN_VALID</span>}
        </div>
      </header>

      {/* Controls */}
      <div className="col-span-2 bg-[var(--bg)] px-6 py-4 grid grid-cols-[1fr_1fr_auto] gap-3 items-center border-b border-[var(--border)]">
        <div className="relative">
          <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />
          <input 
            type="password" 
            value={ghToken} 
            onChange={e => setGhToken(e.target.value)} 
            placeholder="GitHub Token" 
            className="w-full bg-[var(--surface)] border border-[var(--border)] p-2.5 pl-10 rounded-md outline-none text-[var(--text-primary)] focus:border-[var(--accent)] transition-all"
          />
        </div>
        <div className="relative">
          <Github className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />
          <input 
            type="text" 
            value={targetUser} 
            onChange={e => setTargetUser(e.target.value)} 
            placeholder="GitHub Username / Target" 
            className="w-full bg-[var(--surface)] border border-[var(--border)] p-2.5 pl-10 rounded-md outline-none text-[var(--text-primary)] focus:border-[var(--accent)] transition-all"
          />
        </div>
        <button 
          onClick={scan} 
          disabled={isScanning} 
          className="bg-[var(--text-primary)] text-[var(--bg)] px-6 py-2.5 rounded-md font-black uppercase tracking-wider hover:bg-[var(--text-secondary)] transition-all disabled:opacity-50 flex items-center gap-2"
        >
          {isScanning ? <RefreshCw className="animate-spin" size={12} /> : <Search size={12} />}
          Sync_Architecture
        </button>
      </div>

      {/* Main Content */}
      <main className="bg-[var(--bg)] p-6 grid grid-cols-2 gap-4 overflow-y-auto custom-scroll">
        {filteredRepos.map((repo) => (
          <div 
            key={repo.id} 
            className={`bg-[var(--surface)] border p-5 rounded-xl transition-all flex flex-col justify-between ${selectedIds.has(repo.id) ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
          >
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-3">
                <input 
                  type="checkbox" 
                  checked={selectedIds.has(repo.id)} 
                  onChange={() => {
                    const n = new Set(selectedIds);
                    n.has(repo.id) ? n.delete(repo.id) : n.add(repo.id);
                    setSelectedIds(n);
                  }} 
                  className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                />
                <h3 className="text-[var(--text-primary)] font-bold text-[13px] uppercase tracking-tight truncate max-w-[150px]">{repo.name}</h3>
              </div>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-sm uppercase ${repo.private ? 'bg-amber-900/20 text-amber-500' : 'bg-[var(--border)] text-[var(--text-secondary)]'}`}>
                {repo.private ? 'Private' : 'Public'}
              </span>
            </div>
            <p className="text-[var(--text-secondary)] italic leading-relaxed line-clamp-2 mb-4 h-8">{repo.description || 'System metadata undefined.'}</p>
            
            <button 
              onClick={() => auditWithBuildTest(repo)} 
              disabled={activeTask !== null} 
              className={`w-full py-2.5 rounded-md font-black uppercase transition-all tracking-widest border flex items-center justify-center gap-2 ${activeTask === repo.id ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-[var(--surface)] text-[var(--text-primary)] border-[var(--border)] hover:bg-[var(--text-primary)] hover:text-[var(--bg)]'}`}
            >
              {activeTask === repo.id ? <RefreshCw className="animate-spin" size={12} /> : <Cpu size={12} />}
              {activeTask === repo.id ? 'Analyzing...' : 'Analyze Logic'}
            </button>
          </div>
        ))}
        {repos.length === 0 && !isScanning && (
          <div className="col-span-full py-20 border border-dashed border-[var(--border)] rounded-3xl flex flex-col items-center justify-center text-[var(--text-muted)]">
            <Github size={32} className="mb-4 opacity-20" />
            <p className="uppercase font-black tracking-widest">No Repositories Indexed</p>
          </div>
        )}
      </main>

      {/* Sidebar (Pipeline Relay) */}
      <aside className="row-span-2 bg-[var(--surface)] border-l border-[var(--border)] flex flex-col overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] text-[var(--text-primary)] font-black uppercase tracking-[0.1em] text-center">Pipeline_Relay</div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scroll">
          {history.map(item => (
            <div key={item.id} className={`pl-3 border-l-2 py-1 relative ${item.status === 'FAIL' ? 'border-[var(--error)]' : 'border-[var(--success)]'}`}>
               <div className={`absolute left-[-5px] top-0.5 h-2 w-2 rounded-full ${item.status === 'FAIL' ? 'bg-[var(--error)]' : 'bg-[var(--success)]'}`}></div>
               <div className="text-[var(--text-primary)] font-bold mb-1">{item.repoName}</div>
               <div className="text-[9px] opacity-60 uppercase">Status: {item.status} | Maturity: {item.maturity}</div>
               {item.uiUrl && (
                 <div className="w-full h-10 bg-black border border-[var(--border)] mt-2 rounded-sm overflow-hidden opacity-50 hover:opacity-100 transition-opacity">
                   <img src={item.uiUrl} className="w-full h-full object-cover" alt="UI" referrerPolicy="no-referrer" />
                 </div>
               )}
            </div>
          ))}
          {history.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] italic text-center">
              <History size={24} className="mb-4 opacity-10" />
              <p>No history.</p>
            </div>
          )}
        </div>
      </aside>

      {/* Console */}
      <footer className="bg-black border-t border-[var(--border)] flex flex-col overflow-hidden">
        <div className="bg-[var(--surface)] px-6 py-2 border-b border-[var(--border)] flex justify-between items-center font-black text-[var(--text-muted)] uppercase">
          <span className="flex items-center gap-2"><Terminal size={12} /> System_Stdout</span>
          <span>Rows: {String(logs.length).padStart(4, '0')}</span>
        </div>
        <div className="p-3 px-6 overflow-y-auto flex-1 custom-scroll">
          {logs.map(log => (
            <div key={log.id} className="flex gap-3 whitespace-nowrap mb-1">
              <span className="text-[var(--text-muted)] shrink-0">[{log.time}]</span>
              <span className={`tracking-tight ${log.type === 'ERROR' ? 'text-[var(--error)]' : log.type === 'SUCCESS' ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
                {log.msg}
              </span>
            </div>
          ))}
        </div>
      </footer>

      {/* Splash Screen (Modal) */}
      <AnimatePresence>
        {splash && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="w-[700px] h-[450px] bg-[var(--surface)] border border-[var(--accent)] rounded-[24px] overflow-hidden flex shadow-[0_0_40px_rgba(99,102,241,0.2)]"
            >
              <div className="flex-1 bg-black border-r border-[var(--border)] flex items-center justify-center p-5">
                {splash.uiUrl ? (
                  <img src={splash.uiUrl} alt="App UI" className="rounded-xl shadow-2xl border border-[var(--border)] w-full aspect-video object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#111] to-[#18181b] rounded-xl border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] font-black">UI_PREVIEW_NULL</div>
                )}
              </div>
              <div className="flex-1 p-10 flex flex-col justify-center">
                <div className={`text-[10px] font-black px-3 py-1 rounded-full w-fit mb-3 uppercase border ${splash.status === 'PASS' ? 'text-[var(--success)] border-[var(--success)]' : 'text-[var(--error)] border-[var(--error)]'}`}>
                  {splash.status === 'PASS' ? 'Deploy Success' : 'Build Failure'}
                </div>
                <h2 className="text-3xl font-black text-[var(--text-primary)] italic uppercase tracking-tighter mb-4">{splash.name}</h2>
                <p className="text-[var(--text-secondary)] font-sans text-xs leading-relaxed mb-6">{splash.summary}</p>
                <div className="bg-black/30 p-4 rounded-xl border border-[var(--border)] mb-6">
                  <div className="text-[8px] text-[var(--text-muted)] font-black uppercase mb-1 tracking-widest">Architect Notes:</div>
                  <p className="text-[var(--text-secondary)] italic leading-snug text-[10px]">{splash.notes}</p>
                </div>
                <button 
                  onClick={() => setSplash(null)} 
                  className="bg-[var(--accent)] text-white py-3 rounded-md font-black uppercase tracking-widest hover:bg-indigo-500 transition-all active:scale-95"
                >
                  Dismiss System Report
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      `}} />
    </div>
  );
}
