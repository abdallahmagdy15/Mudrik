// Mudrik · Landing Page · vanilla JS (≤100 lines)
(function () {
  'use strict';

  var STORAGE_KEY = 'mudrik.lang';
  var html = document.documentElement;
  var toggle = document.getElementById('langToggle');

  // ---- Language ----
  function applyLang(lang) {
    var isAr = lang === 'ar';
    html.setAttribute('lang', isAr ? 'ar' : 'en');
    html.setAttribute('dir', isAr ? 'rtl' : 'ltr');
    var nodes = document.querySelectorAll('[data-en],[data-ar]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var v = isAr ? n.getAttribute('data-ar') : n.getAttribute('data-en');
      if (v != null) n.textContent = v;
    }
    if (toggle) {
      var en = toggle.querySelector('.en');
      var ar = toggle.querySelector('.ar');
      if (en) en.classList.toggle('on', !isAr);
      if (ar) ar.classList.toggle('on', isAr);
    }
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  }

  var stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  applyLang(stored === 'ar' ? 'ar' : 'en');

  if (toggle) {
    toggle.addEventListener('click', function () {
      applyLang(html.getAttribute('lang') === 'ar' ? 'en' : 'ar');
    });
  }

  // ---- Smooth scroll on anchor links ----
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (id.length < 2) return;
    var el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    var y = el.getBoundingClientRect().top + window.pageYOffset - 64;
    window.scrollTo({ top: y, behavior: 'smooth' });
  });

  // ---- Copy buttons ----
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy') || '';
      var done = function () {
        var prev = btn.textContent;
        btn.classList.add('copied');
        btn.textContent = html.getAttribute('lang') === 'ar' ? 'تم النسخ' : 'Copied!';
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.textContent = prev;
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    });
  });

  // ---- Demo video lazy-load ----
  var frame = document.getElementById('demoFrame');
  if (frame) {
    var mount = function () {
      var url = frame.getAttribute('data-video-url');
      if (!url || url === '[VIDEO_URL]') {
        // Placeholder: nothing to mount yet.
        var msg = document.createElement('div');
        msg.style.cssText = 'position:absolute;inset:auto 0 16px 0;text-align:center;color:#0C2530;font-size:13px;opacity:.7;';
        msg.textContent = html.getAttribute('lang') === 'ar' ? 'سيتوفر الفيديو قريباً' : 'Video coming soon';
        frame.appendChild(msg);
        return;
      }
      var v = document.createElement('video');
      v.src = url; v.controls = true; v.autoplay = true; v.playsInline = true;
      v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;background:#000;';
      frame.innerHTML = '';
      frame.appendChild(v);
      frame.style.cursor = 'default';
    };
    frame.addEventListener('click', mount);
    frame.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mount(); }
    });
  }
})();
