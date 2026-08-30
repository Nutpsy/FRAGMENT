/**
 * 碎屑 - 构成主义博客 (SPA 重构版)
 * 交互脚本、动态渲染、B-side、BGM、管理员 CMS、SPA 路由
 */

/* ========================================
   Markdown 文件加载工具
   ======================================== */
const MdLoader = {
  cache: {},
  async load(url) {
    if (this.cache[url]) return this.cache[url];
    try {
      const res = await fetch(url + '?t=' + Date.now());
      if (!res.ok) throw new Error('Failed to load ' + url);
      const text = await res.text();
      this.cache[url] = text;
      return text;
    } catch (e) {
      console.error('MdLoader error:', e);
      return '';
    }
  }
};

/* ========================================
   SPA 路由系统
   ======================================== */
const Router = {
  init() {
    this.handleHash();
    window.addEventListener('hashchange', () => this.handleHash());
  },

  async handleHash() {
    const hash = decodeURIComponent(window.location.hash.replace('#/', '').replace('#', ''));
    const page = hash || 'home';

    if (page.startsWith('archive/')) {
      const archivePage = page.replace('archive/', '');
      this.showArchive(archivePage);
    } else if (page.startsWith('post/')) {
      const parts = page.split('/');
      const cat = parts[1];
      const id = parts[2];
      await this.showPost(cat, id);
    } else {
      this.showHome();
    }

    // SPA 路由变化后手动上报 Google Analytics page_view
    if (typeof gtag === 'function') {
      gtag('event', 'page_view', {
        page_title: document.title,
        page_location: window.location.href
      });
    }
  },


  showHome() {
    document.getElementById('view-home').style.display = 'block';
    document.getElementById('view-archive').style.display = 'none';
    window.scrollTo(0, 0);
    // Re-init scroll animations for newly visible elements
    setTimeout(() => initScrollAnimations(), 50);
  },

  showArchive(page) {
    document.getElementById('view-home').style.display = 'none';
    const archiveView = document.getElementById('view-archive');
    archiveView.style.display = 'block';
    window.scrollTo(0, 0);

    const wrapper = document.getElementById('archive-page-wrapper');
    wrapper.className = 'archive-page' + (page === 'b-side' ? ' archive-page-dark' : '');

    ArchiveApp.init(page);
  },

  async showPost(category, id) {
    document.getElementById('view-home').style.display = 'none';
    const archiveView = document.getElementById('view-archive');
    archiveView.style.display = 'block';
    window.scrollTo(0, 0);

    const wrapper = document.getElementById('archive-page-wrapper');
    wrapper.className = 'archive-page' + (category === 'bSide' ? ' archive-page-dark' : '');

    await PostApp.init(category, id);
  },

  navigate(page) {
    window.location.hash = page === 'home' ? '' : `#/${page}`;
  }
};

/* ========================================
   归档页渲染逻辑
   ======================================== */
