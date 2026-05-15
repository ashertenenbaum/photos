'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Photo } from '@/lib/photos';
import styles from './Lightbox.module.css';

type Props = {
  photos: Photo[];
  startIndex: number;
  onClose: () => void;
};

export default function Lightbox({ photos, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(startIndex);
  const [chromeVisible, setChromeVisible] = useState(true);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchStartT = useRef<number>(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const photo = photos[index];

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % photos.length);
  }, [photos.length]);

  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + photos.length) % photos.length);
  }, [photos.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // Preload neighbors for smooth navigation
  useEffect(() => {
    const neighbors = [
      photos[(index + 1) % photos.length],
      photos[(index - 1 + photos.length) % photos.length],
    ];
    neighbors.forEach((p) => {
      if (!p) return;
      const img = new Image();
      img.src = p.url;
    });
  }, [index, photos]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setChromeVisible(true);
    hideTimer.current = setTimeout(() => setChromeVisible(false), 2800);
  }, []);

  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [index, scheduleHide]);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
    touchStartT.current = Date.now();
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX.current;
    const dy = t.clientY - touchStartY.current;
    const dt = Date.now() - touchStartT.current;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    // Swipe down to close
    if (dy > 100 && absY > absX) {
      onClose();
    } else if (absX > 50 && absX > absY && dt < 600) {
      if (dx < 0) next();
      else prev();
    }

    touchStartX.current = null;
    touchStartY.current = null;
    scheduleHide();
  }

  async function sharePhoto() {
    // Native share sheet first (iOS shows "Save Image", "Save to Photos",
    // AirDrop, etc. Android/desktop show their equivalents).
    if (navigator.share) {
      try {
        const res = await fetch(photo.url);
        const blob = await res.blob();
        const name = photo.key.split('/').pop() || 'photo.jpg';
        const file = new File([blob], name, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
        await navigator.share({ url: photo.url });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }

    // Desktop fallback: trigger a download.
    try {
      const res = await fetch(photo.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = photo.key.split('/').pop() || 'photo.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(photo.url, '_blank');
    }
  }

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onMouseMove={scheduleHide}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      <div className={styles.backdrop} aria-hidden />

      <div className={`${styles.topBar} ${chromeVisible ? '' : styles.chromeHidden}`}>
        <div className={styles.counter}>
          <span>{index + 1}</span>
          <span className={styles.counterSep}>/</span>
          <span className={styles.counterTotal}>{photos.length}</span>
        </div>

        <div className={styles.topActions}>
          <button
            className="btn btn-icon"
            onClick={sharePhoto}
            aria-label="Save or share"
            title="Save / Share"
          >
            <SaveIcon />
          </button>
          <button
            className="btn btn-icon"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className={styles.imageWrap}>
        {/* draggable=false stops desktop drag; the inline style preserves
            iOS/Android long-press → Save/Share menu (the default), and
            user-select:none prevents the "highlight like text" behaviour. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={photo.url}
          src={photo.url}
          alt=""
          className={styles.image}
          draggable={false}
          style={{
            WebkitTouchCallout: 'default',
            WebkitUserSelect: 'none',
            userSelect: 'none',
          }}
        />
      </div>

      {photos.length > 1 && (
        <>
          <button
            className={`${styles.navBtn} ${styles.navPrev} ${chromeVisible ? '' : styles.chromeHidden}`}
            onClick={prev}
            aria-label="Previous photo"
          >
            <ChevronIcon dir="left" />
          </button>
          <button
            className={`${styles.navBtn} ${styles.navNext} ${chromeVisible ? '' : styles.chromeHidden}`}
            onClick={next}
            aria-label="Next photo"
          >
            <ChevronIcon dir="right" />
          </button>
        </>
      )}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {dir === 'left' ? (
        <polyline points="15 18 9 12 15 6" />
      ) : (
        <polyline points="9 18 15 12 9 6" />
      )}
    </svg>
  );
}
