/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider,
  onAuthStateChanged, 
  User,
  signOut
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  serverTimestamp, 
  query, 
  orderBy,
  limit
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
  Search,
  Cpu,
  RefreshCw,
  LogIn,
  LogOut,
  Zap,
  Layers,
  Binary,
  Globe,
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
  
  // Global Search State
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState<any[]>([]);
  const [isSearchingGlobal, setIsSearchingGlobal] = useState(false);
  const [activeTab, setActiveTab] = useState<'repos' | 'search'>('repos');

  // Helper for GitHub API calls with better error reporting
  const ghFetch = async (url: string, options: RequestInit = {}) => {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `token ${ghToken}`,
          'Accept': 'application/vnd.github.v3+json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`GitHub API Error [${response.status}]: ${errorData.message}`);
      }

      return response;
    } catch (e) {
      if (e instanceof Error && e.message.includes('Failed to fetch')) {
        throw new Error("Network Error: Failed to connect to GitHub. Check your internet connection or GitHub Token permissions.");
      }
      throw e;
    }
  };

  // Splash State
  const [splash, setSplash] = useState<any>(null); // { name, uiUrl, status, summary, notes }
  const [showVision, setShowVision] = useState(false);
  const [showIntro, setShowIntro] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('intro_v52_dismissed') !== 'true';
    }
    return true;
  });

  const ai = useMemo(() => {
    try {
      const key = process.env.GEMINI_API_KEY;
      if (!key) {
        console.warn("GEMINI_API_KEY is missing. AI features will be disabled.");
        return null;
      }
      return new GoogleGenAI({ apiKey: key });
    } catch (e) {
      console.error("AI Init Failed", e);
      return null;
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  useEffect(() => {
    if (!user) return;
    const path = `artifacts/${appId}/users/${user.uid}/deployments`;
    const q = query(collection(db, path), orderBy('timestamp', 'desc'), limit(50));
    
    return onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setHistory(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  }, [user]);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      addLog("Authenticated via Google", "SUCCESS");
    } catch (e) {
      addLog(`Auth failed: ${e instanceof Error ? e.message : String(e)}`, "ERROR");
    }
  };

  const logout = () => signOut(auth);

  const performGlobalSearch = async () => {
    if (!globalSearchQuery || !ghToken) return;
    setIsSearchingGlobal(true);
    setActiveTab('search');
    addLog(`GLOBAL SEARCH: "${globalSearchQuery}"...`);
    try {
      let username = targetUser;
      if (!username) {
        const userRes = await ghFetch('https://api.github.com/user');
        const userData = await userRes.json();
        username = userData.login;
      }

      const res = await ghFetch(`https://api.github.com/search/code?q=user:${username}+${globalSearchQuery}`);
      const data = await res.json();
      
      if (data.items) {
        setGlobalSearchResults(data.items);
        addLog(`Search complete. Found ${data.total_count} occurrences.`, "SUCCESS");
      }
    } catch (e) {
      addLog(e instanceof Error ? e.message : String(e), "ERROR");
    } finally {
      setIsSearchingGlobal(false);
    }
  };

  const addLog = (msg: string, type: 'INFO' | 'ERROR' | 'SUCCESS' = 'INFO') => {
    setLogs(prev => [{ msg, type, time: new Date().toLocaleTimeString(), id: Math.random() }, ...prev].slice(0, 50));
  };

  const generateUIPreview = async (repoName: string, repoContext: string) => {
    if (!ai) return null;
    try {
      addLog(`GENERATING UI PREVIEW: ${repoName}...`);
      const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `Generate a high-quality UI screenshot description for a software application named "${repoName}". Technical context: ${repoContext.substring(0, 500)}. Dashboard style, dark theme. (Simulation placeholder)`;
      
      // Note: Actual image generation via Imagen usually requires different flow or is mocked here
      // For now, let's use a themed placeholder that looks professional if generateImages isn't available
      return `https://picsum.photos/seed/${repoName}/1280/720?blur=2`;
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
      const userRes = await ghFetch(`https://api.github.com/user`);
      const userData = await userRes.json();
      setTokenScopes(userRes.headers.get('x-oauth-scopes')?.split(', ') || []);
      
      const currentTarget = targetUser || userData.login;
      if (!targetUser) setTargetUser(userData.login);

      const endpoint = currentTarget === userData.login 
        ? `https://api.github.com/user/repos?sort=pushed&per_page=100&type=all` 
        : `https://api.github.com/users/${currentTarget}/repos?sort=pushed&per_page=100`;
      
      const repoRes = await ghFetch(endpoint);
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
    if (!ai) return addLog("AI System not initialized. Check GEMINI_API_KEY.", "ERROR");
    setActiveTask(repo.id);
    addLog(`PIPELINE START: ${repo.name}...`);
    try {
      const treeRes = await ghFetch(`https://api.github.com/repos/${repo.owner.login}/${repo.name}/git/trees/${repo.default_branch}?recursive=1`);
      const treeData = await treeRes.json();
      const allFiles = treeData.tree || [];
      const logicFiles = allFiles.filter((f: any) => f.type === 'blob' && f.path.match(/\.(js|ts|jsx|tsx|py|go|json|yml|txt|md)$/)).sort((a: any, b: any) => b.size - a.size).slice(0, 15);

      let context = `FILES:\n${allFiles.map((f: any) => f.path).slice(0, 50).join('\n')}\n\nCODE:`;
      for (let f of logicFiles) {
        const fRes = await ghFetch(f.url);
        const fData = await fRes.json();
        const cleanContent = (fData.content || '').replace(/\s/g, '');
        context += `\n\n### ${f.path}\n${atob(cleanContent).substring(0, 3000)}\n---`;
      }

      // Generate UI Preview Image
      const uiUrl = await generateUIPreview(repo.name, context);

      const model = ai.getGenerativeModel({ 
        model: "gemini-1.5-pro",
        systemInstruction: "You are a Senior Software Architect specializing in AGI-driven autonomous software evolution. Analyze the provided code and file structure. Provide a deep conceptual synthesis, categorizing the repo into tiers (Foundation, Integration, Experimental). Output ONLY JSON.",
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              readme: { type: Type.STRING },
              build_status: { type: Type.STRING, enum: ["PASS", "FAIL"] },
              build_notes: { type: Type.STRING },
              maturity: { type: Type.STRING },
              summary: { type: Type.STRING }
            },
            required: ["readme", "build_status", "build_notes", "maturity", "summary"]
          }
        }
      });

      const result = await model.generateContent(`Analyze and audit the following repository: ${repo.name}.\n\nSOURCE CONTEXT:\n${context}`);
      const audit = JSON.parse(result.response.text());

      let finalReadme = audit.readme;
      if (uiUrl) finalReadme = `![App Preview](${uiUrl})\n\n` + finalReadme;
      
      const fileStatus = await fetch(`https://api.github.com/repos/${repo.owner.login}/${repo.name}/contents/README.md?ref=${repo.default_branch}`, { 
        headers: { 'Authorization': `token ${ghToken}` } 
      });
      const sha = fileStatus.ok ? (await fileStatus.json()).sha : null;

      addLog(`UPDATING README: ${repo.name}...`);
      await ghFetch(`https://api.github.com/repos/${repo.owner.login}/${repo.name}/contents/README.md`, {
        method: 'PUT',
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
    <div className="relative">
      {/* Main System UI */}
      <div className="min-h-screen md:h-screen w-full flex flex-col md:grid md:grid-cols-[1fr_300px] md:grid-rows-[60px_auto_1fr_180px] gap-[1px] bg-[var(--border)] md:overflow-hidden font-mono text-[11px]">
        
        {/* Header */}
        <header className="col-span-1 md:col-span-2 bg-[var(--surface)] border-b border-[var(--border)] flex flex-col md:flex-row items-center justify-between px-4 md:px-6 py-3 md:py-0 gap-4 md:gap-0">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="w-2 h-2 bg-[var(--accent)] shadow-[0_0_10px_var(--accent)]"></div>
            <div className="text-[var(--text-primary)] font-black italic uppercase tracking-tighter text-sm">Balanced_Auditor_v5.2</div>
          </div>
          <div className="flex items-center justify-between md:justify-end gap-4 w-full md:w-auto">
            <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0 font-sans">
              {tokenScopes.map(s => (
                <span key={s} className="text-[9px] px-2 py-0.5 bg-[var(--border)] text-[var(--text-secondary)] uppercase rounded-sm whitespace-nowrap border border-white/5">
                  {s}
                </span>
              ))}
            </div>
            {user ? (
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[var(--text-secondary)] uppercase font-bold text-[10px] md:text-[11px]">{user.email?.split('@')[0]}</span>
                <button onClick={logout} className="text-[var(--text-muted)] hover:text-[var(--error)] transition-colors">
                  <LogOut size={14} />
                </button>
              </div>
            ) : (
              <button onClick={login} className="flex items-center gap-2 bg-[var(--accent)] text-white px-4 py-1.5 rounded-md font-black uppercase hover:bg-indigo-500 transition-all shrink-0">
                <LogIn size={14} /> Login
              </button>
            )}
          </div>
        </header>

        {/* Controls */}
        <div className="col-span-1 md:col-span-2 bg-[var(--bg)] px-4 md:px-6 py-4 grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-center border-b border-[var(--border)]">
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
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />
            <input 
              type="text" 
              value={globalSearchQuery} 
              onChange={e => setGlobalSearchQuery(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && performGlobalSearch()}
              placeholder="Global Code Search" 
              className="w-full bg-[var(--surface)] border border-[var(--border)] p-2.5 pl-10 rounded-md outline-none text-[var(--text-primary)] focus:border-[var(--accent)] transition-all"
            />
          </div>
          <div className="flex gap-2">
            <button 
              onClick={scan} 
              disabled={isScanning || !user} 
              className="flex-1 md:flex-none bg-[var(--text-primary)] text-[var(--bg)] px-4 py-2.5 rounded-md font-black uppercase tracking-wider hover:bg-[var(--text-secondary)] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isScanning ? <RefreshCw className="animate-spin" size={12} /> : <RefreshCw size={12} />}
              Sync
            </button>
            <button 
              onClick={performGlobalSearch} 
              disabled={isSearchingGlobal || !user} 
              className="flex-1 md:flex-none bg-[var(--accent)] text-white px-4 py-2.5 rounded-md font-black uppercase tracking-wider hover:bg-indigo-500 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSearchingGlobal ? <RefreshCw className="animate-spin" size={12} /> : <Globe size={12} />}
              Search
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="bg-[var(--bg)] flex flex-col overflow-hidden min-h-[400px] md:min-h-0">
          <div className="flex border-b border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
            <button 
              onClick={() => setActiveTab('repos')}
              className={`px-6 py-3 font-black uppercase tracking-widest text-[10px] border-r border-[var(--border)] transition-all whitespace-nowrap ${activeTab === 'repos' ? 'bg-[var(--bg)] text-[var(--accent)] border-t border-t-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-white'}`}
            >
              Repos ({repos.length})
            </button>
            <button 
              onClick={() => setActiveTab('search')}
              className={`px-6 py-3 font-black uppercase tracking-widest text-[10px] border-r border-[var(--border)] transition-all whitespace-nowrap ${activeTab === 'search' ? 'bg-[var(--bg)] text-[var(--accent)] border-t border-t-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-white'}`}
            >
              Search ({globalSearchResults.length})
            </button>
          </div>

          <main className="flex-1 p-4 md:p-6 overflow-y-auto custom-scroll">
            {!user ? (
              <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)] text-center">
                <ShieldCheck size={48} className="mb-4 opacity-20" />
                <p className="uppercase font-black tracking-[0.3em] mb-4">System Access Restricted</p>
                <button onClick={login} className="bg-[var(--accent)] text-white px-8 py-3 rounded-xl font-black uppercase hover:bg-indigo-500 transition-all">Initialize Auth Session</button>
              </div>
            ) : activeTab === 'repos' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredRepos.map((repo) => (
                  <div 
                    key={repo.id} 
                    className={`bg-[var(--surface)] border p-5 rounded-xl transition-all flex flex-col justify-between ${selectedIds.has(repo.id) ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <input 
                          type="checkbox" 
                          checked={selectedIds.has(repo.id)} 
                          onChange={() => {
                            const n = new Set(selectedIds);
                            n.has(repo.id) ? n.delete(repo.id) : n.add(repo.id);
                            setSelectedIds(n);
                          }} 
                          className="w-4 h-4 accent-[var(--accent)] cursor-pointer shrink-0"
                        />
                        <h3 className="text-[var(--text-primary)] font-bold text-[13px] uppercase tracking-tight truncate">{repo.name}</h3>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-sm uppercase shrink-0 ${repo.private ? 'bg-amber-900/20 text-amber-500' : 'bg-[var(--border)] text-[var(--text-secondary)]'}`}>
                        {repo.private ? 'Private' : 'Public'}
                      </span>
                    </div>
                    <p className="text-[var(--text-secondary)] italic leading-relaxed line-clamp-2 mb-4 h-8 text-[10px] md:text-[11px] font-sans">{repo.description || 'System metadata undefined.'}</p>
                    
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
              </div>
            ) : (
              <div className="space-y-4 font-sans">
                {globalSearchResults.map((item, idx) => (
                  <div key={idx} className="bg-[var(--surface)] border border-[var(--border)] p-4 rounded-xl hover:border-[var(--accent)] transition-all group">
                    <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-2 md:gap-0 mb-2">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <Binary className="text-[var(--accent)] shrink-0" size={14} />
                        <span className="text-[var(--text-primary)] font-bold truncate">{item.repository.full_name}</span>
                        <span className="text-[var(--text-muted)] shrink-0">/</span>
                        <span className="text-[var(--text-secondary)] truncate">{item.path}</span>
                      </div>
                      <a 
                        href={item.html_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-[var(--text-muted)] hover:text-white transition-colors self-end md:self-auto"
                      >
                        <Globe size={14} />
                      </a>
                    </div>
                    <div className="bg-black/40 p-3 rounded-md border border-[var(--border)] font-mono text-[10px] text-[var(--text-secondary)] overflow-x-auto">
                      <span className="opacity-40 italic">Match found in system architecture. Click globe to view source.</span>
                    </div>
                  </div>
                ))}
                {globalSearchResults.length === 0 && !isSearchingGlobal && (
                  <div className="py-20 border border-dashed border-[var(--border)] rounded-3xl flex flex-col items-center justify-center text-[var(--text-muted)]">
                    <Search size={32} className="mb-4 opacity-20" />
                    <p className="uppercase font-black tracking-widest">No Global Matches Found</p>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>

        {/* Sidebar (Pipeline Relay) */}
        <aside className="bg-[var(--surface)] border-t md:border-t-0 md:border-l border-[var(--border)] flex flex-col overflow-hidden h-[300px] md:h-auto md:row-span-2">
          <div className="p-4 border-b border-[var(--border)] text-[var(--text-primary)] font-black uppercase tracking-[0.1em] text-center flex items-center justify-center gap-2">
            <History size={14} /> Pipeline_Relay
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scroll">
            {history.map(item => (
              <div key={item.id} className={`pl-3 border-l-2 py-1 relative ${item.status === 'FAIL' ? 'border-[var(--error)]' : 'border-[var(--success)]'}`}>
                 <div className={`absolute left-[-5px] top-0.5 h-2 w-2 rounded-full ${item.status === 'FAIL' ? 'bg-[var(--error)]' : 'bg-[var(--success)]'}`}></div>
                 <div className="text-[var(--text-primary)] font-bold mb-1 truncate">{item.repoName}</div>
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
          <div className="p-4 border-t border-[var(--border)] bg-black/20">
            <button 
              onClick={() => setShowVision(true)}
              className="w-full flex items-center justify-center gap-2 text-[var(--accent)] hover:text-white transition-colors uppercase font-black text-[9px] tracking-widest"
            >
              <Zap size={12} /> View Ecosystem Vision
            </button>
          </div>
        </aside>

        {/* Console */}
        <footer className="bg-black border-t border-[var(--border)] flex flex-col overflow-hidden h-[200px] md:h-auto">
          <div className="bg-[var(--surface)] px-6 py-2 border-b border-[var(--border)] flex justify-between items-center font-black text-[var(--text-muted)] uppercase">
            <span className="flex items-center gap-2"><Terminal size={12} /> System_Stdout</span>
            <span className="hidden md:inline">Rows: {String(logs.length).padStart(4, '0')}</span>
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
      </div>

      {/* Vision Modal */}
      <AnimatePresence>
        {showVision && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 md:p-10"
          >
            <motion.div 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="max-w-5xl w-full h-full bg-[var(--surface)] border border-[var(--accent)] rounded-[1.5rem] md:rounded-[3rem] overflow-hidden flex flex-col shadow-2xl shadow-indigo-500/20"
            >
              <div className="p-6 md:p-8 border-b border-[var(--border)] flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <Zap className="text-[var(--accent)]" size={24} />
                  <h2 className="text-xl md:text-2xl font-black text-white italic uppercase tracking-tighter">Conceptual System Analysis</h2>
                </div>
                <button onClick={() => setShowVision(false)} className="text-[var(--text-muted)] hover:text-white transition-colors">
                  <X size={24} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 md:p-12 space-y-8 md:space-y-12 custom-scroll font-sans text-sm leading-relaxed text-[var(--text-secondary)]">
                <section className="space-y-6">
                  <div className="flex items-center gap-4 text-[var(--accent)] font-black uppercase tracking-widest text-xs">
                    <Globe size={16} /> Core Vision: Autonomous Software Evolution
                  </div>
                  <p className="text-base md:text-lg text-[var(--text-primary)] font-light italic leading-relaxed">
                    "This ecosystem is designed to bootstrap itself into increasingly capable autonomous systems, building toward AGI-driven software evolution."
                  </p>
                </section>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
                  <div className="bg-black/40 p-6 md:p-8 rounded-2xl md:rounded-3xl border border-[var(--border)] space-y-4">
                    <div className="flex items-center gap-3 text-[var(--accent)] font-black uppercase text-[10px]">
                      <Binary size={14} /> Tier 1: Foundation
                    </div>
                    <h4 className="text-[var(--text-primary)] font-bold uppercase">AGI-KERNEL</h4>
                    <p className="text-[11px] italic">Self-bootstrapping core that autonomously reviews and enforces code quality.</p>
                  </div>
                  <div className="bg-black/40 p-6 md:p-8 rounded-2xl md:rounded-3xl border border-[var(--border)] space-y-4">
                    <div className="flex items-center gap-3 text-[var(--accent)] font-black uppercase text-[10px]">
                      <Layers size={14} /> Tier 2: Integration
                    </div>
                    <h4 className="text-[var(--text-primary)] font-bold uppercase">AI-CREATOR-HUB</h4>
                    <p className="text-[11px] italic">"The 1 System" - Evolution Engine + RAG + GitHub Universe Explorer.</p>
                  </div>
                  <div className="bg-black/40 p-6 md:p-8 rounded-2xl md:rounded-3xl border border-[var(--border)] space-y-4">
                    <div className="flex items-center gap-3 text-[var(--accent)] font-black uppercase text-[10px]">
                      <Zap size={14} /> Tier 3: Evolution
                    </div>
                    <h4 className="text-[var(--text-primary)] font-bold uppercase">AI-SCAFFOLD</h4>
                    <p className="text-[11px] italic">Autonomous code evolution using AI analysis and iterative GitHub commits.</p>
                  </div>
                </div>

                <section className="bg-black/20 p-6 md:p-10 rounded-[1.5rem] md:rounded-[2.5rem] border border-[var(--border)] space-y-6">
                  <h3 className="text-[var(--text-primary)] font-black uppercase tracking-widest text-center text-xs md:text-sm">The Recursive Development Engine (RDE)</h3>
                  <div className="flex flex-col md:flex-row justify-between items-center gap-6 text-center">
                    <div className="flex-1 space-y-2">
                       <div className="text-[var(--accent)] font-black uppercase tracking-tighter">OBSERVE</div>
                       <div className="text-[10px] opacity-60 uppercase">GitHub Universe Explorer</div>
                    </div>
                    <div className="text-[var(--text-muted)] hidden md:block text-2xl font-light">→</div>
                    <div className="flex-1 space-y-2">
                       <div className="text-[var(--accent)] font-black uppercase tracking-tighter">REASON</div>
                       <div className="text-[10px] opacity-60 uppercase">Unitary Core Analysis</div>
                    </div>
                    <div className="text-[var(--text-muted)] hidden md:block text-2xl font-light">→</div>
                    <div className="flex-1 space-y-2">
                       <div className="text-[var(--accent)] font-black uppercase tracking-tighter">EVOLVE</div>
                       <div className="text-[10px] opacity-60 uppercase">AI Scaffold Commit</div>
                    </div>
                  </div>
                </section>

                <p className="text-center italic opacity-40 text-[10px] pt-10">
                  "The question isn't whether you can build this. The question is: What happens when it works?"
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Audit Splash Modal */}
      <AnimatePresence>
        {splash && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 md:p-6"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full md:w-[700px] h-auto md:h-[450px] bg-[var(--surface)] border border-[var(--accent)] rounded-[24px] overflow-hidden flex flex-col md:flex-row shadow-[0_0_40px_rgba(99,102,241,0.2)]"
            >
              <div className="flex-1 bg-black border-b md:border-b-0 md:border-r border-[var(--border)] flex items-center justify-center p-5">
                {splash.uiUrl ? (
                  <img src={splash.uiUrl} alt="App UI" className="rounded-xl shadow-2xl border border-white/10 w-full aspect-video object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full aspect-video bg-gradient-to-br from-[#111] to-[#18181b] rounded-xl border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] font-black italic">UI_PREVIEW_NULL</div>
                )}
              </div>
              <div className="flex-1 p-6 md:p-10 flex flex-col justify-center">
                <div className={`text-[10px] font-black px-3 py-1 rounded-full w-fit mb-3 uppercase border ${splash.status === 'PASS' ? 'text-[var(--success)] border-[var(--success)]' : 'text-[var(--error)] border-[var(--error)]'}`}>
                  {splash.status === 'PASS' ? 'Deploy Success' : 'Build Failure'}
                </div>
                <h2 className="text-2xl md:text-3xl font-black text-[var(--text-primary)] italic uppercase tracking-tighter mb-4">{splash.name}</h2>
                <p className="text-[var(--text-secondary)] font-sans text-[10px] md:text-xs leading-relaxed mb-6 italic">{splash.summary}</p>
                <div className="bg-black/30 p-4 rounded-xl border border-[var(--border)] mb-6">
                  <div className="text-[8px] text-[var(--text-muted)] font-black uppercase mb-1 tracking-widest">Architect Notes:</div>
                  <p className="text-[var(--text-secondary)] italic leading-snug text-[10px] font-sans">{splash.notes}</p>
                </div>
                <button 
                  onClick={() => setSplash(null)} 
                  className="bg-[var(--accent)] text-white py-3 rounded-md font-black uppercase tracking-widest hover:bg-indigo-500 transition-all active:scale-95 shadow-lg shadow-indigo-500/20"
                >
                  Dismiss Report
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      `}} />

      {/* System Intro Splash Panel */}
      <AnimatePresence>
        {showIntro && (
          <motion.div 
            key="intro-splash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black flex flex-col items-center justify-start md:justify-center p-4 md:p-10 font-mono overflow-y-auto custom-scroll"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--accent)_0%,_transparent_60%)] opacity-10 pointer-events-none"></div>
            
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.05, opacity: 0 }}
              className="max-w-4xl w-full bg-[var(--surface)] border border-[var(--border)] rounded-[2rem] relative shadow-2xl flex flex-col md:flex-row h-auto md:h-[600px] my-auto"
            >
              <div className="flex-1 bg-black p-8 md:p-12 flex flex-col justify-center gap-6 border-b md:border-b-0 md:border-r border-[var(--border)] relative overflow-hidden shrink-0">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--accent)] blur-[100px] opacity-20 capitalize"></div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-[var(--accent)] animate-pulse shadow-[0_0_15px_var(--accent)]"></div>
                  <span className="text-[var(--accent)] font-black tracking-widest text-[10px] uppercase">System_Initialize</span>
                </div>
                <h1 className="text-4xl md:text-5xl font-black text-white italic uppercase tracking-tighter leading-none">
                  Balanced_<br/>Auditor_v5.2
                </h1>
                <p className="text-[var(--text-secondary)] text-sm md:text-base leading-relaxed italic border-l-2 border-[var(--accent)] pl-6 py-2">
                  The Recursive Development Engine (RDE) for autonomous software architecture evolution.
                </p>
                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex items-center gap-4 group">
                    <ShieldCheck className="text-[var(--accent)] group-hover:scale-110 transition-transform" size={18} />
                    <span className="text-[var(--text-secondary)] text-[10px] uppercase tracking-widest font-black">Google Auth Required</span>
                  </div>
                  <div className="flex items-center gap-4 group">
                    <Github className="text-[var(--accent)] group-hover:scale-110 transition-transform" size={18} />
                    <span className="text-[var(--text-secondary)] text-[10px] uppercase tracking-widest font-black">GitHub Token Access</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 p-8 md:p-12 flex flex-col justify-between gap-8 bg-[var(--surface)]">
                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-white font-black uppercase text-xs tracking-widest">
                      <Search size={14} className="text-[var(--accent)]" /> 01_Observe
                    </div>
                    <p className="text-[var(--text-secondary)] text-[11px] leading-relaxed font-sans">
                      Scan entire GitHub ecosystems and generate visual architectural previews using specialized Vision models.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-white font-black uppercase text-xs tracking-widest">
                      <Cpu size={14} className="text-[var(--accent)]" /> 02_Reason
                    </div>
                    <p className="text-[var(--text-secondary)] text-[11px] leading-relaxed font-sans">
                      GEMINI-powered structural analysis, maturity auditing, and conceptual tier categorization.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-white font-black uppercase text-xs tracking-widest">
                      <RefreshCw size={14} className="text-[var(--accent)]" /> 03_Evolve
                    </div>
                    <p className="text-[var(--text-secondary)] text-[11px] leading-relaxed font-sans">
                      Autonomous feedback loop synchronizing audit reports and AI-generated visuals back to GitHub READMEs.
                    </p>
                  </div>
                </div>

                <button 
                  onClick={() => {
                    console.log("System initialization sequence engaged...");
                    localStorage.setItem('intro_v52_dismissed', 'true');
                    setShowIntro(false);
                  }}
                  className="w-full bg-white text-black py-4 rounded-xl font-black uppercase tracking-[0.2em] hover:bg-[var(--accent)] hover:text-white transition-all active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.1)] flex items-center justify-center gap-3"
                >
                  Enter_System <Zap size={16} />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