const ArchiveApp = {
  page: '',

  init(page) {
    this.page = page;
    this.initNav();

    if (page === 'b-side' && typeof SkadrateData !== 'undefined' && !SkadrateData.bSide.isUnlocked()) {
      this.renderBSideLock();
    } else {
      this.render();
    }

    if (page === 'gravity-rainbow') {
      this.ensureMarked();
    }
  },

  initNav() {
    const nav = document.getElementById('archive-nav');
    if (!nav) return;
    nav.innerHTML = `
      <a href="#" class="archive-nav-back">← 碎屑</a>
      <span class="archive-nav-title">${this.getPageTitle()}</span>
    `;
    nav.querySelector('.archive-nav-back').addEventListener('click', (e) => {
      e.preventDefault();
      Router.navigate('home');
    });
  },

  getPageTitle() {
    const map = {
      'scintilla': 'SCINTILLA // ARCHIVE',
      'inland-empire': '内陆帝国 // ARCHIVE',
      'gravity-rainbow': '万有引力之虹 // ARCHIVE',
      'b-side': 'B-SIDE // ARCHIVE'
    };
    return map[this.page] || '';
  },

  render() {
    const container = document.getElementById('archive-content');
    if (!container || typeof SkadrateData === 'undefined') return;

    const catMap = {
      'scintilla': 'scintilla',
      'inland-empire': 'inlandEmpire',
      'gravity-rainbow': 'gravityRainbow',
      'b-side': 'bSide'
    };
    const category = catMap[this.page];
    const items = SkadrateData.getAll(category);

    if (items.length === 0) {
      container.innerHTML = '<p class="archive-empty">暂无记录</p>';
      return;
    }

    // 按日期分组
    const groups = this.groupByDate(items);

    if (this.page === 'scintilla') {
      container.innerHTML = groups.map(g => `
        <div class="archive-date-group">
          <div class="archive-date-heading">${escapeHtml(g.date)}</div>
          <div class="archive-sci-list">
            ${g.items.map(it => `
              <article class="archive-sci-item" data-id="${it.id}">
                <p class="archive-sci-text">${escapeHtml(it.content)}</p>
              </article>
            `).join('')}
          </div>
        </div>
      `).join('');
    } else if (this.page === 'inland-empire') {
      container.innerHTML = groups.map(g => `
        <div class="archive-date-group">
          <div class="archive-date-heading">${escapeHtml(g.date)}</div>
          <div class="archive-ie-date-group">
            ${g.items.map(it => `
              <div class="archive-ie-item" data-id="${it.id}">
                <img src="${escapeHtml(it.src)}" alt="${escapeHtml(it.alt || '')}" loading="lazy">
                ${it.category ? `<span class="archive-ie-category">${escapeHtml(it.category)}</span>` : ''}
                ${it.caption ? `<span class="archive-ie-caption">${escapeHtml(it.caption)}</span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `).join('');
    } else if (this.page === 'gravity-rainbow') {
      container.innerHTML = groups.map(g => `
        <div class="archive-date-group">
          <div class="archive-date-heading">${escapeHtml(g.date)}</div>
          <div class="archive-gr-list">
            ${g.items.map(it => `
              <article class="archive-gr-item" data-id="${it.id}">
                <h3 class="archive-gr-title">${escapeHtml(it.title)}</h3>
                ${it.tags && it.tags.length ? `<div class="archive-gr-tags">${it.tags.map(t => `<span class="archive-gr-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
                <div class="archive-gr-md">${this.renderMarkdown(it.mdContent)}</div>
              </article>
            `).join('')}
          </div>
        </div>
      `).join('');
      if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
        MathJax.typesetPromise([container]).catch(() => {});
      }
    } else if (this.page === 'b-side') {
      container.innerHTML = groups.map(g => `
        <div class="archive-date-group">
          <div class="archive-date-heading">${escapeHtml(g.date)}</div>
          <div class="archive-bs-list">
            ${g.items.map(it => `
              <div class="archive-bs-item" data-id="${it.id}">
                <p>${escapeHtml(it.content)}</p>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('');
    }

    // 归档页条目也可点击进入详情页
    const selectorMap = {
      'scintilla': '.archive-sci-item',
      'inland-empire': '.archive-ie-item',
      'gravity-rainbow': '.archive-gr-item',
      'b-side': '.archive-bs-item'
    };
    const sel = selectorMap[this.page];
    if (sel) {
      container.querySelectorAll(sel).forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('a')) return;
          const id = el.dataset.id;
          if (id) Router.navigate(`post/${category}/${id}`);
        });
      });
    }
  },

  groupByDate(items) {
    const map = {};
    items.forEach(it => {
      const d = it.date || '';
      if (!map[d]) map[d] = [];
      map[d].push(it);
    });
    return Object.keys(map).sort((a, b) => b.localeCompare(a)).map(d => ({
      date: d,
      items: map[d]
    }));
  },

  renderBSideLock() {
    const container = document.getElementById('archive-content');
    if (!container) return;
    container.innerHTML = `
      <div class="archive-bs-lock">
        <div class="archive-bs-lock-panel">
          <h3>B-SIDE ACCESS</h3>
          <input type="password" id="archive-bs-input" maxlength="4" placeholder="####" inputmode="numeric">
          <div class="archive-bs-hint">Hint: 生日</div>
          <button id="archive-bs-submit">UNLOCK</button>
        </div>
      </div>
    `;

    const input = document.getElementById('archive-bs-input');
    const submit = document.getElementById('archive-bs-submit');

    const tryUnlock = () => {
      if (input.value === '0910') {
        SkadrateData.bSide.unlock();
        this.render();
      } else {
        input.style.borderColor = 'var(--red)';
        setTimeout(() => { input.style.borderColor = ''; }, 600);
        input.value = '';
        input.focus();
      }
    };

    submit.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
    input.focus();
  },

  ensureMarked() {
    if (typeof marked !== 'undefined') return;
    window.marked = {
      parse: (text) => {
        return escapeHtml(text)
          .replace(/\n/g, '<br>')
          .replace(/^#{1,6}\s+(.+)$/gm, '<strong>$1</strong>');
      }
    };
  },

  loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src^="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  async ensureMarkedAsync() {
    if (typeof marked !== 'undefined' && marked.parse) return;
    await this.loadScript('https://cdn.jsdelivr.net/npm/marked/marked.min.js');
    // 兼容 marked v4 与 v15：v15 默认异步，需等下一帧
    if (typeof marked === 'undefined' || !marked.parse) {
      await new Promise(r => setTimeout(r, 50));
    }
  },

  renderMarkdown(md) {
    if (!md) return '';
    if (typeof marked !== 'undefined' && marked.parse) {
      try {
        return marked.parse(md);
      } catch (e) {
        console.error('marked.parse error:', e);
      }
    }
    return escapeHtml(md).replace(/\n/g, '<br>');
  }
};

