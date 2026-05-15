import { NextResponse } from 'next/server';
import { listPhotos } from '@/lib/photos';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const photos = await listPhotos();
  return NextResponse.json({ photos });
}
