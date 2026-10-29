"use client";

import { useEffect, useState } from "react";

/**
 * IndexedDB store for binary data that would not fit in localStorage:
 * pasted images, browser screenshots and files delivered from the sandbox.
 */
const DB_NAME = "grok-chat";
const STORE = "blobs";
const MEMORY_LIMIT = 8 * 1024 * 1024;

const memory = new Map<string, Blob>();
const urls = new Map<string, string>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req ? req.result : undefined);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

/** Available in memory right away; written to IndexedDB in the background. */
export function putBlob(key: string, blob: Blob): Promise<void> {
  memory.set(key, blob);
  return run("readwrite", (s) => s.put(blob, key)).then(() => {
    if (blob.size > MEMORY_LIMIT) memory.delete(key);
  });
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const cached = memory.get(key);
  if (cached) return cached;
  const blob = await run<Blob>("readonly", (s) => s.get(key));
  if (blob && blob.size <= MEMORY_LIMIT) memory.set(key, blob);
  return blob ?? undefined;
}

export async function deleteBlobs(keys: string[]): Promise<void> {
  if (!keys.length) return;
  for (const key of keys) {
    memory.delete(key);
    const url = urls.get(key);
    if (url) URL.revokeObjectURL(url);
    urls.delete(key);
  }
  await run("readwrite", (s) => {
    for (const key of keys) s.delete(key);
  });
}

export async function listBlobKeys(): Promise<string[]> {
  const keys = await run<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  return (keys ?? []).map(String);
}

export async function blobUrl(key: string): Promise<string | undefined> {
  const existing = urls.get(key);
  if (existing) return existing;
  const blob = await getBlob(key);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Object URL for a stored blob, or undefined while loading / when missing. */
export function useBlobUrl(key: string | undefined): string | undefined {
  const [state, setState] = useState<{ key?: string; url?: string }>({});
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void blobUrl(key).then((url) => {
      if (alive) setState({ key, url });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return key && state.key === key ? state.url : undefined;
}
