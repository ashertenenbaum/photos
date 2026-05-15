import { isAuthenticated } from '@/lib/auth';
import { listPosts } from '@/lib/photos';
import AdminLogin from '@/components/AdminLogin';
import AdminPanel from '@/components/AdminPanel';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminPage() {
  const authed = await isAuthenticated();
  if (!authed) {
    return <AdminLogin />;
  }
  const posts = await listPosts();
  return <AdminPanel initialPosts={posts} />;
}
