# Photos

A minimal photo gallery website with a hidden admin panel. Photos are stored on Cloudflare R2 (10 GB free, zero bandwidth fees) and served through a same-origin proxy on Vercel for maximum reliability on iOS and mobile browsers.

## Features

- Clean white aesthetic, responsive grid, mobile-first
- Click any photo for fullscreen lightbox — keyboard arrows, swipe on mobile
- **Save all to Photos** (mobile) or **Download all** (desktop) — works reliably for 50+ photos
- Long-press a photo on iPhone for native "Save to Photos" / "Share"
- Hidden admin route at `/admin` — no link from the public site
- Bulk drag-and-drop upload at **original full quality**, multi-select, bulk delete
- All photo serving cached at Vercel's CDN edge

## Why a proxy

Photos are stored on Cloudflare R2, but served through `/api/photo` on your Vercel site. This makes them appear same-origin to the browser, which:

- Fixes iOS Safari's CORS-cache bug (cached cross-origin images lose CORS headers, breaking JS fetches)
- Avoids cross-origin connection throttling
- Works with the iOS Web Share API for "Save all to Photos"

There's no performance penalty — Vercel streams the response straight from R2 without buffering, and after the first request each photo is cached at Vercel's CDN edge.

## Deploy

This is a two-part setup: Cloudflare R2 for storage, Vercel for the website.

### Part 1: Cloudflare R2

1. **Sign up** at <https://dash.cloudflare.com/sign-up> (free, no card needed for free tier)
2. **R2 Object Storage** in the sidebar → accept free plan if prompted
3. **Create bucket**, name it `photos` (lowercase)
4. Inside the bucket → **Settings** tab → **Public Development URL** → **Enable**. Copy the `pub-xxxxx.r2.dev` URL.
5. Still in **Settings** → **CORS Policy** → **Add CORS policy** → paste:
   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   Save. (The proxy uses server-to-server fetches that don't need CORS, but the admin upload still does — keeps both paths working.)
6. Back to R2 main page → **Manage R2 API Tokens** → **Create API token** → name `photo-gallery`, permission **Object Read & Write**, **specific bucket** = your `photos`, TTL **Forever** → Create.
7. **Copy these 3 values** now (only shown once):
   - Access Key ID
   - Secret Access Key
   - Your Account ID (shown on the R2 main page sidebar)

### Part 2: Vercel

1. **Push to GitHub**:
   ```bash
   git init && git add . && git commit -m "Initial"
   git branch -M main
   git remote add origin https://github.com/YOU/YOUR_REPO.git
   git push -u origin main
   ```
2. **Import to Vercel** at <https://vercel.com/new> — leave settings as default but don't deploy yet
3. **Settings → Environment Variables**, add all 6 (apply to Production, Preview, Development):

   | Name                   | Value                                       |
   | ---------------------- | ------------------------------------------- |
   | `ADMIN_PASSWORD`       | A strong password                           |
   | `R2_ACCOUNT_ID`        | From step 7                                 |
   | `R2_ACCESS_KEY_ID`     | From step 7                                 |
   | `R2_SECRET_ACCESS_KEY` | From step 7                                 |
   | `R2_BUCKET_NAME`       | `photos`                                    |
   | `R2_PUBLIC_URL`        | The `pub-xxxxx.r2.dev` URL (no trailing /)  |

4. **Deploy**.
5. Go to `https://your-site.vercel.app/admin` to sign in and upload.

## Local development

```bash
npm install
cp .env.example .env.local
# Fill in .env.local
npm run dev
```

## Costs

R2 free tier: 10 GB storage, **zero egress** (no bandwidth charges, ever). Vercel Hobby covers website hosting. For a personal photographer site, the entire setup is free.

## Keyboard shortcuts

- `S` — save all (when not in lightbox)
- `←` / `→` — previous / next (in lightbox)
- `Esc` — close lightbox

## File structure

```
app/
  page.tsx               # public gallery
  admin/page.tsx         # admin (password-gated)
  api/
    photos/route.ts      # list photos (public)
    photo/route.ts       # same-origin proxy for serving each photo
    auth/route.ts        # login / logout
    upload/route.ts      # generates a presigned R2 upload URL
    delete/route.ts      # bulk delete (auth required)
components/
  Gallery.tsx            # grid + save-all
  Lightbox.tsx           # slideshow / save / swipe
  AdminLogin.tsx
  AdminPanel.tsx         # dropzone + multi-select + delete
lib/
  auth.ts                # signed-cookie session
  photos.ts              # R2 wrapper, proxy URL builder
```