/* ========================================
   独立详情页渲染逻辑
   ======================================== */
const PostApp = {
  catMap: {
    'scintilla': 'scintilla',
    'inlandEmpire': 'inlandEmpire',
    'gravityRainbow': 'gravityRainbow',
    'bSide': 'bSide'
  },

  titleMap: {
    'scintilla': 'SCINTILLA',
    'inlandEmpire': '内陆帝国',
    'gravityRainbow': '万有引力之虹',
    'bSide': 'B-SIDE'
  },

  async init(category, id) {
    const nav = document.getElementById('archive-nav');
    if (nav) {
      nav.innerHTML = `
        <a href="#" class="archive-nav-back">← 碎屑</a>
        <span class="archive-nav-title">${this.titleMap[category] || ''} // POST</span>
      `;
      nav.querySelector('.archive-nav-back').addEventListener('click', (e) => {
        e.preventDefault();
        Router.navigate('home');
      });
    }

    const container = document.getElementById('archive-content');
    if (!container || typeof SkadrateData === 'undefined') return;

    const items = SkadrateData.getAll(this.catMap[category] || category);
    const item = items.find(it => it.id == id);

    if (!item) {
      container.innerHTML = '<p class="archive-empty">记录不存在</p>';
      return;
    }

    let mdHtml = '';
    if (category === 'gravityRainbow') {
      await ArchiveApp.ensureMarkedAsync();
      let mdText = '';
      if (item.mdFile) {
        mdText = await MdLoader.load(item.mdFile);
      }
      if (!mdText && item.mdContent) {
        mdText = item.mdContent;
      }
      mdHtml = ArchiveApp.renderMarkdown(mdText);
    }

    if (category === 'scintilla') {
      container.innerHTML = `
        <article class="archive-sci-item" style="max-width:720px;margin:0 auto">
          <time class="archive-sci-date">${escapeHtml(item.date)}</time>
          <p class="archive-sci-text">${escapeHtml(item.content)}</p>
        </article>
      `;
    } else if (category === 'inlandEmpire') {
      container.innerHTML = `
        <div class="archive-ie-single" style="max-width:720px;margin:0 auto">
          <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || '')}" style="width:100%;display:block">
          <div style="margin-top:1rem">
            ${item.category ? `<span class="archive-ie-category" style="position:static;display:inline-block;margin-right:0.5rem">${escapeHtml(item.category)}</span>` : ''}
            ${item.caption ? `<span style="color:var(--gray)">${escapeHtml(item.caption)}</span>` : ''}
          </div>
        </div>
      `;
    } else if (category === 'gravityRainbow') {
      container.innerHTML = `
        <article class="archive-gr-item" style="max-width:900px;margin:0 auto">
          <time class="archive-gr-date">${escapeHtml(item.date)}</time>
          <h3 class="archive-gr-title">${escapeHtml(item.title)}</h3>
          <div class="archive-gr-md">${mdHtml || '<p style="color:var(--gray)">内容加载中...</p>'}</div>
        </article>
      `;
      if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
        MathJax.typesetPromise([container]).catch(() => {});
      }
    } else if (category === 'bSide') {
      container.innerHTML = `
        <div class="archive-bs-item" style="max-width:720px;margin:0 auto">
          <time class="archive-bs-date">${escapeHtml(item.date)}</time>
          <p>${escapeHtml(item.content)}</p>
        </div>
      `;
    }
  }
};

/* ========================================
   初始化入口
   ======================================== */
document.addEventListener('DOMContentLoaded', () => {
  initNavScroll();
  initHeroAnimations();
  initScrollAnimations();
  initSmoothScroll();
  initScrollProgress();
  initHomeRendering();
  initBSide();
  initBGM();
  initSPALinks();
  Router.init();
});

/* ========================================
   Hero 区域动画初始化
   ======================================== */
