import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { deletePhotos, removePhotosFromPost } from '@/lib/photos';

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { keys, postId } = body as { keys?: string[]; postId?: string };

  if (!Array.isArray(keys) || keys.length === 0) {
    return NextResponse.json({ ok: false, error: 'No keys provided' }, { status: 400 });
  }

  // Defensive: only allow deleting things in our photos/ prefix.
  if (!keys.every((k) => typeof k === 'string' && k.startsWith('photos/'))) {
    return NextResponse.json({ ok: false, error: 'Invalid keys' }, { status: 400 });
  }

  try {
    await deletePhotos(keys);
    if (postId && typeof postId === 'string') {
      await removePhotosFromPost(postId, keys);
    }
    return NextResponse.json({ ok: true, deleted: keys.length });
  } catch (err) {
    console.error('Delete failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 }
    );
  }
}
