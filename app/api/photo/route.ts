import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
// Vercel Hobby allows up to 60s. A multi-megabyte photo on a slow mobile
// connection could take a while to stream through.
export const maxDuration = 60;

// Same-origin photo proxy. Solves three problems at once:
//  1. iOS WebKit's CORS-cache bug (cached cross-origin images lose CORS headers,
//     making fetch() fail on second view).
//  2. iOS Safari's 4-6 concurrent connection limit per origin (less relevant
//     for same-origin fetches because they share the page's connection pool).
//  3. R2's r2.dev hostname being a different origin to the website at all.
//
// The function streams the upstream response straight through, so we don't
// buffer the entire file in memory — important for high-res originals.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (!key || !key.startsWith('photos/')) {
    return new NextResponse('Invalid key', { status: 400 });
  }

  // Strip any trailing slash on R2_PUBLIC_URL — easy mistake to make in env vars.
  const rawBase = process.env.R2_PUBLIC_URL;
  if (!rawBase) {
    return new NextResponse('Server misconfigured (R2_PUBLIC_URL missing)', { status: 500 });
  }
  const publicBase = rawBase.replace(/\/+$/, '');

  const upstreamUrl = `${publicBase}/${key}`;

  try {
    // Forward the client's Range header if present — supports video / partial reads.
    const range = req.headers.get('range');
    const upstream = await fetch(upstreamUrl, {
      headers: range ? { Range: range } : undefined,
      // Let the browser / Vercel CDN handle caching via response headers.
      cache: 'no-store',
      signal: req.signal,
    });

    if (!upstream.ok || !upstream.body) {
      return new NextResponse(`Upstream ${upstream.status}`, {
        status: upstream.status === 404 ? 404 : 502,
      });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');
    const acceptRanges = upstream.headers.get('accept-ranges');
    const contentRange = upstream.headers.get('content-range');
    const etag = upstream.headers.get('etag');
    const lastModified = upstream.headers.get('last-modified');

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      // Cache aggressively at Vercel's CDN edge. Each photo's key is unique
      // (timestamp + random suffix in the upload route), so they're immutable.
      // s-maxage = CDN cache (1 year), max-age = browser cache (1 hour).
      'Cache-Control': 'public, s-maxage=31536000, max-age=3600, immutable',
    };
    if (contentLength) headers['Content-Length'] = contentLength;
    if (acceptRanges) headers['Accept-Ranges'] = acceptRanges;
    if (contentRange) headers['Content-Range'] = contentRange;
    if (etag) headers['ETag'] = etag;
    if (lastModified) headers['Last-Modified'] = lastModified;

    // Stream the body straight to the client without buffering.
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    // AbortError = client disconnected, which is normal, not an error.
    if ((err as Error).name === 'AbortError') {
      return new NextResponse(null, { status: 499 });
    }
    console.error('Photo proxy failed for key', key, err);
    return new NextResponse('Proxy fetch failed', { status: 502 });
  }
}
