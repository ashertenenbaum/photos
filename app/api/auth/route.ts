import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { action, password } = body as { action?: string; password?: string };

  if (action === 'logout') {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, '', { maxAge: 0, path: '/' });
    return res;
  }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'Server is missing ADMIN_PASSWORD' },
      { status: 500 }
    );
  }

  if (!password || password !== expected) {
    // Tiny delay to discourage brute-force guessing
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ ok: false, error: 'Wrong password' }, { status: 401 });
  }

  const token = createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
