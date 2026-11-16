import { defineConfig, type Plugin } from 'vite';

// Google Tag Manager (the captain's container; Google Analytics is configured inside it). Only in `vite build`, so dev sends
// nothing; the e2e config sets NO_GTM=1 so its build sends nothing either. An async script: a blocked host leaves the page as is.
const GTM_ID = 'GTM-PFVT9V9G';
const gtm = (): Plugin => ({
  name: 'gtm',
  apply: 'build',
  transformIndexHtml: () =>
    process.env.NO_GTM
      ? []
      : [
          {
            tag: 'script',
            injectTo: 'head-prepend',
            children: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`,
          },
          {
            tag: 'noscript',
            injectTo: 'body-prepend',
            children: `<iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`,
          },
        ],
});

const port = Number(process.env.CLIENT_PORT ?? 5173);
const serverPort = Number(process.env.PORT ?? 8787);
// The game server serves the imported pack at /assets and the relay on WebSocket /ws.
const proxy = {
  '/assets': `http://localhost:${serverPort}`,
  '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
};

export default defineConfig({
  plugins: [gtm()],
  // Not the default `assets`: that path belongs to the game server's pack (proxied above), also under `vite preview`.
  build: { assetsDir: 'bundle' },
  server: { port, strictPort: true, proxy },
  preview: { port, strictPort: true, proxy },
});
