'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Photo } from '@/lib/photos';
import Lightbox from './Lightbox';
import styles from './Gallery.module.css';

// iOS Web Share API starts misbehaving with very large total payloads.
// Above this size we fall back to a zip download even on mobile.
const MOBILE_SHARE_MAX_BYTES = 200 * 1024 * 1024;

async function fetchPhotoAsFile(photo: Photo, attempts = 3): Promise<File> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      // Same-origin fetch through /api/photo proxy. No CORS, no preflight.
      const res = await fetch(photo.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('Empty response');
      const name = photo.key.split('/').pop() || 'photo.jpg';
      // Use the response's content type (R2 sets it), fall back to jpeg.
      return new File([blob], name, { type: blob.type || 'image/jpeg' });
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        // Exponential backoff: 500ms, 1000ms, 2000ms.
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Fetch failed');
}

async function fetchAllPhotos(
  photos: Photo[],
  onProgress: (done: number, total: number) => void
): Promise<{ files: File[]; failed: Photo[] }> {
  // 3 in parallel is the sweet spot for same-origin fetches on mobile.
  // Above this we risk hitting browser RAM limits or per-host caps.
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

  return {
    files: files.filter((f): f is File => f !== null),
    failed,
  };
}

export default function Gallery({ initialPhotos }: { initialPhotos: Photo[] }) {
  const [photos] = useState<Photo[]>(initialPhotos);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [canShareFiles, setCanShareFiles] = useState(false);

  const openAt = useCallback((i: number) => setActiveIndex(i), []);
  const close = useCallback(() => setActiveIndex(null), []);

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

  const saveAll = useCallback(async () => {
    if (photos.length === 0 || saving) return;
    setSaving(true);
    setSaveProgress(0);

    try {
      const { files, failed } = await fetchAllPhotos(photos, (done, total) => {
        setSaveProgress(Math.round((done / total) * 100));
      });

      if (failed.length > 0 && files.length > 0) {
        const proceed = confirm(
          `${failed.length} of ${photos.length} photos failed to load. ` +
            `Save the ${files.length} that did load anyway?`
        );
        if (!proceed) return;
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
          // iOS WebKit has a known bug where share() doesn't always resolve
          // when the user picks "Save Image" — the save works, the promise
          // just hangs. The race protects our UI from getting stuck.
          await Promise.race([
            navigator.share({ files }),
            new Promise<void>((resolve) => setTimeout(resolve, 120_000)),
          ]);
          return;
        } catch (err) {
          if ((err as Error).name === 'AbortError') return; // user cancelled
          console.warn('Share sheet failed, falling back to zip:', err);
        }
      }

      // Desktop path: zip download.
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const file of files) {
        zip.file(file.name, file);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `photos-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Save all failed:', err);
      alert('Sorry, that failed. Try again.');
    } finally {
      setSaving(false);
      setSaveProgress(0);
    }
  }, [photos, saving, canShareFiles]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 's' && !e.metaKey && !e.ctrlKey && activeIndex === null) {
        const target = e.target as HTMLElement;
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
        saveAll();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveAll, activeIndex]);

  const buttonLabel = canShareFiles ? 'Save all to Photos' : 'Download all';

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.brand}>
          {photos.length > 0 && (
            <p className={styles.subtitle}>
              {photos.length} {photos.length === 1 ? 'image' : 'images'}
            </p>
          )}
        </div>
        {photos.length > 0 && (
          <button
            className="btn btn-primary"
            onClick={saveAll}
            disabled={saving}
            aria-label={buttonLabel}
          >
            {saving ? (
              <>
                <Spinner /> Loading {saveProgress}%
              </>
            ) : (
              <>
                <SaveIcon /> {buttonLabel}
              </>
            )}
          </button>
        )}
      </header>

      {photos.length === 0 ? (
        <div className={styles.empty}>
          <h2 className={`display ${styles.emptyTitle}`}>Coming soon</h2>
          <p className={styles.emptyText}>New photographs will appear here.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {photos.map((photo, i) => (
            <button
              key={photo.url}
              className={styles.tile}
              onClick={() => openAt(i)}
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
      )}

      {activeIndex !== null && (
        <Lightbox photos={photos} startIndex={activeIndex} onClose={close} />
      )}
    </main>
  );
}

function SaveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 1-9 9">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}
