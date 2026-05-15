import { listPhotos } from '@/lib/photos';
import Gallery from '@/components/Gallery';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  const photos = await listPhotos();
  return <Gallery initialPhotos={photos} />;
}
