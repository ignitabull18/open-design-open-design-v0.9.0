import { ClientApp } from './client-app';

// The whole product is a client-driven SPA: project IDs and file paths are
// unbounded user input, so we route every URL through this single optional
// catch-all and let the existing client router (src/router.ts, which reads
// window.location at runtime) decide what to render.
//
// For `output: 'export'` we emit the common top-level shell routes. The daemon
// still serves index.html for unknown non-API paths, while static hosts such as
// Cloudflare Pages can serve direct links without daemon fallback support.
export function generateStaticParams() {
  return [
    { slug: [] },
    { slug: ['onboarding'] },
    { slug: ['projects'] },
    { slug: ['planning'] },
    { slug: ['automations'] },
    { slug: ['tasks'] },
    { slug: ['plugins'] },
    { slug: ['design-systems'] },
    { slug: ['integrations'] },
    { slug: ['marketplace'] },
  ];
}

export default function Page() {
  return <ClientApp />;
}
