import { cookies } from 'next/headers';
import crypto from 'crypto';

const COOKIE_NAME = 'gallery_admin';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  // Use the admin password itself as the signing secret so we don't need a separate env var
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error('ADMIN_PASSWORD env var is not set');
  }
  return secret;
}

function sign(value: string): string {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
}

export function createSessionToken(): string {
  const issued = Date.now().toString();
  const signature = sign(issued);
  return `${issued}.${signature}`;
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const [issued, signature] = token.split('.');
  if (!issued || !signature) return false;

  // Check signature
  let expected: string;
  try {
    expected = sign(issued);
  } catch {
    return false;
  }
  if (signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;

  // Check age
  const age = (Date.now() - parseInt(issued, 10)) / 1000;
  if (age > MAX_AGE) return false;

  return true;
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return isValidSession(token);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_MAX_AGE = MAX_AGE;
