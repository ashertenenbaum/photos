import { listPosts } from '@/lib/photos';
import Gallery from '@/components/Gallery';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  const posts = await listPosts();
  return <Gallery initialPosts={posts} />;
}
