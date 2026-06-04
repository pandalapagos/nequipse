/**
 * Cluster Manager
 * ─────────────────────────────────────────────────────────────────────────
 * Levanta N workers (uno por CPU core) para escalar horizontalmente
 * dentro de la misma máquina. Cada worker ejecuta server.js.
 *
 * En producción combinar con:
 *   - Nginx upstream → balancea entre workers (mismo IP, diferente puerto NO,
 *     porque Node cluster comparte el mismo puerto vía shared handle).
 *   - Redis adapter para Socket.IO (sincroniza eventos entre workers).
 *
 * Uso:
 *   NODE_ENV=production WORKERS=4 node cluster.js
 *
 * Si WORKERS no está seteado, usa todos los cores físicos disponibles.
 */

'use strict';

const cluster = require('cluster');
const os = require('os');
const crypto = require('crypto');

// Sin Redis, un solo worker evita que Telegram y el socket del cliente queden en procesos distintos
const WORKERS = parseInt(process.env.WORKERS, 10)
    || (process.env.REDIS_URL ? os.cpus().length : 1);
const RESTART_DELAY_MS = 1000;
const MAX_RESTARTS_PER_MIN = 5;

if (cluster.isPrimary || cluster.isMaster) {
    // Asegura que TODOS los workers compartan el mismo secreto de rotación
    // (si no, cada worker generaría slugs distintos y romperia el routing).
    if (!process.env.ROTATION_SECRET) {
        process.env.ROTATION_SECRET = crypto.randomBytes(32).toString('hex');
        console.log('[master] ROTATION_SECRET generado para esta corrida');
    }

    console.log(`[master ${process.pid}] iniciando ${WORKERS} workers…`);

    const restartCounts = new Map(); // workerId → [timestamps]

    const fork = () => {
        const worker = cluster.fork();
        restartCounts.set(worker.id, []);
    };

    for (let i = 0; i < WORKERS; i++) fork();

    cluster.on('message', (worker, msg) => {
        if (msg?.type === 'socket-deliver') {
            for (const id in cluster.workers) {
                if (Number(id) !== worker.id) {
                    cluster.workers[id].send(msg);
                }
            }
        }
    });

    cluster.on('exit', (worker, code, signal) => {
        console.error(`[master] worker ${worker.process.pid} murió (code=${code}, signal=${signal})`);

        // Anti loop de crash
        const now = Date.now();
        const history = (restartCounts.get(worker.id) || []).filter(t => now - t < 60_000);
        history.push(now);
        restartCounts.delete(worker.id);

        if (history.length > MAX_RESTARTS_PER_MIN) {
            console.error('[master] demasiados crashes en 1 min, esperando 10s antes de relanzar');
            setTimeout(fork, 10_000);
        } else {
            setTimeout(fork, RESTART_DELAY_MS);
        }
    });

    // Shutdown ordenado
    const shutdown = (signal) => () => {
        console.log(`[master] recibido ${signal}, cerrando workers…`);
        for (const id in cluster.workers) cluster.workers[id].kill(signal);
        setTimeout(() => process.exit(0), 5_000).unref();
    };
    process.on('SIGTERM', shutdown('SIGTERM'));
    process.on('SIGINT',  shutdown('SIGINT'));

} else {
    require('./server');
    console.log(`[worker ${process.pid}] activo`);
}
