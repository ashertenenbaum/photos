'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Photo, ResolvedPost } from '@/lib/photos';
import styles from './AdminPanel.module.css';

type UploadItem = {
  id: string;
  name: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress?: number;
  error?: string;
};

type UploadTray = {
  postId: string;
  items: UploadItem[];
  uploading: boolean;
};

function putToR2(
  uploadUrl: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(file);
  });
}

async function fetchPhotoAsFile(photo: Photo, attempts = 3): Promise<File> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(photo.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('Empty response');
      const name = photo.key.split('/').pop() || 'photo.jpg';
      return new File([blob], name, { type: blob.type || 'image/jpeg' });
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Fetch failed');
}

async function fetchAllPhotos(
  photos: Photo[],
  onProgress: (done: number, total: number) => void
): Promise<{ files: File[]; failed: Photo[] }> {
  const CONCURRENCY = 3;
  const files: (File | null)[] = new Array(photos.length).fill(null);
  const failed: Photo[] = [];
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < photos.length) {
      const i = cursor++;
      try {
        files[i] = await fetchPhotoAsFile(photos[i]);
      } catch (err) {
        console.warn('Failed to fetch photo:', photos[i].key, err);
        failed.push(photos[i]);
      }
      done++;
      onProgress(done, photos.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, photos.length) }, () => worker())
  );

  return { files: files.filter((f): f is File => f !== null), failed };
}

