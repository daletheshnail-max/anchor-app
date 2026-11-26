import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App, { CRISIS, CrisisFallback, ErrorBoundary } from './app.jsx';
import './index.css';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function (e) {
      console.warn('SW register failed', e);
    });
  });
}

function pathOf() {
  const raw = (location.hash || '#/').replace(/^#/, '');
  const q = raw.indexOf('?');
  const path = (q === -1 ? raw : raw.slice(0, q)) || '/';
  const query = q === -1 ? '' : raw.slice(q + 1);
  return { path: path.startsWith('/') ? path : '/' + path, query };
}

function Shell() {
  const [loc, setLoc] = useState(pathOf);
  useEffect(function () {
    const onHash = function () { setLoc(pathOf()); };
    window.addEventListener('hashchange', onHash);
    return function () { window.removeEventListener('hashchange', onHash); };
  }, []);

  if (loc.path === '/terms') return <Terms />;
  if (loc.path === '/privacy') return <Privacy />;
  if (loc.path === '/support') return <Support />;
  if (loc.path === '/app') return <App bootSOS={/(^|&)sos=1(&|$)/.test(loc.query)} />;
  return <Landing />;
}

function Frame({ children }) {
  return (
    <div className="min-h-screen bg-ink text-paper">
      <div className="max-w-md mx-auto px-5 py-8 pb-16 space-y-6">{children}</div>
    </div>
  );
}

function CrisisList() {
  return (
    <div className="space-y-2">
      {CRISIS.map(function (c) {
        return (
          <a key={c.tel + c.label} href={'tel:' + c.tel} className="block bg-panel border border-edge/40 rounded-2xl p-4">
            <div className="font-semibold">{c.label}</div>
            <div className="text-faint text-xs">{c.sub}</div>
            <div className="text-brand text-lg tabnum mt-1">{c.show}</div>
          </a>
        );
      })}
    </div>
  );
}

export function Landing() {
  return (
    <Frame>
      <div>
        <div className="text-4xl mb-2" aria-hidden="true">⚓</div>
        <h1 className="text-3xl font-semibold">The Anchor</h1>
        <p className="text-faint mt-2 leading-relaxed">
          A calm, offline tool for routines, mood, and riding out an urge. It is free to open.
          SOS is never paywalled.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <a href="#/app" className="text-center px-5 py-3 rounded-2xl bg-brand text-ink font-semibold">Open the app</a>
        <a href="#/app?sos=1" className="text-center px-5 py-3 rounded-2xl bg-rose text-ink font-semibold">Open SOS</a>
      </div>
      <section className="bg-panel border border-edge/40 rounded-3xl p-5 space-y-3">
        <h2 className="text-lg font-semibold">Add to Home screen</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-paper/90 leading-relaxed">
          <li>On Android, open this site in Chrome, tap the menu, then choose <b>Add to Home screen</b> or Install app.</li>
          <li>On iPhone, open this site in Safari, tap Share, then <b>Add to Home Screen</b>.</li>
          <li>On desktop Chrome, use the install icon in the address bar.</li>
        </ol>
        <p className="text-faint text-sm leading-relaxed">
          After you install it, Anchor opens like an app and keeps working offline. Your logs stay in this browser.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">If you need a person right now</h2>
        <p className="text-faint text-sm">These lines are free to tap. In an emergency, call 112.</p>
        <CrisisList />
      </section>
      <button
        type="button"
        onClick={function () { location.hash = '#/support'; }}
        className="w-full px-5 py-3 rounded-2xl bg-panel2 border border-edge text-paper font-semibold"
      >
        Support The Anchor
      </button>
      <nav className="flex gap-4 text-sm">
        <a href="#/terms" className="text-brand underline">Terms</a>
        <a href="#/privacy" className="text-brand underline">Privacy</a>
      </nav>
    </Frame>
  );
}

function BackHome() {
  return <a href="#/" className="text-faint text-sm">‹ Back</a>;
}

export function Terms() {
  return (
    <Frame>
      <BackHome />
      <h1 className="text-3xl font-semibold">Terms</h1>
      <div className="space-y-3 text-sm leading-relaxed text-paper/90">
        <p>The Anchor is a personal support tool. It is not a medical device, not therapy, and not a crisis service.</p>
        <p>Nothing in the app diagnoses, treats, or monitors a condition. You use it at your own discretion.</p>
        <p>In an emergency, call 112. For the SADAG 24-hour suicide crisis line call 0800 567 567.</p>
        <p>SOS, the urge tools, and the crisis numbers are free. They are not locked behind payment.</p>
      </div>
    </Frame>
  );
}

export function Privacy() {
  return (
    <Frame>
      <BackHome />
      <h1 className="text-3xl font-semibold">Privacy</h1>
      <div className="space-y-3 text-sm leading-relaxed text-paper/90">
        <p>Your logs, mood check-ins, and recovery notes stay in localStorage on this device. The app does not upload them.</p>
        <p>A service worker stores the app shell so it can open offline. That cache is the program, not your journal.</p>
        <p>The optional Agent OS connection is off unless you turn it on in Settings and set your own address.</p>
        <p>The Anchor is not a medical device. In an emergency, call 112.</p>
      </div>
    </Frame>
  );
}

export function Support() {
  return (
    <Frame>
      <BackHome />
      <h1 className="text-3xl font-semibold">Support The Anchor</h1>
      <div className="bg-panel border border-edge/40 rounded-3xl p-5 space-y-3">
        <p className="text-sm leading-relaxed">
          This is a placeholder. No payment is connected, and nothing here can charge you.
        </p>
        <p className="text-faint text-sm leading-relaxed">
          SOS stays free. If you need help right now, call 112 or open SOS — you do not need to support the project to use it.
        </p>
        <a href="#/app?sos=1" className="block text-center px-5 py-3 rounded-2xl bg-rose text-ink font-semibold">Open SOS</a>
      </div>
    </Frame>
  );
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary fallback={<CrisisFallback />}>
    <Shell />
  </ErrorBoundary>
);
