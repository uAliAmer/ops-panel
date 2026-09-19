/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, version, base } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `ops-cache-${version}`;
const SHELL = `${base}/`; // SPA entry, used as the offline navigation fallback

// App shell: hashed build output + static files (icons, sounds, manifest…) + entry
const PRECACHE = [...build, ...files, SHELL];

// Only content-hashed / immutable assets are safe to serve cache-first. The
// shell HTML (SHELL) is deliberately NOT here — it must be network-first so a
// reload picks up the new chunk references after a deploy. Serving the shell
// cache-first was why updates only appeared after a hard refresh.
const IMMUTABLE = new Set<string>([...build, ...files]);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

// Let the page tell a waiting SW to activate immediately (UpdatePrompt).
sw.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	// Never intercept live data — the API and socket.io must always hit the network.
	// Matches both mounts: /api + /socket.io and /ops/api + /ops/socket.io.
	if (/\/(api|socket\.io)(\/|$)/.test(url.pathname)) return;

	// SPA navigations: network-first so a deploy is picked up on reload; fall
	// back to the cached shell only when offline. Checked BEFORE the immutable
	// branch so the shell HTML is never served stale from cache.
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(async () => {
				const cache = await caches.open(CACHE);
				return (await cache.match(SHELL)) ?? Response.error();
			})
		);
		return;
	}

	// Cache-first for immutable, content-hashed assets (build chunks, icons…).
	if (IMMUTABLE.has(url.pathname)) {
		event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
	}
});

// ── Web Push ───────────────────────────────────────────────────────────────
// See docs/OPS_CHAT_PLAN.md phase 6. The socket only reaches a panel that is
// open and awake; a backgrounded mobile tab is suspended within seconds, so
// this is the only path that reaches a phone in a pocket.

type PushPayload = {
	title?: string;
	body?: string;
	conversationId?: string;
	messageId?: string;
	kind?: 'ROOM' | 'DM' | 'ORDER';
	mentioned?: boolean;
};

/**
 * Where a tap lands. The chat panel is a header control rather than a route, so
 * the conversation travels as a query parameter that ChatChip reads on mount —
 * and, for a tab that is already open, as a postMessage, which opens the panel
 * without reloading the page out from under whatever the operator was doing.
 */
const chatUrl = (conversationId?: string) =>
	`${base}/${conversationId ? `?chat=${encodeURIComponent(conversationId)}` : ''}`;

sw.addEventListener('push', (event) => {
	if (!event.data) return;
	let payload: PushPayload;
	try {
		payload = event.data.json() as PushPayload;
	} catch {
		return; // not ours, or malformed — never show a blank notification
	}

	const options = {
		body: payload.body ?? '',
		icon: `${base}/icons/icon-192.png`,
		badge: `${base}/icons/favicon-48.png`,
		// One line per conversation, replaced as the conversation goes on: a
		// back-and-forth of fifteen messages must not become fifteen entries in
		// the shade. renotify makes the replacement still buzz.
		tag: payload.conversationId ?? 'chat',
		renotify: true,
		dir: 'rtl' as const,
		lang: 'ar',
		// A mention is addressed to one person and is allowed to be insistent.
		vibrate: payload.mentioned ? [40, 60, 40, 60, 80] : [30],
		data: { conversationId: payload.conversationId, url: chatUrl(payload.conversationId) }
	} as NotificationOptions;

	event.waitUntil(sw.registration.showNotification(payload.title || 'رسالة جديدة', options));
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const data = (event.notification.data ?? {}) as { conversationId?: string; url?: string };

	event.waitUntil(
		(async () => {
			const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			// An already-open panel is focused and told what to open. Reloading it
			// would throw away whatever the operator had on screen — half a packing
			// run, a form mid-edit — to show a message they could have had in place.
			for (const client of clients) {
				if (new URL(client.url).origin !== sw.location.origin) continue;
				await client.focus();
				client.postMessage({ type: 'chat:open', conversationId: data.conversationId });
				return;
			}
			await sw.clients.openWindow(data.url ?? chatUrl(data.conversationId));
		})()
	);
});
