/**
 * Entrega fiable de acciones Telegram: deduplica por _deliveryId,
 * confirma al servidor (actionAck) y hace polling HTTP de respaldo.
 */
(function () {
    'use strict';

    const processed = new Set();
    const POLL_MS = 2000;

    function ack(socket, sessionId, deliveryId) {
        if (!deliveryId || !socket?.connected) return;
        socket.emit('actionAck', { sessionId, deliveryId });
    }

    function dispatch(socket, sessionId, event, data, handler) {
        if (data?.sessionId && data.sessionId !== sessionId) return;
        const deliveryId = data?._deliveryId;
        if (deliveryId) {
            if (processed.has(deliveryId)) return;
            processed.add(deliveryId);
            ack(socket, sessionId, deliveryId);
        }
        handler(data);
    }

    function setupSessionDelivery(socket, sessionId, eventHandlers) {
        if (!socket || !sessionId || !eventHandlers) return { stopPolling: () => {} };

        const wrapped = {};
        for (const [event, handler] of Object.entries(eventHandlers)) {
            wrapped[event] = (data) => dispatch(socket, sessionId, event, data, handler);
            socket.on(event, wrapped[event]);
        }

        let pollTimer = null;

        async function pollPending() {
            try {
                const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}/pending`, {
                    credentials: 'same-origin',
                    cache: 'no-store'
                });
                if (!res.ok) return;
                const body = await res.json();
                if (!Array.isArray(body.actions)) return;
                for (const { event, payload } of body.actions) {
                    const handler = eventHandlers[event];
                    if (handler) dispatch(socket, sessionId, event, payload, handler);
                }
            } catch (_) { /* red intermitente */ }
        }

        function startPolling() {
            if (pollTimer) return;
            pollTimer = setInterval(pollPending, POLL_MS);
            pollPending();
        }

        function stopPolling() {
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = null;
        }

        socket.on('connect', startPolling);
        if (socket.connected) startPolling();

        return { stopPolling };
    }

    window.SessionDelivery = { setupSessionDelivery, ack };
})();
