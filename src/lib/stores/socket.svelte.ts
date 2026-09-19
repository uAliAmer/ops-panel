/**
 * Socket.io connection wrapper as a Svelte 5 reactive store.
 * Connects to the backend on `connect()`, exposes `connected` flag,
 * and dispatches `submission_updated` events to subscribers.
 */
import { io, type Socket } from 'socket.io-client';
import { api, pathPrefix } from '$lib/api';
import { DEMO } from '$lib/config';

/**
 * `carrierTrouble` carries the carrier's status name when a parcel has just
 * ENTERED a failed-delivery state — the edge, not the state, so it appears on
 * one event and not on every poll while the parcel stays stuck.
 */
export type SubmissionUpdate = {
	submissionId: string;
	status?: string;
	carrierTrouble?: string;
};

/** Fired once by the backend's reminderNotifier when a reminder's dueAt passes. */
export type ReminderDue = {
	id: string;
	message: string;
	dueAt: string;
	createdById: string;
	assignedToId: string | null;
	submissionId: string | null;
};

/** A chat message as it arrives over the socket — same shape the REST API returns. */
export type ChatEvent = {
	id: string;
	conversationId: string;
	authorId: string;
	body: string | null;
	createdAt: string;
	editedAt?: string | null;
	author: { id: string; name: string; email: string; role: string };
	mentions: { userId: string }[];
};

/** Nudge to a member who is not currently watching the conversation. */
export type ChatUnread = {
	conversationId: string;
	messageId: string;
	mentioned: boolean;
	/** Enough to draw a preview card without fetching the message back. */
	kind?: 'ROOM' | 'DM' | 'ORDER';
	author?: string;
	body?: string;
	orderRef?: string | null;
};

type Listener = (payload: SubmissionUpdate) => void;
type ReminderListener = (payload: ReminderDue) => void;
type ChatListener = (payload: ChatEvent) => void;
type ChatDeleteListener = (payload: { id: string }) => void;
type ChatUnreadListener = (payload: ChatUnread) => void;
type ChatTypingListener = (payload: { conversationId: string; userId: string }) => void;
type ChatPrunedListener = (payload: { conversationId: string; by?: string; expired?: boolean }) => void;
/** messageId null = the pin was released and this conversation now has none. */
type ChatPinnedListener = (payload: {
	conversationId: string;
	messageId: string | null;
	message: ChatEvent | null;
}) => void;
type ChatReadByListener = (payload: {
	conversationId: string;
	userId: string;
	readAt: string;
}) => void;

