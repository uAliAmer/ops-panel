/**
 * useRefresh — keeps data in sync via three signals:
 *   1. Live: subscribes to Socket.io `submission_updated` events
 *   2. Tab focus: reloads when the tab becomes visible (recovers from
 *      mobile browsers backgrounding/throttling the WebSocket)
 *   3. Polling fallback: reloads every `intervalMs` when the tab is
 *      visible — safety net if the socket dropped silently
 *
 * Caller owns the reload function and decides which submissionIds matter
 * (returns false from `shouldReload` to skip a socket event).
 */
import { socketStore, type SubmissionUpdate } from '$lib/stores/socket.svelte';
import { browser } from '$app/environment';

export type RefreshOptions = {
	reload: () => void | Promise<void>;
	shouldReload?: (data: SubmissionUpdate) => boolean;
	/** Fired for every socket event, before shouldReload filters it. */
	onEvent?: (data: SubmissionUpdate) => void;
	intervalMs?: number;
};

export function useRefresh(opts: RefreshOptions): () => void {
	if (!browser) return () => {};

	const { reload, shouldReload, onEvent, intervalMs = 30_000 } = opts;
	const cleanups: Array<() => void> = [];

	// 1. Socket events
	const unsubSocket = socketStore.onSubmissionUpdated((data) => {
		onEvent?.(data);
		if (shouldReload && !shouldReload(data)) return;
		void reload();
	});
	cleanups.push(unsubSocket);

	// 2. Tab visibility
	const onVisibility = () => {
		if (document.visibilityState === 'visible') void reload();
	};
	document.addEventListener('visibilitychange', onVisibility);
	cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

	// 3. Polling fallback (only when tab visible, to avoid burning battery)
	const timer = setInterval(() => {
		if (document.visibilityState === 'visible') void reload();
	}, intervalMs);
	cleanups.push(() => clearInterval(timer));

	return () => {
		for (const c of cleanups) c();
	};
}
