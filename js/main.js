/* ============================================================
   DIAMOND TOUCH DETAILING — main.js
   ============================================================ */

'use strict';

/* ─── Nav Scroll ─────────────────────────────────────────── */
(function initNav() {
  const nav       = document.getElementById('nav');
  const toggle    = document.getElementById('navToggle');
  const menu      = document.getElementById('mobileMenu');
  const closeBtn  = document.getElementById('mobileClose');
  const menuLinks = menu.querySelectorAll('.mobile-menu__link, .mobile-menu__cta');

  // Scroll state
  let ticking = false;

  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(() => {
        nav.classList.toggle('scrolled', window.scrollY > 20);
        ticking = false;
      });
      ticking = true;
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // init on load

  // Mobile menu open
  function openMenu() {
    menu.classList.add('open');
    toggle.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    menu.removeAttribute('aria-hidden');
  }

  // Mobile menu close
  function closeMenu() {
    menu.classList.remove('open');
    toggle.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    menu.setAttribute('aria-hidden', 'true');
  }

  toggle.addEventListener('click', () => {
    menu.classList.contains('open') ? closeMenu() : openMenu();
  });

  closeBtn.addEventListener('click', closeMenu);

  menuLinks.forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('open')) {
      closeMenu();
      toggle.focus();
    }
  });

  // Close on overlay click
  menu.addEventListener('click', (e) => {
    if (e.target === menu) closeMenu();
  });
})();


/* ─── Hero load animation ────────────────────────────────── */
(function initHero() {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  // Trigger ken-burns once DOM is stable
  requestAnimationFrame(() => {
    setTimeout(() => hero.classList.add('loaded'), 100);
  });
})();


/* ─── IntersectionObserver Animations ───────────────────── */
(function initAnimations() {
  const elements = document.querySelectorAll('[data-animate]');
  if (!elements.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animated');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.12,
    rootMargin: '0px 0px -40px 0px'
  });

  elements.forEach(el => observer.observe(el));
})();


/* ─── Before / After Sliders ─────────────────────────────── */
(function initBeforeAfter() {
  const sliders = document.querySelectorAll('[data-ba]');
  if (!sliders.length) return;

  sliders.forEach(slider => {
    const afterEl = slider.querySelector('.ba-slider__after');
    const handle  = slider.querySelector('.ba-slider__handle');
    let isDragging = false;
    let currentPos = 50;

    function setPosition(percent) {
      percent = Math.min(100, Math.max(0, percent));
      currentPos = percent;
      // Reveal from left: after is clipped from right
      afterEl.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
      handle.style.left = `${percent}%`;
      handle.setAttribute('aria-valuenow', Math.round(percent));
    }

    function getPercent(clientX) {
      const rect = slider.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * 100;
    }

    // Mouse events
    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      setPosition(getPercent(e.clientX));
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Touch events
    handle.addEventListener('touchstart', (e) => {
      isDragging = true;
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      setPosition(getPercent(e.touches[0].clientX));
    }, { passive: true });

    document.addEventListener('touchend', () => {
      isDragging = false;
    });

    // Keyboard accessibility
    handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 2;
      if (e.key === 'ArrowLeft')  { setPosition(currentPos - step); e.preventDefault(); }
      if (e.key === 'ArrowRight') { setPosition(currentPos + step); e.preventDefault(); }
    });

    // Click anywhere on slider to jump
    slider.addEventListener('click', (e) => {
      if (e.target === handle || handle.contains(e.target)) return;
      setPosition(getPercent(e.clientX));
    });

    // Init at 50%
    setPosition(50);
  });
})();


