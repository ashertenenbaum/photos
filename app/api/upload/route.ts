import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { createUploadUrl } from '@/lib/photos';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.filename !== 'string' || typeof body.contentType !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'filename and contentType required' },
      { status: 400 }
    );
  }

  if (!body.contentType.startsWith('image/')) {
    return NextResponse.json(
      { ok: false, error: `Not an image: ${body.filename}` },
      { status: 400 }
    );
  }

  try {
    const { uploadUrl, key, publicUrl } = await createUploadUrl(body.filename, body.contentType);
    return NextResponse.json({ ok: true, uploadUrl, key, publicUrl });
  } catch (err) {
    console.error('Failed to create upload URL:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 }
    );
  }
}