function createSocketStore() {
	let socket: Socket | null = null;
	let connected = $state(false);
	const listeners = new Set<Listener>();
	const reminderListeners = new Set<ReminderListener>();
	const chatListeners = new Set<ChatListener>();
	const chatEditListeners = new Set<ChatListener>();
	const chatDeleteListeners = new Set<ChatDeleteListener>();
	const chatUnreadListeners = new Set<ChatUnreadListener>();
	const chatTypingListeners = new Set<ChatTypingListener>();
	const chatReadByListeners = new Set<ChatReadByListener>();
	const chatPrunedListeners = new Set<ChatPrunedListener>();
	const chatPinnedListeners = new Set<ChatPinnedListener>();
	// Conversations this tab has asked to follow. Re-sent on every connect: the
	// server's room membership dies with the socket, and this transport
	// reconnects often on Iraqi mobile data.
	const joined = new Set<string>();

	return {
		get connected() {
			return connected;
		},

		connect() {
			if (socket) return;
			// Demo mode has no server to talk to. Staying disconnected is correct
			// rather than degraded: live updates are the one thing a fixture set
			// cannot honestly fake.
			if (DEMO) return;
			socket = io(window.location.origin, {
				path: pathPrefix() + '/socket.io',
				// Identifies this connection to the backend, which puts it in
				// `user:<id>` — the room private traffic is addressed to. Read
				// through a function so a reconnect after a token refresh sends
				// the CURRENT token rather than the one captured at first
				// connect. No token (or an expired one) still connects: the
				// backend keeps the socket anonymous rather than dropping it,
				// and anonymous simply receives no private rooms.
				auth: (cb: (data: { token: string | null }) => void) =>
					cb({ token: api.getToken() }),
				// Polling only: the edge nginx serves confirm.gstar1959.com over HTTP/2,
				// which strips the WebSocket Upgrade headers (illegal in h2) → the ws
				// transport 400s. Long-polling is realtime enough and avoids the
				// browser logging a failed wss attempt on every reconnect.
				transports: ['polling'],
				upgrade: false,
				reconnection: true,
				reconnectionAttempts: Infinity,
				reconnectionDelay: 1000,
				reconnectionDelayMax: 5000,
				timeout: 20000
			});
			socket.on('connect', () => {
				connected = true;
				for (const id of joined) socket?.emit('chat:join', id);
			});
			socket.on('disconnect', () => {
				connected = false;
			});
			socket.on('submission_updated', (data: SubmissionUpdate) => {
				for (const l of listeners) l(data);
			});
			socket.on('reminder_due', (data: ReminderDue) => {
				for (const l of reminderListeners) l(data);
			});
			socket.on('chat:message', (data: ChatEvent) => {
				for (const l of chatListeners) l(data);
			});
			socket.on('chat:edited', (data: ChatEvent) => {
				for (const l of chatEditListeners) l(data);
			});
			socket.on('chat:deleted', (data: { id: string }) => {
				for (const l of chatDeleteListeners) l(data);
			});
			socket.on('chat:unread', (data: ChatUnread) => {
				for (const l of chatUnreadListeners) l(data);
			});
			socket.on('chat:typing', (data: { conversationId: string; userId: string }) => {
				for (const l of chatTypingListeners) l(data);
			});
			socket.on(
				'chat:pinned',
				(data: { conversationId: string; messageId: string | null; message: ChatEvent | null }) => {
					for (const l of chatPinnedListeners) l(data);
				}
			);
			socket.on('chat:pruned', (data: { conversationId: string; by?: string; expired?: boolean }) => {
				for (const l of chatPrunedListeners) l(data);
			});
			socket.on(
				'chat:read-by',
				(data: { conversationId: string; userId: string; readAt: string }) => {
					for (const l of chatReadByListeners) l(data);
				}
			);
		},

		disconnect() {
			socket?.disconnect();
			socket = null;
			connected = false;
		},

		/**
		 * Re-handshake with the current token. Called after login and logout:
		 * the identity is fixed at handshake time, so a socket opened before a
		 * login stays anonymous — and one left open after a logout would stay
		 * in that user's room until the tab closed.
		 */
		reauth() {
			if (!socket) return;
			socket.disconnect();
			socket.connect();
		},

		onSubmissionUpdated(listener: Listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		onReminderDue(listener: ReminderListener) {
			reminderListeners.add(listener);
			return () => reminderListeners.delete(listener);
		},

		/**
		 * Follow one conversation. The server checks membership before putting
		 * this socket in the room, so asking for a conversation you are not in
		 * is simply ignored rather than refused.
		 */
		joinConversation(conversationId: string) {
			joined.add(conversationId);
			socket?.emit('chat:join', conversationId);
		},

		leaveConversation(conversationId: string) {
			joined.delete(conversationId);
			socket?.emit('chat:leave', conversationId);
		},

		onChatMessage(listener: ChatListener) {
			chatListeners.add(listener);
			return () => chatListeners.delete(listener);
		},

		onChatEdited(listener: ChatListener) {
			chatEditListeners.add(listener);
			return () => chatEditListeners.delete(listener);
		},

		onChatDeleted(listener: ChatDeleteListener) {
			chatDeleteListeners.add(listener);
			return () => chatDeleteListeners.delete(listener);
		},

		onChatUnread(listener: ChatUnreadListener) {
			chatUnreadListeners.add(listener);
			return () => chatUnreadListeners.delete(listener);
		},

		onChatTyping(listener: ChatTypingListener) {
			chatTypingListeners.add(listener);
			return () => chatTypingListeners.delete(listener);
		},

		onChatPruned(listener: ChatPrunedListener) {
			chatPrunedListeners.add(listener);
			return () => chatPrunedListeners.delete(listener);
		},

		onChatPinned(listener: ChatPinnedListener) {
			chatPinnedListeners.add(listener);
			return () => chatPinnedListeners.delete(listener);
		},

		onChatReadBy(listener: ChatReadByListener) {
			chatReadByListeners.add(listener);
			return () => chatReadByListeners.delete(listener);
		},

		/** Tell the others in this conversation that I am typing. Fire and forget. */
		emitTyping(conversationId: string) {
			socket?.emit('chat:typing', conversationId);
		}
	};
}

export const socketStore = createSocketStore();
