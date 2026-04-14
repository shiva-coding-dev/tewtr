import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, Loader2, PanelLeftClose, PanelLeft, Plus,
  X, ArrowUp, LogOut, ZoomIn, ZoomOut, ChevronsLeft, ChevronsRight,
  Layers as FlashcardIcon, CornerDownRight, Quote, RotateCcw
} from 'lucide-react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { auth, db } from './lib/firebase';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  collection, doc, setDoc, getDoc, query, where, onSnapshot, orderBy, serverTimestamp
} from 'firebase/firestore';
import AuthPage from './pages/AuthPage';

const API_BASE_URL = 'http://localhost:8000';

interface ChatMessage { role: 'user' | 'tutor'; content: string; }
interface SessionDoc { id: string; filename: string; timestamp: any; userId: string; }
interface Flashcard { q: string; a: string; }

const BackgroundElements = () => (
  <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
    <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[120%] bg-cadmium/10 skew-x-[-15deg] blur-[100px]" />
    <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[140%] bg-blue-900/10 skew-x-[20deg] blur-[120px]" />
    <div className="absolute top-[20%] right-[30%] w-32 h-32 border border-white/5 rounded-3xl opacity-20" />
    <div className="absolute bottom-[10%] left-[20%] w-64 h-64 border border-white/5 rounded-full opacity-10" />
  </div>
);