export default function AdminPanel({ initialPosts }: { initialPosts: ResolvedPost[] }) {
  const [posts, setPosts] = useState<ResolvedPost[]>(initialPosts);
  const [showNewPostForm, setShowNewPostForm] = useState(false);
  const [newPostDate, setNewPostDate] = useState('');
  const [creatingPost, setCreatingPost] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [tray, setTray] = useState<UploadTray | null>(null);
  const [selected, setSelected] = useState<Map<string, Set<string>>>(new Map());
  const [deleting, setDeleting] = useState(false);
  const [dragOverPostId, setDragOverPostId] = useState<string | null>(null);
  const [savingPostId, setSavingPostId] = useState<string | null>(null);
  const [saveProgress, setSaveProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activePostIdRef = useRef<string | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showNewPostForm) dateInputRef.current?.focus();
  }, [showNewPostForm]);

  // Close 3-dot menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    function handle(e: MouseEvent) {
      const menus = Array.from(document.querySelectorAll('[data-postmenu]'));
      for (const m of menus) {
        if (m.contains(e.target as Node)) return;
      }
      setOpenMenuId(null);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [openMenuId]);

  async function handleCreatePost() {
    if (!newPostDate.trim() || creatingPost) return;
    setCreatingPost(true);
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', date: newPostDate.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setPosts((prev) => [{ ...data.post, photos: [] }, ...prev]);
      setNewPostDate('');
      setShowNewPostForm(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create post');
    } finally {
      setCreatingPost(false);
    }
  }

  const handleFiles = useCallback(async (postId: string, files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;

    const items: UploadItem[] = list.map((f) => ({
      id: `${f.name}-${f.size}-${Math.random()}`,
      name: f.name,
      status: 'pending',
    }));
    setTray({ postId, items, uploading: true });

    const newPhotos: Photo[] = [];

    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const itemId = items[i].id;

      setTray((prev) =>
        prev
          ? { ...prev, items: prev.items.map((it) => it.id === itemId ? { ...it, status: 'uploading', progress: 0 } : it) }
          : prev
      );

      try {
        const tokenRes = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.ok) throw new Error(tokenData.error || 'Could not get upload URL');

        await putToR2(tokenData.uploadUrl, file, (pct) => {
          setTray((prev) =>
            prev
              ? { ...prev, items: prev.items.map((it) => it.id === itemId ? { ...it, progress: pct } : it) }
              : prev
          );
        });

        const uploadedAt = new Date().toISOString();
        await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'addPhoto', postId, key: tokenData.key, size: file.size, uploadedAt }),
        });

        newPhotos.push({ url: tokenData.publicUrl, key: tokenData.key, size: file.size, uploadedAt });
        setTray((prev) =>
          prev
            ? { ...prev, items: prev.items.map((it) => it.id === itemId ? { ...it, status: 'done', progress: 100 } : it) }
            : prev
        );
      } catch (err) {
        setTray((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((it) =>
                  it.id === itemId
                    ? { ...it, status: 'error', error: err instanceof Error ? err.message : 'Failed' }
                    : it
                ),
              }
            : prev
        );
      }
    }

    if (newPhotos.length > 0) {
      setPosts((prev) =>
        prev.map((p) => p.id === postId ? { ...p, photos: [...p.photos, ...newPhotos] } : p)
      );
    }

    setTray((prev) => prev ? { ...prev, uploading: false } : prev);
    setTimeout(() => setTray(null), 3000);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  function openFilePicker(postId: string) {
    activePostIdRef.current = postId;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  const downloadAll = useCallback(async (post: ResolvedPost) => {
    if (post.photos.length === 0 || savingPostId) return;
    setSavingPostId(post.id);
    setSaveProgress(0);
    setOpenMenuId(null);
    try {
      const { files, failed } = await fetchAllPhotos(post.photos, (done, total) => {
        setSaveProgress(Math.round((done / total) * 100));
      });
      if (failed.length > 0 && files.length > 0) {
        if (!confirm(`${failed.length} photos failed. Save the ${files.length} that loaded?`)) return;
      }
      if (files.length === 0) { alert("Couldn't load any photos."); return; }

      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const file of files) zip.file(file.name, file);
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `photos-${post.date.replace(/[\s,/]/g, '-')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('Download failed. Try again.');
    } finally {
      setSavingPostId(null);
      setSaveProgress(0);
    }
  }, [savingPostId]);

  function toggleSelect(postId: string, key: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      const postSet = new Set(next.get(postId) ?? []);
      if (postSet.has(key)) postSet.delete(key);
      else postSet.add(key);
      next.set(postId, postSet);
      return next;
    });
  }

  function clearPostSelection(postId: string) {
    setSelected((prev) => { const n = new Map(prev); n.delete(postId); return n; });
  }

  function selectAllInPost(postId: string, photos: Photo[]) {
    setSelected((prev) => new Map(prev).set(postId, new Set(photos.map((p) => p.key))));
  }

  async function deleteSelectedInPost(postId: string) {
    const postSet = selected.get(postId);
    if (!postSet || postSet.size === 0 || deleting) return;
    const count = postSet.size;
    if (!confirm(`Delete ${count} photo${count === 1 ? '' : 's'}? This can't be undone.`)) return;
    setDeleting(true);
    const keys = Array.from(postSet);
    try {
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys, postId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Delete failed');
      const removed = new Set(keys);
      setPosts((prev) =>
        prev.map((p) => p.id === postId ? { ...p, photos: p.photos.filter((ph) => !removed.has(ph.key)) } : p)
      );
      clearPostSelection(postId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  function onDragOver(e: React.DragEvent, postId: string) {
    e.preventDefault();
    setDragOverPostId(postId);
  }

  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverPostId(null);
    }
  }

  function onDrop(e: React.DragEvent, postId: string) {
    e.preventDefault();
    setDragOverPostId(null);
    if (e.dataTransfer.files.length > 0) handleFiles(postId, e.dataTransfer.files);
  }

  async function logout() {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    window.location.href = '/';
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Admin</p>
          <h1 className={`display ${styles.title}`}>Manage photos</h1>
        </div>
        <div className={styles.headerActions}>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setShowNewPostForm(true); setNewPostDate(''); }}
          >
            New post
          </button>
          <a href="/" className="btn btn-sm">View gallery</a>
          <button className="btn btn-sm" onClick={logout}>Sign out</button>
        </div>
      </header>

      {showNewPostForm && (
        <div className={`card ${styles.newPostCard}`}>
          <p className={styles.newPostLabel}>Set a date for this post</p>
          <div className={styles.newPostRow}>
            <input
              ref={dateInputRef}
              className={styles.newPostInput}
              type="text"
              placeholder="e.g. May 15, 2026"
              value={newPostDate}
              onChange={(e) => setNewPostDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreatePost();
                if (e.key === 'Escape') setShowNewPostForm(false);
              }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleCreatePost}
              disabled={!newPostDate.trim() || creatingPost}
            >
              {creatingPost ? 'Creating…' : 'Create'}
            </button>
            <button
              className="btn btn-sm"
              onClick={() => setShowNewPostForm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {tray && (
        <div className={`card ${styles.tray}`}>
          <div className={styles.trayHeader}>
            <span className={styles.trayTitle}>
              {tray.uploading ? 'Uploading' : 'Upload complete'} ·{' '}
              <span className={styles.trayCount}>
                {tray.items.filter((u) => u.status === 'done').length} / {tray.items.length}
              </span>
            </span>
          </div>
          <div className={styles.trayList}>
            {tray.items.map((u) => (
              <div key={u.id} className={styles.trayItem}>
                <span className={styles.trayItemName} title={u.name}>{u.name}</span>
                <span className={`${styles.trayItemStatus} ${styles[`status_${u.status}`]}`}>
                  {u.status === 'pending' && 'Waiting'}
                  {u.status === 'uploading' && `${u.progress ?? 0}%`}
                  {u.status === 'done' && '✓'}
                  {u.status === 'error' && (u.error || 'Failed')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && activePostIdRef.current) {
            handleFiles(activePostIdRef.current, e.target.files);
          }
        }}
      />

      {posts.length === 0 ? (
        <p className={styles.emptyState}>No posts yet — click "New post" to get started.</p>
      ) : (
        <div className={styles.posts}>
          {posts.map((post) => {
            const postSet = selected.get(post.id) ?? new Set<string>();
            const allSelected = post.photos.length > 0 && postSet.size === post.photos.length;
            const isSaving = savingPostId === post.id;

            return (
              <div key={post.id} className={styles.post}>
                <div className={styles.postHeader}>
                  <h2 className={`display ${styles.postDate}`}>{post.date}</h2>
                  <div className={styles.postActions}>
                    {postSet.size > 0 && (
                      <>
                        <span className={styles.selectedCount}>{postSet.size} selected</span>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => deleteSelectedInPost(post.id)}
                          disabled={deleting}
                        >
                          {deleting ? 'Deleting…' : `Delete ${postSet.size}`}
                        </button>
                        <button className="btn btn-sm" onClick={() => clearPostSelection(post.id)}>
                          Clear
                        </button>
                      </>
                    )}
                    {post.photos.length > 0 && postSet.size === 0 && (
                      <button
                        className="btn btn-sm"
                        onClick={() =>
                          allSelected ? clearPostSelection(post.id) : selectAllInPost(post.id, post.photos)
                        }
                      >
                        Select all
                      </button>
                    )}
                    <button className="btn btn-sm" onClick={() => openFilePicker(post.id)}>
                      Add photos
                    </button>
                    <div className={styles.menuWrap} data-postmenu>
                      <button
                        className={`${styles.menuBtn} ${openMenuId === post.id ? styles.menuBtnActive : ''}`}
                        onClick={() => setOpenMenuId(openMenuId === post.id ? null : post.id)}
                        aria-label="Post options"
                        aria-expanded={openMenuId === post.id}
                      >
                        <DotsIcon />
                      </button>
                      {openMenuId === post.id && (
                        <div className={styles.menuDropdown}>
                          <button
                            className={styles.menuItem}
                            onClick={() => downloadAll(post)}
                            disabled={isSaving || post.photos.length === 0}
                          >
                            {isSaving
                              ? `Downloading ${saveProgress}%`
                              : 'Download all'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {post.photos.length === 0 ? (
                  <button
                    className={`${styles.postEmpty} ${dragOverPostId === post.id ? styles.postEmptyDragOver : ''}`}
                    onClick={() => openFilePicker(post.id)}
                    onDragOver={(e) => onDragOver(e, post.id)}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, post.id)}
                  >
                    <UploadIcon />
                    <span>Add photos to this post</span>
                  </button>
                ) : (
                  <div
                    className={`${styles.grid} ${dragOverPostId === post.id ? styles.gridDragOver : ''}`}
                    onDragOver={(e) => onDragOver(e, post.id)}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, post.id)}
                  >
                    {post.photos.map((photo) => {
                      const isSelected = postSet.has(photo.key);
                      return (
                        <button
                          key={photo.key}
                          className={`${styles.tile} ${isSelected ? styles.tileSelected : ''}`}
                          onClick={() => toggleSelect(post.id, photo.key)}
                          aria-pressed={isSelected}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photo.url} alt="" loading="lazy" className={styles.tileImg} />
                          <div className={styles.tileOverlay} aria-hidden>
                            <div className={`${styles.check} ${isSelected ? styles.checkOn : ''}`}>
                              {isSelected && <CheckIcon />}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
