// Project & Thread management
// Persists to a JSON file via Tauri backend

import { invoke } from "@tauri-apps/api/core";

export interface Project {
  id: string;
  title: string;
  workspaceRoot: string;
  createdAt: string;
}

export interface ThreadUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  messages: ThreadMessage[];
  sessionId?: string;
  provider?: string;
  usage?: ThreadUsage;
}

export interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface SessionState {
  rootPath: string | null;
  openFiles: string[]; // file paths of open tabs
  activeFile: string | null;
}

export interface ProjectStore {
  projects: Project[];
  threads: Thread[];
  session?: SessionState;
}

let store: ProjectStore = { projects: [], threads: [] };
let onChangeCallback: (() => void) | null = null;

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Persistence ----

export async function loadProjects(): Promise<ProjectStore> {
  try {
    const data: string = await invoke("load_project_store");
    store = JSON.parse(data);
  } catch {
    store = { projects: [], threads: [] };
  }
  return store;
}

async function saveStore() {
  try {
    await invoke("save_project_store", { data: JSON.stringify(store) });
  } catch (e) {
    console.error("Failed to save project store:", e);
  }
  onChangeCallback?.();
}

export function onStoreChange(cb: () => void) {
  onChangeCallback = cb;
}

// ---- Projects ----

export function getProjects(): Project[] {
  return store.projects;
}

export function getProject(id: string): Project | undefined {
  return store.projects.find((p) => p.id === id);
}

export function findProjectByRoot(root: string): Project | undefined {
  return store.projects.find((p) => p.workspaceRoot === root);
}

export async function createProject(title: string, workspaceRoot: string): Promise<Project> {
  const existing = findProjectByRoot(workspaceRoot);
  if (existing) return existing;

  const project: Project = {
    id: uid(),
    title,
    workspaceRoot,
    createdAt: new Date().toISOString(),
  };
  store.projects.push(project);
  await saveStore();
  return project;
}

export async function deleteProject(id: string) {
  store.projects = store.projects.filter((p) => p.id !== id);
  store.threads = store.threads.filter((t) => t.projectId !== id);
  await saveStore();
}

// ---- Threads ----

export function getThreadsForProject(projectId: string): Thread[] {
  return store.threads
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getThread(id: string): Thread | undefined {
  return store.threads.find((t) => t.id === id);
}

export async function createThread(projectId: string, title: string = "New thread"): Promise<Thread> {
  const thread: Thread = {
    id: uid(),
    projectId,
    title,
    createdAt: new Date().toISOString(),
    messages: [],
  };
  store.threads.push(thread);
  await saveStore();
  return thread;
}

export async function deleteThread(id: string) {
  store.threads = store.threads.filter((t) => t.id !== id);
  await saveStore();
}

export async function renameThread(id: string, title: string) {
  const thread = store.threads.find((t) => t.id === id);
  if (thread) {
    thread.title = title;
    await saveStore();
  }
}

export async function setThreadSessionId(threadId: string, sessionId: string) {
  const thread = store.threads.find((t) => t.id === threadId);
  if (thread) {
    thread.sessionId = sessionId;
    await saveStore();
  }
}

export function getThreadSessionId(threadId: string): string | undefined {
  return store.threads.find((t) => t.id === threadId)?.sessionId;
}

export async function setThreadProvider(threadId: string, provider: string) {
  const thread = store.threads.find((t) => t.id === threadId);
  if (thread && !thread.provider) {
    thread.provider = provider;
    await saveStore();
  }
}

export function getThreadProvider(threadId: string): string | undefined {
  return store.threads.find((t) => t.id === threadId)?.provider;
}

export async function forkThread(threadId: string, newProvider: string): Promise<Thread | null> {
  const source = store.threads.find((t) => t.id === threadId);
  if (!source) return null;

  const forked: Thread = {
    id: uid(),
    projectId: source.projectId,
    title: `${source.title} (${newProvider === "codex" ? "Codex" : "Claude"} fork)`,
    createdAt: new Date().toISOString(),
    messages: source.messages.map((m) => ({ ...m })),
    provider: newProvider,
  };
  store.threads.push(forked);
  await saveStore();
  return forked;
}

export async function addThreadUsage(threadId: string, inputTokens: number, outputTokens: number, costUsd: number) {
  const thread = store.threads.find((t) => t.id === threadId);
  if (thread) {
    if (!thread.usage) {
      thread.usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }
    thread.usage.inputTokens += inputTokens;
    thread.usage.outputTokens += outputTokens;
    thread.usage.costUsd += costUsd;
    await saveStore();
  }
}

export function getThreadUsage(threadId: string): ThreadUsage {
  const thread = store.threads.find((t) => t.id === threadId);
  return thread?.usage || { inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

export async function addMessageToThread(threadId: string, role: "user" | "assistant", content: string) {
  const thread = store.threads.find((t) => t.id === threadId);
  if (thread) {
    thread.messages.push({ role, content, timestamp: Date.now() });
    // Auto-title from first user message
    if (thread.title === "New thread" && role === "user") {
      thread.title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
    }
    await saveStore();
  }
}

// ---- Time formatting ----

// ---- Session Persistence ----

export async function saveSession(rootPath: string | null, openFiles: string[], activeFile: string | null) {
  store.session = { rootPath, openFiles, activeFile };
  await saveStore();
}

export function getSession(): SessionState | null {
  return store.session || null;
}

// ---- Time formatting ----

export function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}