const App: React.FC = () => {
  // --- CORE STATE ---
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(null);
  const [sessions, setSessions] = useState<SessionDoc[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [dashboardActive, setDashboardActive] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // --- FILE STAGING ---
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [pdfPreview, setPdfPreview] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);

  // --- PIPELINE DATA ---
  const [vlmMap, setVlmMap] = useState<Record<number, string>>({});
  const [llmMap, setLlmMap] = useState<Record<number, any>>({});
  const [flashcardsByPage, setFlashcardsByPage] = useState<Record<number, Flashcard[]>>({});
  const [pageLoading, setPageLoading] = useState<Record<number, boolean>>({});
  const [chatHistory, setChatHistory] = useState<Record<number, ChatMessage[]>>({});
  const [previewPage, setPreviewPage] = useState<number>(0);
  const [data, setData] = useState<{ filename: string; total_pages: number } | null>(null);

  // --- VIEWER (PAN/ZOOM) ---
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // --- UI CONTROLS ---
  const [userQuery, setUserQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const [pipelineStage, setPipelineStage] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [flashcardsOpen, setFlashcardsOpen] = useState(false);
  const [isGeneratingFlashcards, setIsGeneratingFlashcards] = useState(false);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [stagedReference, setStagedReference] = useState<string | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number, y: number, text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const llmMapRef = useRef<Record<number, unknown>>({});
  const inFlightPages = useRef<Set<number>>(new Set());
  const stagedUploadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    llmMapRef.current = llmMap;
  }, [llmMap]);

  // --- HANDLERS ---
  const handleFileChange = (e: any) => {
    const files = e.target.files;
    if (!files) return;
    const filesArr = Array.from(files) as File[];
    let pdfFile = selectedPdf;
    let imgFiles = [...selectedImages];
    let pdfUrl = pdfPreview;
    let newPreviews = [...imagePreviews];

    filesArr.forEach(f => {
      if (f.type === 'application/pdf' && !pdfFile) {
        pdfFile = f;
        pdfUrl = URL.createObjectURL(f);
      } else if (f.type.startsWith('image/')) {
        imgFiles.push(f);
        newPreviews.push(URL.createObjectURL(f));
      }
    });
    setSelectedPdf(pdfFile);
    setPdfPreview(pdfUrl);
    setSelectedImages(imgFiles);
    setImagePreviews(newPreviews);
  };

  const processPipeline = useCallback(async (pageNum: number, filename: string) => {
    if (inFlightPages.current.has(pageNum) || llmMapRef.current[pageNum]) return;
    inFlightPages.current.add(pageNum);
    setPageLoading(prev => ({ ...prev, [pageNum]: true }));
    setPipelineStage(prev => ({ ...prev, [pageNum]: 'Vision model is cooking…' }));
    try {
      const vlmResp = await axios.post(`${API_BASE_URL}/transcribe/${filename}?page_index=${pageNum}`, undefined, { timeout: 120_000 });
      const tr = vlmResp.data.markdown;
      setPipelineStage(prev => ({ ...prev, [pageNum]: 'Formatting it for you…' }));
      const llmResp = await axios.post(`${API_BASE_URL}/explain`, { transcription: tr }, { timeout: 120_000 });
      const syn = llmResp.data.result;

      setVlmMap(p => ({ ...p, [pageNum]: tr }));
      setLlmMap(p => ({ ...p, [pageNum]: syn }));
      if (currentSessionId) {
        const pageRef = doc(db, "sessions", currentSessionId, "pages", pageNum.toString());
        await setDoc(pageRef, { transcription: tr, synthesis: syn, timestamp: serverTimestamp() }, { merge: true });
      }

      inFlightPages.current.delete(pageNum);
      setPageLoading(prev => ({ ...prev, [pageNum]: false }));
      setPipelineStage(prev => {
        const n = { ...prev };
        delete n[pageNum];
        return n;
      });
    } catch (e) {
      console.error("Pipeline fail page", pageNum, e);
      setError("Could not analyze this page. Try again or check the backend.");
      inFlightPages.current.delete(pageNum);
      setPageLoading(prev => ({ ...prev, [pageNum]: false }));
      setPipelineStage(prev => {
        const n = { ...prev };
        delete n[pageNum];
        return n;
      });
    }
  }, [currentSessionId]);

  const handleGenerateFlashcards = useCallback(async () => {
    if (!data || !vlmMap[previewPage] || !llmMap[previewPage]?.explanation || isGeneratingFlashcards) return;
    if (flashcardsByPage[previewPage]?.length) {
      setActiveCardIndex(0);
      setCardFlipped(false);
      setFlashcardsOpen(true);
      return;
    }

    setIsGeneratingFlashcards(true);
    setError(null);
    try {
      const fcResp = await axios.post(
        `${API_BASE_URL}/flashcards`,
        { transcription: vlmMap[previewPage], explanation: llmMap[previewPage].explanation },
        { timeout: 30_000 }
      );
      const cards = fcResp.data.flashcards || [];
      setFlashcardsByPage(p => ({ ...p, [previewPage]: cards }));
      if (currentSessionId) {
        const pageRef = doc(db, "sessions", currentSessionId, "pages", previewPage.toString());
        await setDoc(pageRef, { flashcards: cards, timestamp: serverTimestamp() }, { merge: true });
      }
      setActiveCardIndex(0);
      setCardFlipped(false);
      setFlashcardsOpen(true);
    } catch (e) {
      console.error("Flashcards fail page", previewPage, e);
      setError("Could not generate flashcards for this page.");
    } finally {
      setIsGeneratingFlashcards(false);
    }
  }, [currentSessionId, data, flashcardsByPage, isGeneratingFlashcards, llmMap, previewPage, vlmMap]);

  const loadChatHistory = useCallback(async (pageNum: number) => {
    if (!user || !currentSessionId) return;
    const chatRef = collection(db, "sessions", currentSessionId, "pages", pageNum.toString(), "chats");
    const q = query(chatRef, orderBy("timestamp", "asc"));
    onSnapshot(q, (snap) => {
      const messages = snap.docs.map(d => d.data() as ChatMessage);
      setChatHistory(prev => ({ ...prev, [pageNum]: messages }));
    });
  }, [user, currentSessionId]);

  useEffect(() => {
    if (currentSessionId && dashboardActive) {
      loadChatHistory(previewPage);
    }
  }, [currentSessionId, previewPage, dashboardActive, loadChatHistory]);

  useEffect(() => {
    if (!dashboardActive || !currentSessionId || !data || !user) return;
    let cancelled = false;

    const loadOrRun = async (pageNum: number) => {
      if (cancelled) return;
      if (llmMapRef.current[pageNum] || inFlightPages.current.has(pageNum)) return;

      const pageRef = doc(db, "sessions", currentSessionId, "pages", pageNum.toString());
      try {
        const snap = await getDoc(pageRef);
        if (cancelled) return;
        if (snap.exists()) {
          const d = snap.data();
          setVlmMap(p => ({ ...p, [pageNum]: d.transcription }));
          setLlmMap(p => ({ ...p, [pageNum]: d.synthesis }));
          setFlashcardsByPage(p => ({ ...p, [pageNum]: d.flashcards || [] }));
        } else {
          await processPipeline(pageNum, data.filename);
        }
      } catch {
        if (!cancelled) await processPipeline(pageNum, data.filename);
      }
    };

    void (async () => {
      const end = Math.min(previewPage + 5, data.total_pages - 1);
      const tasks: Promise<void>[] = [];
      for (let i = previewPage; i <= end; i++) {
        tasks.push(loadOrRun(i));
      }
      await Promise.all(tasks);
    })();

    return () => {
      cancelled = true;
    };
  }, [dashboardActive, currentSessionId, data, previewPage, user, processPipeline]);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        const q = query(collection(db, "sessions"), where("userId", "==", u.uid), orderBy("timestamp", "desc"));
        onSnapshot(q, (snap) => setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() } as SessionDoc))));
        setAuthMode(null);
      }
    });
  }, []);

  const hasFiles = !!selectedPdf || selectedImages.length > 0;

  const handleStart = useCallback(async () => {
    if (!user) { setAuthMode('signup'); return; }
    setLoading(true);
    setUploadPhase('Preparing the PDF…');
    setError(null);
    const formData = new FormData();
    if (selectedPdf) formData.append('files', selectedPdf);
    selectedImages.forEach(img => formData.append('files', img));
    try {
      const resp = await axios.post(`${API_BASE_URL}/upload`, formData, { timeout: 180_000 });
      const sid = doc(collection(db, "sessions")).id;
      setCurrentSessionId(sid);
      setData({ filename: resp.data.filename, total_pages: resp.data.total_pages });
      setDashboardActive(true);
      setSidebarOpen(false);
      setPreviewPage(0);
      // Do not await — a slow/blocked Firestore would leave "Uploading…" forever
      void setDoc(doc(db, "sessions", sid), {
        filename: resp.data.filename,
        total_pages: resp.data.total_pages,
        userId: user.uid,
        timestamp: serverTimestamp(),
      }).catch((err) => {
        console.error('Firestore session save failed', err);
        setError('Notes are ready, but saving this chat to the cloud failed. Check Firebase rules and network.');
      });
    } catch (e) {
      console.error(e);
      const msg = axios.isAxiosError(e)
        ? (e.code === 'ECONNABORTED' ? 'Upload timed out. Try a smaller file or check your connection.' : (e.response?.status ? `Upload failed (${e.response.status}).` : 'Upload failed. Is the backend running at http://localhost:8000 ?'))
        : 'Upload failed. Is the backend running at http://localhost:8000 ?';
      setError(msg);
    } finally {
      setUploadPhase(null);
      setLoading(false);
    }
  }, [user, selectedPdf, selectedImages]);

  useEffect(() => {
    if (!hasFiles) stagedUploadKeyRef.current = null;
  }, [hasFiles]);

  useEffect(() => {
    if (!hasFiles || !user || dashboardActive || loading) return;
    const key = [
      selectedPdf?.name ?? '',
      selectedPdf?.size ?? 0,
      ...selectedImages.map(f => `${f.name}:${f.size}`),
    ].join('|');
    if (stagedUploadKeyRef.current === key) return;
    stagedUploadKeyRef.current = key;
    void handleStart();
  }, [hasFiles, user, dashboardActive, loading, selectedPdf, selectedImages, handleStart]);

  const hadFilesRef = useRef(false);
  useEffect(() => {
    if (hasFiles && !user && !hadFilesRef.current) {
      setAuthMode('signup');
    }
    hadFilesRef.current = hasFiles;
  }, [hasFiles, user]);

  const onMouseDown = (e: React.MouseEvent) => { if (zoom <= 1) return; setIsDragging(true); dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; };
  const onMouseMove = (e: React.MouseEvent) => { if (!isDragging) return; const limit = (zoom - 1) * 400; setPan({ x: Math.max(-limit, Math.min(limit, e.clientX - dragStart.current.x)), y: Math.max(-limit, Math.min(limit, e.clientY - dragStart.current.y)) }); };

  const handleSend = async () => {
    if (!userQuery.trim() || isAsking || !data) return;
    const q = userQuery; const cp = stagedReference ? `Context: "${stagedReference}"\n\nQ: ${q}` : q;
    setUserQuery(""); setStagedReference(null); setChatHistory(prev => ({ ...prev, [previewPage]: [...(prev[previewPage] || []), { role: 'user', content: q }] })); setIsAsking(true);
    try {
      const r = await axios.post(`${API_BASE_URL}/chat`, { filename: data.filename, page_index: previewPage, context: vlmMap[previewPage], question: cp });
      const tutorMsg = { role: 'tutor' as const, content: r.data.answer };
      setChatHistory(prev => ({ ...prev, [previewPage]: [...(prev[previewPage] || []), tutorMsg] }));

      if (currentSessionId) {
        const userMsgRef = doc(collection(db, "sessions", currentSessionId, "pages", previewPage.toString(), "chats"));
        await setDoc(userMsgRef, { role: 'user', content: q, timestamp: serverTimestamp() });
        const tutorMsgRef = doc(collection(db, "sessions", currentSessionId, "pages", previewPage.toString(), "chats"));
        await setDoc(tutorMsgRef, { role: 'tutor', content: r.data.answer, timestamp: serverTimestamp() });
      }
    } finally { setIsAsking(false); }
  };

  const resetSession = () => {
    stagedUploadKeyRef.current = null;
    setUploadPhase(null);
    setPipelineStage({});
    setDashboardActive(false);
    setData(null);
    setSelectedPdf(null);
    setPdfPreview(null);
    setSelectedImages([]);
    setImagePreviews([]);
    setSidebarOpen(true);
    setCurrentSessionId(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const displayPage = data ? previewPage + 1 : 0;
  const displayTotal = data?.total_pages ?? 0;

  const goToPage = (idx: number) => {
    if (!data) return;
    setPreviewPage(Math.max(0, Math.min(idx, data.total_pages - 1)));
  };

  return (
    <div className="flex h-screen w-full bg-[#0d0d0e] overflow-hidden font-sans selection:bg-cadmium/40 selection:text-white relative" onMouseUp={() => setIsDragging(false)}>
      <BackgroundElements />
      <AnimatePresence>{authMode && <AuthPage initialMode={authMode} onClose={() => setAuthMode(null)} />}</AnimatePresence>

      <AnimatePresence>
        {selectionMenu && (
          <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={{ left: selectionMenu.x, top: selectionMenu.y - 45 }} className="fixed z-[300] -translate-x-1/2 bg-white text-black px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-2xl flex items-center gap-2" onClick={(e) => { e.stopPropagation(); setStagedReference(selectionMenu.text); setSelectionMenu(null); }}>Reference <Quote size={12} /></motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence mode="popLayout" initial={false}>
        {sidebarOpen && (
          <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 320, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="h-full bg-black/40 backdrop-blur-xl border-r border-zinc-900 flex flex-col p-8 z-50 shrink-0">
            <div className="flex items-center justify-between mb-12"><span className="text-xl font-display font-medium text-white uppercase tracking-wider">Past Chats</span><button onClick={() => setSidebarOpen(false)} className="opacity-40 hover:opacity-100 p-2 text-white"><PanelLeftClose size={20} /></button></div>
            <div className="flex-1 overflow-y-auto hide-scrollbar space-y-4 font-bold">
              {sessions.map(s => (
                <button key={s.id} onClick={() => { setCurrentSessionId(s.id); setData({ filename: s.filename, total_pages: (s as any).total_pages || 1 }); setDashboardActive(true); setSidebarOpen(false); setPreviewPage(0); }} className={`w-full text-left p-4 rounded-2xl transition-all ${currentSessionId === s.id ? 'bg-white/5 border border-white/10' : 'hover:bg-white/5'}`}>
                  <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">{s.timestamp ? new Date(s.timestamp.toDate()).toLocaleDateString() : 'Recent'}</p>
                  <p className="text-white text-sm truncate">{s.filename}</p>
                </button>
              ))}
            </div>
            <button className="text-[10px] uppercase font-bold text-cadmium border border-cadmium/20 px-6 py-4 rounded-xl hover:bg-white hover:text-black transition-all w-full mt-auto" onClick={resetSession}><Plus size={14} className="inline mr-2" /> New Chat</button>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col relative z-20 min-w-0 bg-[#0d0d0e]/60 backdrop-blur-[100px]">
        <header className="h-24 flex items-center justify-between px-10 absolute top-0 w-full z-40">
          <div className="flex items-center gap-6">{!sidebarOpen && <button onClick={() => setSidebarOpen(true)} className="opacity-40 hover:opacity-100 text-white"><PanelLeft size={20} /></button>}</div>
          <div className="text-6xl font-black text-white tracking-widest select-none" style={{ fontWeight: 100, transform: 'scaleY(1.8) translateX(48px)', letterSpacing: '0.3em' }}>TEWTR</div>
          <div className="flex items-center gap-4">
            {!user ? (
              <div className="flex gap-4">
                <button onClick={() => setAuthMode('login')} className="bg-white text-black px-8 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest">Login</button>
                <button onClick={() => setAuthMode('signup')} className="border border-white/10 text-white px-8 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-white/5">Sign Up</button>
              </div>
            ) : (
              <div className="w-12 h-12 rounded-full border border-white/5 flex items-center justify-center text-[10px] font-bold text-white bg-zinc-900 group relative cursor-pointer overflow-hidden">
                {user.photoURL ? <img src={user.photoURL} alt="p" className="w-full h-full object-cover shadow-2xl" /> : (user.displayName?.[0] || 'U').toUpperCase()}
                <button onClick={() => signOut(auth)} className="absolute inset-0 bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><LogOut size={16} /></button>
              </div>
            )}
          </div>
        </header>

        {!dashboardActive ? (
          <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl w-full">
              <h1 className="text-7xl font-display font-medium mb-24 text-white leading-tight">Interrogate your <br /><span className="text-cadmium italic">notes.</span></h1>
              <div className="flex flex-col items-center gap-12 w-full">
                <div className={`w-full max-w-2xl border-2 border-dashed transition-all duration-500 rounded-[3rem] bg-black/20 ${hasFiles ? 'border-cadmium p-6' : 'border-white/10 p-12'} relative`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFileChange({ target: { files: e.dataTransfer.files } }); }}>
                  {loading && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-[3rem] bg-black/70 backdrop-blur-sm px-6">
                      <Loader2 className="animate-spin text-cadmium mb-4" size={40} />
                      <p className="text-sm font-medium text-white/90 text-center">{uploadPhase ?? 'Uploading…'}</p>
                      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40 mt-3">Sending to your tutor backend</p>
                    </div>
                  )}
                  {!hasFiles ? (
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="bg-white text-black px-12 py-6 rounded-full font-bold text-xl shadow-2xl hover:scale-105 transition-all">Upload PDF or image</button>
                  ) : (
                    <div className="w-full flex items-center gap-6 overflow-x-auto px-8 pb-4 hide-scrollbar">
                      {selectedPdf && <div className="shrink-0 w-32 h-44 bg-zinc-900 border border-cadmium/30 rounded-2xl flex flex-col items-center relative overflow-hidden group">
                        {pdfPreview && <iframe src={pdfPreview} className="w-full h-full border-none pointer-events-none grayscale scale-150 origin-top" title="p" />}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><X className="text-red-500 cursor-pointer" onClick={() => setSelectedPdf(null)} /></div>
                      </div>}
                      {selectedImages.map((_, i) => <div key={i} className="shrink-0 w-32 h-44 border border-white/10 rounded-2xl overflow-hidden grayscale group relative"><img src={imagePreviews[i]} className="w-full h-full object-cover" alt="" /><X className="absolute top-2 right-2 text-red-500 opacity-0 group-hover:opacity-100 cursor-pointer" onClick={() => setSelectedImages(p => p.filter((_, idx) => idx !== i))} /></div>)}
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="shrink-0 w-32 h-44 bg-zinc-900/50 border border-dashed border-white/5 rounded-2xl flex items-center justify-center text-white text-3xl hover:border-cadmium transition-all">+</button>
                    </div>
                  )}
                  <input type="file" ref={fileInputRef} className="hidden" multiple accept="application/pdf,image/*" onChange={handleFileChange} />
                </div>
                {error && (
                  <p className="text-red-400 text-sm max-w-lg mt-4" role="alert">{error}</p>
                )}
              </div>
            </motion.div>
          </main>
        ) : (
          <main className="flex-1 flex pt-32 h-full overflow-hidden relative">
            <div className={`transition-all duration-1000 ${sidebarOpen ? 'w-0 opacity-0 overflow-hidden' : 'w-[450px] xl:w-[550px] opacity-100 p-8'} flex flex-col shrink-0 border-r border-white/5 group/viewer`}>
              {data && (
                <div className="h-full flex flex-col">
                  <div className="flex-1 bg-[#050505] border border-white/5 rounded-[4rem] overflow-hidden relative flex items-center justify-center p-4 shadow-[0_0_100px_rgba(0,0,0,1)]">
                    <div className="absolute top-8 right-8 flex flex-col gap-4 z-30 opacity-0 group-hover/viewer:opacity-100 transition-opacity">
                      <button onClick={() => setZoom(z => Math.min(z + 0.4, 4))} className="p-5 bg-zinc-900/80 backdrop-blur-md rounded-full text-white hover:text-cadmium border border-white/5"><ZoomIn size={20} /></button>
                      <button onClick={() => setZoom(z => Math.max(z - 0.4, 0.5))} className="p-5 bg-zinc-900/80 backdrop-blur-md rounded-full text-white hover:text-cadmium border border-white/5"><ZoomOut size={20} /></button>
                      <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-5 bg-zinc-900/80 backdrop-blur-md rounded-full text-white hover:text-cadmium border border-white/5"><RotateCcw size={20} /></button>
                    </div>
                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 bg-black/80 backdrop-blur-3xl border border-white/10 px-8 py-3 rounded-full text-xs font-black uppercase tracking-[0.3em] text-zinc-500 shadow-2xl">
                      {displayPage} / {displayTotal}
                    </div>
                    <div className="h-full w-full flex items-center justify-center overflow-hidden cursor-move" onMouseDown={onMouseDown} onMouseMove={onMouseMove}>
                      <motion.img animate={{ scale: zoom, x: pan.x, y: pan.y }} transition={isDragging ? { duration: 0 } : { type: 'spring', damping: 20 }} src={`${API_BASE_URL}/preview/${data.filename}/${previewPage}`} className="max-h-full max-w-full pointer-events-none select-none shadow-2xl" alt="" />
                    </div>
                  </div>
                  <div className="mt-10 flex flex-col items-stretch gap-4 text-white">
                    <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
                      <button type="button" title="First page" disabled={previewPage === 0} onClick={() => goToPage(0)} className="p-3 rounded-xl border border-white/10 bg-zinc-900/80 hover:border-cadmium/50 hover:text-cadmium disabled:opacity-20 disabled:hover:border-white/10 disabled:hover:text-white transition-colors"><ChevronsLeft size={18} /></button>
                      <button type="button" title="Previous page" disabled={previewPage === 0} onClick={() => goToPage(previewPage - 1)} className="px-4 py-3 rounded-xl border border-white/10 bg-zinc-900/80 text-[10px] font-black uppercase tracking-[0.2em] hover:border-cadmium/50 hover:text-cadmium disabled:opacity-20 transition-colors">Prev</button>
                      <div className="flex items-center gap-2 px-2">
                        <label htmlFor="page-select" className="text-[10px] font-black uppercase tracking-widest text-zinc-500 shrink-0">Page</label>
                        <select
                          id="page-select"
                          value={previewPage}
                          onChange={(e) => goToPage(Number(e.target.value))}
                          className="min-w-[4.5rem] max-w-[min(100%,12rem)] bg-zinc-950 border border-white/15 rounded-xl px-3 py-2.5 text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-cadmium/50"
                        >
                          {Array.from({ length: data.total_pages }, (_, i) => (
                            <option key={i} value={i}>{i + 1}</option>
                          ))}
                        </select>
                        <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest whitespace-nowrap">/ {data.total_pages}</span>
                      </div>
                      <button type="button" title="Next page" disabled={previewPage >= data.total_pages - 1} onClick={() => goToPage(previewPage + 1)} className="px-4 py-3 rounded-xl border border-white/10 bg-zinc-900/80 text-[10px] font-black uppercase tracking-[0.2em] hover:border-cadmium/50 hover:text-cadmium disabled:opacity-20 transition-colors">Next</button>
                      <button type="button" title="Last page" disabled={previewPage >= data.total_pages - 1} onClick={() => goToPage(data.total_pages - 1)} className="p-3 rounded-xl border border-white/10 bg-zinc-900/80 hover:border-cadmium/50 hover:text-cadmium disabled:opacity-20 disabled:hover:border-white/10 disabled:hover:text-white transition-colors"><ChevronsRight size={18} /></button>
                    </div>
                    <p className="text-center text-[9px] font-bold uppercase tracking-[0.35em] text-zinc-600">Jump to any page from the menu</p>
                  </div>
                </div>
              )}
            </div>
            <div className="flex-1 flex flex-col min-w-0 bg-transparent relative p-12">
              <AnimatePresence>{llmMap[previewPage] && !pageLoading[previewPage] && (
                <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} onClick={handleGenerateFlashcards} disabled={isGeneratingFlashcards} className="absolute top-12 right-12 z-[60] p-5 bg-cadmium text-black rounded-full shadow-[0_0_40px_rgba(40,167,69,0.4)] font-black text-[10px] uppercase tracking-widest flex items-center gap-3 hover:scale-110 transition-all disabled:opacity-60 disabled:hover:scale-100"><FlashcardIcon size={20} /> {isGeneratingFlashcards ? 'Generating Cards' : 'Review Cards'}</motion.button>
              )}</AnimatePresence>
              <div className="flex-1 overflow-y-auto hide-scrollbar pb-64">
                <div className="max-w-4xl mx-auto py-10">
                  {pageLoading[previewPage] ? (
                    <div className="flex flex-col items-center justify-center py-32 px-6 text-center animate-pulse">
                      <Loader2 size={50} className="animate-spin mb-8 text-cadmium shrink-0" />
                      <p className="text-lg sm:text-xl font-medium text-white/90 tracking-tight max-w-md leading-snug">
                        {pipelineStage[previewPage] ?? 'Getting your page ready…'}
                      </p>
                      <p className="mt-6 text-[10px] uppercase font-black tracking-[0.35em] text-white/25">
                        Nemotron · vision + notes pipeline
                      </p>
                    </div>
                  ) : llmMap[previewPage] ? (
                    <div className="animate-reveal leading-loose">
                      <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-white/5 mb-16 border-b border-white/5 pb-6">Synthesis Page {previewPage + 1}</h2>
                      <div className="text-white text-3xl font-medium tracking-tight text-left leading-[1.7] selection:bg-cadmium selection:text-black" onMouseUp={(e) => { e.stopPropagation(); const s = window.getSelection(); if (s && s.toString().trim().length > 3) { const r = s.getRangeAt(0).getBoundingClientRect(); setSelectionMenu({ x: r.left + r.width / 2, y: r.top, text: s.toString() }); } else { setSelectionMenu(null); } }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{ hr: () => <hr className="my-24 border-white/5" />, p: ({ children }) => <p className="mb-16">{children}</p>, h1: ({ children }) => <h1 className="text-6xl font-black mt-24 mb-12 text-white italic">{children}</h1>, h2: ({ children }) => <h2 className="text-5xl font-black mt-20 mb-10 text-zinc-300">{children}</h2>, h3: ({ children }) => <h3 className="text-4xl font-black mt-16 mb-8 text-zinc-500">{children}</h3> }}>{llmMap[previewPage].explanation}</ReactMarkdown>
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-40 mt-40">
                    {(chatHistory[previewPage] || []).map((msg, i) => (
                      <div key={i} className="flex justify-center animate-reveal w-full"><div className="w-full max-w-4xl"><p className="text-[10px] font-black text-zinc-700 uppercase tracking-[0.5em] mb-10">{msg.role === 'user' ? 'Direct Inquiry' : 'Synthesis Response'}</p><div className="text-3xl leading-[1.7] text-white/80 font-medium text-left"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{msg.content}</ReactMarkdown></div></div></div>
                    ))}
                    {isAsking && (
                      <div className="text-center py-24 animate-pulse">
                        <p className="text-sm font-medium text-white/40 mb-2">Nemotron is thinking…</p>
                        <p className="text-[10px] font-black tracking-[1.2em] text-white/15 uppercase">Shaping an answer from this page</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="absolute bottom-16 left-0 right-0 flex justify-center px-12 pointer-events-none">
                <div className="w-full max-w-2xl bg-[#080809]/90 backdrop-blur-3xl border border-white/10 rounded-[3rem] p-6 shadow-[0_0_100px_rgba(0,0,0,0.8)] pointer-events-auto flex flex-col">
                  <AnimatePresence>{stagedReference && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="mb-8"><div className="bg-white/5 rounded-3xl p-6 flex items-center justify-between border border-white/5 shadow-inner"><div className="flex items-center gap-6 min-w-0"><CornerDownRight size={24} className="text-cadmium shrink-0" /><p className="text-sm text-zinc-500 italic truncate font-medium">"{stagedReference}"</p></div><button onClick={() => setStagedReference(null)} className="text-zinc-700 hover:text-white transition-colors ml-6"><X size={20} /></button></div></motion.div>
                  )}</AnimatePresence>
                  <div className="flex items-end gap-4 pr-2">
                    <textarea ref={textareaRef} rows={1} value={userQuery} onChange={(e) => { setUserQuery(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 350)}px`; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder="Ask your Tewtr..." className="flex-1 bg-transparent border-none focus:ring-0 text-white font-bold text-2xl p-4 hide-scrollbar resize-none text-center placeholder:text-zinc-800 placeholder:font-black placeholder:tracking-widest" />
                    <button onClick={handleSend} disabled={isAsking || !userQuery.trim()} className="w-20 h-20 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-90 transition-all shadow-2xl disabled:opacity-20 shrink-0"><ArrowUp size={40} /></button>
                  </div>
                </div>
              </div>
              <AnimatePresence>{flashcardsOpen && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] bg-[#0d0d0e]/99 backdrop-blur-3xl flex items-center justify-center p-12"><button onClick={() => { setFlashcardsOpen(false); setCardFlipped(false); }} className="absolute top-16 right-16 text-white/10 hover:text-white p-6 transition-colors"><X size={64} /></button><div className="max-w-3xl w-full flex flex-col items-center gap-20"><div className="text-[12px] uppercase font-black tracking-[0.8em] text-white/10">Archival Flashcards — {activeCardIndex + 1} / {flashcardsByPage[previewPage]?.length || 0}</div><div className="w-full aspect-[4/3] perspective-2000 cursor-pointer" onClick={() => setCardFlipped(!cardFlipped)}><motion.div animate={{ rotateY: cardFlipped ? 180 : 0 }} transition={{ type: "spring", stiffness: 150, damping: 20 }} className="relative w-full h-full preserve-3d"><div className="absolute inset-0 backface-hidden bg-zinc-900 border border-white/5 rounded-[5rem] p-20 flex items-center justify-center text-center shadow-[0_0_80px_rgba(0,0,0,0.5)]"><p className="text-4xl font-black text-white italic leading-relaxed">"{flashcardsByPage[previewPage]?.[activeCardIndex]?.q || 'No cards generated'}"</p></div><div className="absolute inset-0 backface-hidden bg-cadmium rounded-[5rem] p-20 flex items-center justify-center text-center text-black rotate-y-180 shadow-2xl shadow-cadmium/20"><p className="text-4xl font-black leading-relaxed">{flashcardsByPage[previewPage]?.[activeCardIndex]?.a || ''}</p></div></motion.div></div><div className="flex items-center gap-20"><button disabled={activeCardIndex === 0} onClick={() => { setActiveCardIndex(p => p - 1); setCardFlipped(false); }} className="text-white hover:text-cadmium disabled:opacity-5 active:scale-90"><ArrowRight size={64} className="rotate-180" /></button><button disabled={activeCardIndex === (flashcardsByPage[previewPage]?.length || 1) - 1} onClick={() => { setActiveCardIndex(p => p + 1); setCardFlipped(false); }} className="text-white hover:text-cadmium disabled:opacity-5 active:scale-90"><ArrowRight size={64} /></button></div></div></motion.div>
              )}</AnimatePresence>
            </div>
          </main>
        )}
      </div>
    </div>
  );
};

export default App;