function initHeroAnimations() {
  const hero = document.querySelector('.hero');
  const heroTitle = document.querySelector('.hero-title');
  const heroSubtitle = document.querySelector('.hero-subtitle');
  if (!hero) return;

  const finishIntro = () => {
    if (hero.classList.contains('intro-complete')) return;
    hero.classList.add('intro-complete');
    // 保留动画声明的 forwards 终帧，避免移除类后回落到另一套静态样式而跳版。
    // 动画本身只运行一次；保留 class 不会重播或继续消耗帧。
  };

  window.requestAnimationFrame(() => {
    hero.classList.add('intro-running');
    if (heroTitle) heroTitle.classList.add('visible');
    if (heroSubtitle) heroSubtitle.classList.add('visible');
  });

  // 动画声明保留终帧；延时只负责标记完成，不会引发二次落版。
  window.setTimeout(finishIntro, 2550);
}

/* ========================================
   导航栏滚动效果
   ======================================== */
function initNavScroll() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  let lastScroll = 0;
  let ticking = false;

  const updateNav = () => {
    const currentScroll = window.pageYOffset;
    if (currentScroll > 100) {
      nav.classList.add('nav-scrolled');
    } else {
      nav.classList.remove('nav-scrolled');
    }
    if (currentScroll > lastScroll && currentScroll > 200) {
      nav.style.transform = 'translateY(-100%)';
    } else {
      nav.style.transform = 'translateY(0)';
    }
    lastScroll = currentScroll;
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(updateNav);
      ticking = true;
    }
  }, { passive: true });
}

/* ========================================
   滚动动画（Intersection Observer）
   ======================================== */
function initScrollAnimations() {
  const observerOptions = { root: null, rootMargin: '0px', threshold: 0.1 };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        const delay = entry.target.dataset.delay || 0;
        entry.target.style.animationDelay = `${delay}ms`;
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.scintilla-item, .gr-item, .ie-item').forEach((item, index) => {
    item.dataset.delay = index * 100;
    observer.observe(item);
  });
}

/* ========================================
   平滑滚动
   ======================================== */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href === '#') return;
      if (href.startsWith('#/')) return; // Let SPA router handle these
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        const navHeight = document.querySelector('.nav').offsetHeight;
        const targetPosition = target.offsetTop - navHeight - 20;
        window.scrollTo({ top: targetPosition, behavior: 'smooth' });
      }
    });
  });
}

/* ========================================
   滚动进度指示器
   ======================================== */
function initScrollProgress() {
  const progressBar = document.createElement('div');
  progressBar.className = 'scroll-progress';
  document.body.appendChild(progressBar);

  const style = document.createElement('style');
  style.textContent = `
    .scroll-progress {
      position: fixed;
      top: 0;
      left: 0;
      height: 3px;
      background: linear-gradient(90deg, #C62828, #FBC02D);
      width: 100%;
      z-index: 9999;
      transform: scaleX(0);
      transform-origin: left center;
      will-change: transform;
    }
  `;
  document.head.appendChild(style);

  let ticking = false;
  const updateProgress = () => {
    const scrollTop = window.pageYOffset;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? Math.min(1, Math.max(0, scrollTop / docHeight)) : 0;
    progressBar.style.transform = `scaleX(${progress})`;
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(updateProgress);
      ticking = true;
    }
  }, { passive: true });

  updateProgress();
}

/* ========================================
   首页动态渲染
   ======================================== */