/* ─── FAQ Accordion ──────────────────────────────────────── */
(function initFAQ() {
  const items = document.querySelectorAll('.faq-item');
  if (!items.length) return;

  items.forEach(item => {
    const btn    = item.querySelector('.faq-item__question');
    const answer = item.querySelector('.faq-item__answer');

    btn.addEventListener('click', () => {
      const isOpen = btn.getAttribute('aria-expanded') === 'true';

      // Close all others
      items.forEach(other => {
        const otherBtn    = other.querySelector('.faq-item__question');
        const otherAnswer = other.querySelector('.faq-item__answer');
        if (other !== item) {
          otherBtn.setAttribute('aria-expanded', 'false');
          otherAnswer.classList.remove('open');
        }
      });

      // Toggle current
      btn.setAttribute('aria-expanded', String(!isOpen));
      answer.classList.toggle('open', !isOpen);
    });
  });
})();


/* ─── Testimonial Carousel ───────────────────────────────── */
(function initTestimonials() {
  const track  = document.getElementById('testimonialsTrack');
  const dots   = document.querySelectorAll('.testimonials__dot');
  if (!track || !dots.length) return;

  const cards  = track.querySelectorAll('.testimonial-card');
  const total  = cards.length;
  let current  = 0;
  let interval = null;
  const DELAY  = 5000;

  function goTo(index) {
    current = ((index % total) + total) % total;
    // Each card is 100% + gap; use gap-free overlap via translate
    const cardWidth = track.parentElement.offsetWidth;
    // Account for gap between cards
    const gap = parseFloat(getComputedStyle(track).gap) || 0;
    track.style.transform = `translateX(-${current * (cardWidth + gap)}px)`;

    dots.forEach((dot, i) => {
      dot.classList.toggle('testimonials__dot--active', i === current);
    });
  }

  function next() {
    goTo(current + 1);
  }

  function startAuto() {
    interval = setInterval(next, DELAY);
  }

  function stopAuto() {
    clearInterval(interval);
    interval = null;
  }

  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      stopAuto();
      goTo(parseInt(dot.dataset.index, 10));
      startAuto();
    });
  });

  const carousel = track.closest('.testimonials__carousel');
  carousel.addEventListener('mouseenter', stopAuto);
  carousel.addEventListener('mouseleave', startAuto);

  // Touch swipe
  let touchStartX = 0;
  carousel.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  carousel.addEventListener('touchend', (e) => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      stopAuto();
      goTo(diff > 0 ? current + 1 : current - 1);
      startAuto();
    }
  }, { passive: true });

  goTo(0);
  startAuto();
})();


/* ─── Sticky Mobile CTA ──────────────────────────────────── */
(function initStickyCTA() {
  const cta  = document.getElementById('stickyCta');
  const hero = document.getElementById('hero');
  if (!cta || !hero) return;

  let ticking = false;

  function update() {
    const heroBottom = hero.getBoundingClientRect().bottom;
    const shouldShow = heroBottom < 0;
    cta.classList.toggle('visible', shouldShow);
    cta.setAttribute('aria-hidden', String(!shouldShow));
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });

  update();
})();


/* ─── Copyright Year ─────────────────────────────────────── */
(function setCopyrightYear() {
  const el = document.getElementById('copyrightYear');
  if (el) el.textContent = new Date().getFullYear();
})();


/* ─── Service Card Expand ───────────────────────────────── */
(function initServiceExpand() {
  document.querySelectorAll(".service-card__expand-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const details = btn.closest(".service-card").querySelector(".service-card__details");
      const isOpen = details.classList.contains("open");
      // Close all
      document.querySelectorAll(".service-card__details.open").forEach(d => d.classList.remove("open"));
      document.querySelectorAll(".service-card__expand-btn.open").forEach(b => {
        b.classList.remove("open");
        b.setAttribute("aria-expanded", "false");
      });
      // Open this one if it was closed
      if (!isOpen) {
        details.classList.add("open");
        btn.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });
})();


/* ─── Smooth Anchor Scroll (offset for nav) ─────────────── */
(function initSmoothScroll() {
  const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'), 10) || 72;

  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - navH;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
})();
