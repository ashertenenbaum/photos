'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Photo, ResolvedPost } from '@/lib/photos';
import Lightbox from './Lightbox';
import styles from './Gallery.module.css';

const MOBILE_SHARE_MAX_BYTES = 200 * 1024 * 1024;

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
        console.warn('Failed to fetch photo after retries:', photos[i].key, err);
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

export default function Gallery({ initialPosts }: { initialPosts: ResolvedPost[] }) {
  const [posts] = useState<ResolvedPost[]>(initialPosts);
  const [lightbox, setLightbox] = useState<{ postId: string; index: number } | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [savingPostId, setSavingPostId] = useState<string | null>(null);
  const [saveProgress, setSaveProgress] = useState(0);
  const [canShareFiles, setCanShareFiles] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (!navigator.canShare || !navigator.share) return;
    try {
      const probe = new File([new Blob(['x'])], 'probe.jpg', { type: 'image/jpeg' });
      if (navigator.canShare({ files: [probe] })) setCanShareFiles(true);
    } catch {
      /* not supported */
    }
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    function handle(e: MouseEvent) {
      const menus = Array.from(document.querySelectorAll('[data-gallerymenu]'));
      for (const m of menus) {
        if (m.contains(e.target as Node)) return;
      }
      setOpenMenuId(null);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [openMenuId]);

  const downloadPost = useCallback(async (post: ResolvedPost) => {
    if (post.photos.length === 0 || savingPostId) return;
    setSavingPostId(post.id);
    setSaveProgress(0);
    setOpenMenuId(null);

    try {
      const { files, failed } = await fetchAllPhotos(post.photos, (done, total) => {
        setSaveProgress(Math.round((done / total) * 100));
      });

      if (failed.length > 0 && files.length > 0) {
        if (!confirm(`${failed.length} photos failed to load. Save the ${files.length} that loaded?`)) return;
      }
      if (files.length === 0) {
        alert("Couldn't load any photos. Check your connection and try again.");
        return;
      }

      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      const useShareSheet =
        canShareFiles &&
        navigator.canShare?.({ files }) &&
        totalBytes <= MOBILE_SHARE_MAX_BYTES;

      if (useShareSheet) {
        try {
          await Promise.race([
            navigator.share({ files }),
            new Promise<void>((resolve) => setTimeout(resolve, 120_000)),
          ]);
          return;
        } catch (err) {
          if ((err as Error).name === 'AbortError') return;
          console.warn('Share sheet failed, falling back to zip:', err);
        }
      }

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
    } catch (err) {
      console.error('Download failed:', err);
      alert('Sorry, that failed. Try again.');
    } finally {
      setSavingPostId(null);
      setSaveProgress(0);
    }
  }, [savingPostId, canShareFiles]);

  const activePost = lightbox ? posts.find((p) => p.id === lightbox.postId) ?? null : null;
  const buttonLabel = canShareFiles ? 'Save to Photos' : 'Download all';

  const allEmpty = posts.length === 0 || posts.every((p) => p.photos.length === 0);

  return (
    <main className={styles.main}>
      {allEmpty ? (
        <div className={styles.empty}>
          <h2 className={`display ${styles.emptyTitle}`}>Coming soon</h2>
          <p className={styles.emptyText}>New photographs will appear here.</p>
        </div>
      ) : (
        <div className={styles.posts}>
          {posts.filter((p) => p.photos.length > 0).map((post) => {
            const isSaving = savingPostId === post.id;
            return (
              <div key={post.id} className={styles.post}>
                <div className={styles.postHeader}>
                  <h2 className={`display ${styles.postDate}`}>{post.date}</h2>
                  <div className={styles.menuWrap} data-gallerymenu>
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
                          onClick={() => downloadPost(post)}
                          disabled={isSaving}
                        >
                          {isSaving
                            ? `${saveProgress > 0 ? `${saveProgress}%` : 'Loading…'}`
                            : buttonLabel}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className={styles.grid}>
                  {post.photos.map((photo, i) => (
                    <button
                      key={photo.key}
                      className={styles.tile}
                      onClick={() => setLightbox({ postId: post.id, index: i })}
                      style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                      aria-label={`Open photo ${i + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className={styles.tileImg}
                      />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activePost && lightbox && (
        <Lightbox
          photos={activePost.photos}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
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
