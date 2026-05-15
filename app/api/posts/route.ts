import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { listPosts, createPost, addPhotoToPost, reorderPostPhotos } from '@/lib/photos';

export const runtime = 'nodejs';

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }
  const posts = await listPosts();
  return NextResponse.json({ ok: true, posts });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });

  if (body.action === 'create') {
    if (typeof body.date !== 'string' || !body.date.trim()) {
      return NextResponse.json({ ok: false, error: 'date required' }, { status: 400 });
    }
    try {
      const post = await createPost(body.date.trim());
      return NextResponse.json({ ok: true, post });
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
    }
  }

  if (body.action === 'addPhoto') {
    if (typeof body.postId !== 'string' || typeof body.key !== 'string') {
      return NextResponse.json({ ok: false, error: 'postId and key required' }, { status: 400 });
    }
    try {
      await addPhotoToPost(body.postId, {
        key: body.key,
        size: typeof body.size === 'number' ? body.size : 0,
        uploadedAt: typeof body.uploadedAt === 'string' ? body.uploadedAt : new Date().toISOString(),
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
    }
  }

  if (body.action === 'reorder') {
    if (typeof body.postId !== 'string' || !Array.isArray(body.photoKeys)) {
      return NextResponse.json({ ok: false, error: 'postId and photoKeys required' }, { status: 400 });
    }
    try {
      await reorderPostPhotos(body.postId, body.photoKeys as string[]);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
}
