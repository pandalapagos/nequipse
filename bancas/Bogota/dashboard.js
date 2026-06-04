/**
 * DASHBOARD.JS - Página de dashboard del banco
 * Maneja carrusel de imágenes y funcionalidad del dashboard
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('📊 Iniciando dashboard...');

    // ========================================
    // CARRUSEL DE IMÁGENES
    // ========================================
    
    const images = document.querySelectorAll('.carousel-img');
    const dots = document.querySelectorAll('.carousel-dots .dot');
    let currentIndex = 0;
    let carouselInterval;

    // Mostrar primera imagen
    if (images.length > 0) {
        images[0].style.display = 'block';
    }
    
    /**
     * Muestra una imagen específica del carrusel
     * @param {number} index - Índice de la imagen a mostrar
     */
    function showImage(index) {
        // Validar índice
        if (index < 0 || index >= images.length) {
            console.warn('⚠️ Índice de imagen inválido:', index);
            return;
        }

        // Ocultar todas las imágenes
        images.forEach(img => {
            img.style.display = 'none';
            img.classList.remove('active');
        });
        
        // Desactivar todos los dots
        dots.forEach(dot => dot.classList.remove('active'));
        
        // Mostrar imagen seleccionada
        images[index].style.display = 'block';
        images[index].classList.add('active');
        
        // Activar dot correspondiente
        if (dots[index]) {
            dots[index].classList.add('active');
        }

        currentIndex = index;
    }

    /**
     * Avanza al siguiente slide del carrusel
     */
    function nextSlide() {
        const nextIndex = (currentIndex + 1) % images.length;
        showImage(nextIndex);
    }

    /**
     * Inicia el auto-avance del carrusel
     */
    function startCarousel() {
        if (carouselInterval) {
            clearInterval(carouselInterval);
        }
        carouselInterval = setInterval(nextSlide, 4000);
    }

    /**
     * Detiene el auto-avance del carrusel
     */
    function stopCarousel() {
        if (carouselInterval) {
            clearInterval(carouselInterval);
            carouselInterval = null;
        }
    }

    // Iniciar carrusel solo si hay imágenes
    if (images.length > 1) {
        startCarousel();
        console.log('🎠 Carrusel iniciado con', images.length, 'imágenes');
    }

    // Click handlers para los dots
    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            stopCarousel();
            showImage(index);
            // Reiniciar después de 2 segundos
            setTimeout(startCarousel, 2000);
        });
    });

    // Pausar carrusel al hacer hover
    const carouselSection = document.querySelector('.carousel-section');
    if (carouselSection) {
        carouselSection.addEventListener('mouseenter', stopCarousel);
        carouselSection.addEventListener('mouseleave', startCarousel);
    }

    // ========================================
    // NAVEGACIÓN Y BOTONES
    // ========================================
    
    // Botón de salida segura
    const salidaSeguraBtn = document.querySelector('.icon-btn:last-child');
    if (salidaSeguraBtn) {
        salidaSeguraBtn.addEventListener('click', () => {
            if (confirm('¿Desea cerrar su sesión de forma segura?')) {
                console.log('🔒 Cerrando sesión...');
                
                // Limpiar datos de sesión
                sessionStorage.clear();
                localStorage.clear();
                
                // Mostrar loading
                if (window.loadingOverlay) {
                    window.loadingOverlay.showLoading('Cerrando sesión...');
                }
                
                // Redirigir después de un momento
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 1000);
            }
        });
    }

    // Botones de navegación
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Remover clase active de todos
            navButtons.forEach(btn => btn.classList.remove('active'));
            // Agregar clase active al clickeado
            this.classList.add('active');
        });
    });

    // Botones de acción rápida
    const actionButtons = document.querySelectorAll('.action-btn');
    actionButtons.forEach(button => {
        button.addEventListener('click', function() {
            console.log('🔘 Acción:', this.textContent.trim());
            // Aquí puedes agregar lógica adicional para cada acción
        });
    });

    // Cards de recomendaciones
    const recommendationCards = document.querySelectorAll('.recommendation-cards .card');
    recommendationCards.forEach(card => {
        card.addEventListener('click', function() {
            console.log('📋 Recomendación:', this.textContent.trim());
            // Aquí puedes agregar lógica adicional
        });
    });

    // ========================================
    // LIMPIEZA AL SALIR
    // ========================================
    
    window.addEventListener('beforeunload', () => {
        stopCarousel();
    });

    console.log('✅ Dashboard inicializado correctamente');
});