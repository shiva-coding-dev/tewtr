/**
 * Persists per-folio transcription, synthesis, chat, and flashcards in localStorage
 * (survives refresh; not tied to server DB). Keyed by upload filename.
 */

const STORAGE_PREFIX = 'atelier_nb_v1:';

export interface NotebookSnapshot {
  vlm: Record<string, string>;
  llm: Record<string, { explanation: string }>;
  chat: Record<string, { role: 'user' | 'tutor'; content: string }[]>;
  flash: Record<string, { q: string; a: string }[]>;
}

function emptySnapshot(): NotebookSnapshot {
  return { vlm: {}, llm: {}, chat: {}, flash: {} };
}

function key(filename: string) {
  return `${STORAGE_PREFIX}${filename}`;
}

export function readNotebook(filename: string): NotebookSnapshot {
  try {
    const raw = localStorage.getItem(key(filename));
    if (!raw) return emptySnapshot();
    const parsed = JSON.parse(raw) as NotebookSnapshot;
    return {
      vlm: parsed.vlm || {},
      llm: parsed.llm || {},
      chat: parsed.chat || {},
      flash: parsed.flash || {},
    };
  } catch {
    return emptySnapshot();
  }
}

export function loadNotebookPage(filename: string, page: number) {
  const b = readNotebook(filename);
  const s = String(page);
  return {
    vlm: b.vlm[s],
    llm: b.llm[s],
    chat: b.chat[s],
    flash: b.flash[s],
  };
}

export function saveNotebookPage(
  filename: string,
  page: number,
  partial: {
    transcription?: string;
    synthesis?: { explanation: string };
    chat?: { role: 'user' | 'tutor'; content: string }[];
    flashcards?: { q: string; a: string }[];
  },
) {
  const b = readNotebook(filename);
  const s = String(page);
  if (partial.transcription !== undefined) b.vlm[s] = partial.transcription;
  if (partial.synthesis !== undefined) b.llm[s] = partial.synthesis;
  if (partial.chat !== undefined) b.chat[s] = partial.chat;
  if (partial.flashcards !== undefined) b.flash[s] = partial.flashcards;
  try {
    localStorage.setItem(key(filename), JSON.stringify(b));
  } catch (e) {
    console.warn('[notebook] localStorage save failed (quota or disabled)', e);
  }
}
