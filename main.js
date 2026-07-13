document.addEventListener('DOMContentLoaded', () => {

    // Mobile menu toggle
    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.nav');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            nav.classList.toggle('open');
            menuToggle.classList.toggle('active');
        });
        nav.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                nav.classList.remove('open');
                menuToggle.classList.remove('active');
            });
        });
    }

    // No JS-based scroll reveal — content is always visible for reliability

    // Lightbox
    const lightbox = document.getElementById('lightbox');
    if (lightbox) {
        const lightboxImg = lightbox.querySelector('.lightbox-img');
        const closeBtn = lightbox.querySelector('.lightbox-close');
        const prevBtn = lightbox.querySelector('.lightbox-prev');
        const nextBtn = lightbox.querySelector('.lightbox-next');
        const photoItems = document.querySelectorAll('.photo-item');
        let currentIndex = 0;

        function openLightbox(index) {
            currentIndex = index;
            const img = photoItems[index].querySelector('img');
            lightboxImg.src = img.src;
            lightboxImg.alt = img.alt;
            lightbox.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function closeLightbox() {
            lightbox.classList.remove('active');
            document.body.style.overflow = '';
        }

        function navigate(dir) {
            currentIndex = (currentIndex + dir + photoItems.length) % photoItems.length;
            const img = photoItems[currentIndex].querySelector('img');
            lightboxImg.src = img.src;
            lightboxImg.alt = img.alt;
        }

        photoItems.forEach((item, i) => {
            item.addEventListener('click', () => openLightbox(i));
        });

        closeBtn.addEventListener('click', closeLightbox);
        prevBtn.addEventListener('click', () => navigate(-1));
        nextBtn.addEventListener('click', () => navigate(1));

        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox) closeLightbox();
        });

        document.addEventListener('keydown', (e) => {
            if (!lightbox.classList.contains('active')) return;
            if (e.key === 'Escape') closeLightbox();
            if (e.key === 'ArrowLeft') navigate(-1);
            if (e.key === 'ArrowRight') navigate(1);
        });
    }

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(link => {
        link.addEventListener('click', (e) => {
            const target = document.querySelector(link.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // (Footer newsletter form removed 2026-07-13 — it was a non-functional
    //  mock that silently discarded emails. Reinstate only wired to a real
    //  endpoint and with explicit disclosure of who sends what.)

    // Contact form — posts to the NetWebMedia public forms API.
    // Success = HTTP 2xx with JSON { ok: true }; errors return { error: "..." }.
    const contactForm = document.querySelector('.contact-form');
    if (contactForm) {
        const FORM_ENDPOINT = 'https://netwebmedia.com/api/public/forms/submit';
        const submitBtn = contactForm.querySelector('.submit-btn');
        const statusBox = contactForm.querySelector('.form-status');
        const submitLabel = submitBtn ? submitBtn.textContent : '';

        // Page language drives both UI strings and the lang key sent to the
        // API (so any follow-up email goes out in the visitor's language).
        const isES = (document.documentElement.lang || 'en').toLowerCase().indexOf('es') === 0;
        const T = isES ? {
            sending: 'Enviando…',
            sentTitle: 'Mensaje Enviado.',
            sentBody: 'Gracias — te responderé a la brevedad.',
            newMessage: 'Nuevo Mensaje',
            errPrefix: 'No se pudo enviar tu mensaje: ',
            errGeneric: 'No se pudo enviar tu mensaje en este momento.',
            errNetwork: 'Error de red — tu mensaje no fue enviado.',
            fallback: 'También puedes escribirme directo: ',
            or: ' o '
        } : {
            sending: 'Sending…',
            sentTitle: 'Message Sent.',
            sentBody: 'Thanks — I’ll get back to you shortly.',
            newMessage: 'New Message',
            errPrefix: 'Your message could not be sent: ',
            errGeneric: 'Your message could not be sent right now.',
            errNetwork: 'Network error — your message was not sent.',
            fallback: 'You can also reach me directly: ',
            or: ' or '
        };

        function fieldValue(name) {
            const el = contactForm.querySelector('[name="' + name + '"]');
            return el ? el.value.trim() : '';
        }

        function showError(message) {
            if (!statusBox) return;
            statusBox.textContent = '';
            const msg = document.createElement('p');
            msg.textContent = message; // textContent — never inject server text as HTML
            const fallback = document.createElement('p');
            fallback.className = 'form-status-fallback';
            fallback.append(T.fallback);
            const mail = document.createElement('a');
            mail.href = 'mailto:carlos@netwebmedia.com';
            mail.textContent = 'carlos@netwebmedia.com';
            const wa = document.createElement('a');
            wa.href = 'https://wa.me/14423854585';
            wa.target = '_blank';
            wa.rel = 'noopener';
            wa.textContent = 'WhatsApp +1 (442) 385-4585';
            fallback.append(mail, T.or, wa, '.');
            statusBox.append(msg, fallback);
            statusBox.hidden = false;
        }

        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (statusBox) { statusBox.hidden = true; statusBox.textContent = ''; }
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = T.sending; }
            try {
                const res = await fetch(FORM_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        form_id: 'tapephoto-contact',
                        data: {
                            name: fieldValue('name'),
                            email: fieldValue('email'),
                            phone: fieldValue('phone'),
                            message: fieldValue('message'),
                            source: 'tapephoto.com',
                            lang: isES ? 'es' : 'en',
                            // Honeypot — humans leave this hidden field empty.
                            // DOM field is named nwm_hp_2 (Chrome address autofill
                            // can populate "website"-named inputs despite
                            // autocomplete=off); the API key stays nwm_website
                            // because that's what the server checks.
                            nwm_website: fieldValue('nwm_hp_2') || fieldValue('nwm_website')
                        }
                    })
                });
                let data = {};
                try { data = await res.json(); } catch (_) { /* non-JSON response */ }
                if (res.ok && data.ok) {
                    contactForm.textContent = '';
                    const wrap = document.createElement('div');
                    wrap.style.cssText = 'text-align:center;padding:60px 0;';
                    const h = document.createElement('h2');
                    h.style.cssText = 'font-family:var(--serif);font-size:2rem;margin-bottom:16px;';
                    h.textContent = T.sentTitle;
                    const p = document.createElement('p');
                    p.style.cssText = 'opacity:0.5;margin-bottom:30px;';
                    p.textContent = T.sentBody;
                    const btn = document.createElement('button');
                    btn.style.cssText = 'padding:12px 28px;border:1px solid rgba(255,255,255,0.3);background:none;color:white;cursor:pointer;text-transform:uppercase;font-size:0.7rem;font-weight:600;letter-spacing:0.15em;';
                    btn.textContent = T.newMessage;
                    btn.addEventListener('click', () => location.reload());
                    wrap.append(h, p, btn);
                    contactForm.append(wrap);
                } else {
                    showError(data.error ? T.errPrefix + data.error : T.errGeneric);
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel; }
                }
            } catch (err) {
                showError(T.errNetwork);
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel; }
            }
        });
    }

    // Parallax hero on scroll (uses requestAnimationFrame for performance)
    const hero = document.querySelector('.hero');
    if (hero) {
        const heroImg = hero.querySelector('.hero-img');
        const heroContent = hero.querySelector('.hero-content');
        let ticking = false;
        window.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    const scrolled = window.scrollY;
                    if (scrolled < window.innerHeight) {
                        heroImg.style.transform = `translateY(${scrolled * 0.3}px) scale(1.05)`;
                        heroContent.style.opacity = 1 - (scrolled / (window.innerHeight * 0.7));
                    }
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
    }
});