function initHomeRendering() {
  if (typeof SkadrateData === 'undefined') return;

  // SCINTILLA
  const sciGrid = document.getElementById('scintilla-grid');
  if (sciGrid) {
    const items = SkadrateData.getLatest('scintilla', 4);
    sciGrid.innerHTML = items.map((it, idx) => `
      <article class="scintilla-item" data-delay="${idx * 100}" style="animation-delay:${idx * 0.1}s" data-id="${it.id}">
        <time class="scintilla-date">${escapeHtml(it.date)}</time>
        <p class="scintilla-text">${escapeHtml(it.content)}</p>
        <div class="scintilla-geo-accent"></div>
      </article>
    `).join('');
    sciGrid.querySelectorAll('.scintilla-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        Router.navigate(`post/scintilla/${id}`);
      });
    });
  }

  // 内陆帝国
  const ieGrid = document.getElementById('inland-empire-grid');
  if (ieGrid) {
    const items = SkadrateData.getLatest('inlandEmpire', 4);
    ieGrid.innerHTML = items.map((it, idx) => `
      <div class="ie-item" data-delay="${idx * 80}" style="animation-delay:${idx * 0.08}s" data-id="${it.id}">
        <img src="${escapeHtml(it.src)}" alt="${escapeHtml(it.alt || '')}" loading="lazy">
        ${it.category ? `<span class="ie-category">${escapeHtml(it.category)}</span>` : ''}
        ${it.caption ? `<span class="ie-caption">${escapeHtml(it.caption)}</span>` : ''}
      </div>
    `).join('');
    ieGrid.querySelectorAll('.ie-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        Router.navigate(`post/inlandEmpire/${id}`);
      });
    });
  }

  // 万有引力之虹
  const grContainer = document.getElementById('gravity-rainbow-container');
  if (grContainer) {
    const items = SkadrateData.getLatest('gravityRainbow', 3);
    grContainer.innerHTML = items.map((it, idx) => {
      let preview = '';
      if (typeof marked !== 'undefined' && marked.parse) {
        const plain = marked.parse(it.mdContent || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        preview = plain.slice(0, 120) + (plain.length > 120 ? '…' : '');
      } else {
        const plain = (it.mdContent || '').replace(/[#>*\-\[\]\(\)`]/g, '').replace(/\s+/g, ' ').trim();
        preview = plain.slice(0, 120) + (plain.length > 120 ? '…' : '');
      }
      return `
        <article class="gr-item" data-delay="${idx * 150}" style="animation-delay:${idx * 0.15}s" data-id="${it.id}">
          <div class="gr-geo-decor"></div>
          <time class="gr-date">${escapeHtml(it.date)}</time>
          <h3 class="gr-title">${escapeHtml(it.title)}</h3>
          <div class="gr-md-content">${escapeHtml(preview)}</div>
          ${it.tags && it.tags.length ? `<div class="gr-tags">${it.tags.map(t => `<span class="gr-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </article>
      `;
    }).join('');
    grContainer.querySelectorAll('.gr-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        Router.navigate(`post/gravityRainbow/${id}`);
      });
    });
  }

  // 宣言
  const manifestoText = document.getElementById('manifesto-text');
  if (manifestoText) {
    const data = SkadrateData.load();
    manifestoText.textContent = data.manifesto ? data.manifesto.text : '';
  }
}

/* ========================================
   B-side 隐秘入口
   ======================================== */
function initBSide() {
  const trigger = document.getElementById('bside-trigger');
  const modal = document.getElementById('bside-modal');
  const closeBtn = document.getElementById('bside-close');
  const input = document.getElementById('bside-input');
  const submit = document.getElementById('bside-submit');

  if (!trigger || !modal) return;

  trigger.addEventListener('click', () => {
    modal.classList.add('active');
    input.value = '';
    input.focus();
  });

  closeBtn.addEventListener('click', () => modal.classList.remove('active'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

  const tryUnlock = () => {
    if (input.value === '0910') {
      SkadrateData.bSide.unlock();
      modal.classList.remove('active');
      Router.navigate('archive/b-side');
    } else {
      input.style.borderColor = 'var(--red)';
      setTimeout(() => { input.style.borderColor = ''; }, 600);
      input.value = '';
      input.focus();
    }
  };

  submit.addEventListener('click', tryUnlock);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
}

/* ========================================
   午夜电台 BGM 播放器
   ======================================== */
function initBGM() {
  const audio = document.getElementById('bgm-audio');
  const toggle = document.getElementById('bgm-toggle');
  const icon = document.getElementById('bgm-icon');
  const volume = document.getElementById('bgm-volume');
  if (!audio || !toggle) return;

  audio.volume = 0.25;

  const tryPlay = () => {
    if (audio.paused) {
      audio.play().then(() => { icon.textContent = '❚❚'; }).catch(() => {});
    }
  };
  tryPlay();

  toggle.addEventListener('click', () => {
    if (audio.paused) {
      audio.play().then(() => { icon.textContent = '❚❚'; }).catch(() => {});
    } else {
      audio.pause();
      icon.textContent = '►';
    }
  });

  if (volume) {
    volume.addEventListener('input', (e) => { audio.volume = parseFloat(e.target.value); });
  }

  audio.addEventListener('ended', () => { icon.textContent = '►'; });
}

/* ========================================
   SPA 链接劫持
   ======================================== */
function initSPALinks() {
  document.body.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#/archive/')) return;
    e.preventDefault();
    Router.navigate(href.replace('#/', ''));
  });
}

/* ========================================
   工具函数
   ======================================== */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ========================================
   键盘导航支持
   ======================================== */
document.addEventListener('keydown', (e) => {
  if (e.shiftKey && e.key === 'Home') {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (e.shiftKey && e.key === 'End') {
    e.preventDefault();
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }
});

/* ========================================
   窗口大小变化处理
   ======================================== */
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }, 250);
});

/* ========================================
   页面可见性变化处理（不再暂停音乐）
   ======================================== */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    document.body.style.animationPlayState = 'paused';
  } else {
    document.body.style.animationPlayState = 'running';
  }
});
