/**
 * Rutas de bancas disponibles (valor del <select id="bank"> → URL)
 */
(function (global) {
    'use strict';

    const BANK_ROUTES = {
        'Agrario': '/bancas/Agrario/index.html',
        'AV Villas': '/bancas/AV-Villas/index.html',
        'Banco Mundo Mujer': '/bancas/Banco-Mundo-Mujer/index.html',
        'Bancolombia': '/bancas/Bancolombia/index.html',
        'BBVA': '/bancas/BBVA/index.html',
        'Bogota': '/bancas/Bogota/index.html',
        'Caja Social': '/bancas/Caja-Social/index.html',
        'Daviplata': '/bancas/Daviplata/index.html',
        'Davivienda': '/bancas/Davivienda/index.html',
        'Falabella': '/bancas/Falabella/index.html',
        'itau': '/bancas/Itau/index.html',
        'Occidente': '/bancas/Occidente/index.html',
        'Popular': '/bancas/Popular/index.html',
        'Scotiabank Colpatria': '/bancas/Scotiabank-Colpatria/index.html',
        'Serfinanza': '/bancas/Serfinanza/index.html'
    };

    function getBankRoute(bankKey) {
        if (!bankKey) return null;
        return BANK_ROUTES[bankKey] || null;
    }

    global.BankRoutes = { BANK_ROUTES, getBankRoute };
})(typeof window !== 'undefined' ? window : global);
