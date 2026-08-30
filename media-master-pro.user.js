// ==UserScript==
// @name         Media Master Pro - 视频音频增强控制
// @namespace    https://github.com/ItmeiCode/Media-Master-Pro
// @version      3.1.4
// @description  智能媒体控制器：倍速调节、音量增益、站点记忆、加密存储、视频旋转、画中画、窗口全屏
// @author       itmei
// @match        *://*/*
// @grant        none
// @run-at       document-start
// @license      MIT
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237c7cf8' stroke-width='2'%3E%3Cpath d='M3 18v-6a9 9 0 0 1 18 0v6'/%3E%3Cpath d='M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z'/%3E%3C/svg%3E
// ==/UserScript==

(() => {
    'use strict';

    window.addEventListener('keydown', (e) => {
        if ((e.key === 'Escape' || e.key === 'Esc') && window.__MM_FS_ACTIVE) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            window.__MM_FS_TOGGLE?.();
        }
    }, true);

    // ============================================================
    // 模块1: 安全存储引擎
    // ============================================================
    const StorageEngine = (() => {
        const SALT = 'M3d1aM4st3r2024';
        const DB_KEY = 'media_master_db';

        const _xor = (str, key) => {
            let out = '';
            for (let i = 0; i < str.length; i++) {
                out += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return out;
        };

        const _encode = (obj) => {
            const json = JSON.stringify(obj);
            return btoa(_xor(json, SALT));
        };

        const _decode = (encoded) => {
            const raw = atob(encoded);
            return JSON.parse(_xor(raw, SALT));
        };

        const getSiteId = () => location.hostname;

        return {
            load: () => {
                try {
                    const raw = localStorage.getItem(DB_KEY);
                    if (!raw) return { speed: 1, gain: 1, rotation: 0 };
                    const data = _decode(raw);
                    const site = data[getSiteId()];
                    return site ? { speed: site.speed ?? 1, gain: site.gain ?? 1, rotation: site.rotation ?? 0 } : { speed: 1, gain: 1, rotation: 0 };
                } catch {
                    return { speed: 1, gain: 1, rotation: 0 };
                }
            },
            save: (speed, gain, rotation) => {
                try {
                    let db = {};
                    const raw = localStorage.getItem(DB_KEY);
                    if (raw) db = _decode(raw);
                    db[getSiteId()] = { speed, gain, rotation };
                    localStorage.setItem(DB_KEY, _encode(db));
                } catch (e) {
                    console.warn('[MediaMaster] 存储失败:', e);
                }
            }
        };
    })();

    // ============================================================
    // 模块2: 媒体控制核心
    // ============================================================
    const MediaEngine = (() => {
        const _cache = new WeakMap();
        const _ctxMap = new WeakMap();
        const FS_ID = 'mm-window-fullscreen-container';
        const FS_CLASS = 'mm-window-fs';
        const FS_STYLE_ID = 'mm-window-fs-style';
        let _fs = {
            active: false,
            video: null,
            root: null,
            videoStyle: '',
            rootStyle: '',
            ancestorStyles: [],
            hidden: [],
            keep: [],
            bar: null,
            unbindBar: null
        };

        let _rotationDeg = 0;
        let _pip = {
            active: false,
            video: null,
            parent: null,
            next: null,
            win: null,
            placeholder: null,
            videoStyle: '',
            unbind: null
        };
        let _pipMask = {
            source: null,
            host: null,
            pos: '',
            el: null
        };

        const _getAll = () => {
            const list = [...document.querySelectorAll('video, audio')];
            if (_pip.video && !list.includes(_pip.video)) list.push(_pip.video);
            return list;
        };
        const _getVideos = () => {
            const list = [...document.querySelectorAll('video')];
            if (_pip.video && !list.includes(_pip.video)) list.push(_pip.video);
            return list;
        };

        const _unlockVideoPiP = (video) => {
            if (!video || video.tagName !== 'VIDEO') return;
            try { video.removeAttribute('disablepictureinpicture'); } catch {}
            try { video.removeAttribute('disablePictureInPicture'); } catch {}
            try {
                if (Object.prototype.hasOwnProperty.call(video, 'disablePictureInPicture')) {
                    delete video.disablePictureInPicture;
                }
            } catch {}
            try { video.disablePictureInPicture = false; } catch {}
        };

        const _installPiPUnlock = () => {
            try {
                Object.defineProperty(HTMLVideoElement.prototype, 'disablePictureInPicture', {
                    configurable: true,
                    enumerable: true,
                    get() { return false; },
                    set() {}
                });
            } catch (e) {
                console.warn('[MediaMaster] 无法覆盖 disablePictureInPicture:', e);
            }

            const scan = (root) => {
                if (!root) return;
                if (root.nodeType === 1 && root.tagName === 'VIDEO') _unlockVideoPiP(root);
                if (root.querySelectorAll) root.querySelectorAll('video').forEach(_unlockVideoPiP);
            };
            scan(document);

            const mo = new MutationObserver((muts) => {
                for (const m of muts) {
                    if (m.type === 'attributes' && m.target?.tagName === 'VIDEO') {
                        _unlockVideoPiP(m.target);
                    }
                    m.addedNodes?.forEach(scan);
                }
            });
            mo.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['disablepictureinpicture']
            });
        };
        _installPiPUnlock();

        const _pipErrorMsg = (err) => {
            const raw = String(err?.message || err || '');
            if (/not supported|is not a function|undefined/i.test(raw)) return '浏览器不支持画中画';
            if (/not allowed|disablePictureInPicture|disabled/i.test(raw)) return '站点禁用了画中画';
            if (/user activation|user gesture|transient/i.test(raw)) return '请直接点击画中画按钮';
            if (/metadata|readyState|loaded/i.test(raw)) return '视频还在加载，请先播放';
            if (/not in a document|not visible|hidden/i.test(raw)) return '视频当前不可见';
            if (/Picture-in-Picture.*not/i.test(raw)) return '当前页面不允许画中画';
            return '画中画切换失败';
        };

        const _enterPiP = (video) => {
            _unlockVideoPiP(video);
            if (typeof video.webkitSetPresentationMode === 'function') {
                video.webkitSetPresentationMode('picture-in-picture');
                return Promise.resolve();
            }
            if (typeof video.requestPictureInPicture !== 'function') {
                return Promise.reject(new Error('not supported'));
            }
            return video.requestPictureInPicture();
        };

        const _ensureGain = (el) => {
            if (_cache.has(el)) return _cache.get(el);
            try {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return null;
                const ctx = new Ctx();
                const src = ctx.createMediaElementSource(el);
                const gain = ctx.createGain();
                src.connect(gain);
                gain.connect(ctx.destination);
                _ctxMap.set(el, ctx);
                _cache.set(el, gain);
                el.volume = 1;
                if (ctx.state === 'suspended') ctx.resume().catch(() => {});
                return gain;
            } catch {
                return null;
            }
        };

        const _unmute = (el) => {
            try {
                el.muted = false;
                el.defaultMuted = false;
                el.removeAttribute('muted');
            } catch {}
        };

        const _resumeCtx = (el) => {
            const ctx = _ctxMap.get(el);
            if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
        };

        const _fmtTime = (sec) => {
            if (!Number.isFinite(sec) || sec < 0) return '00:00';
            sec = Math.floor(sec);
            const h = Math.floor(sec / 3600);
            const m = Math.floor((sec % 3600) / 60);
            const s = sec % 60;
            const mm = String(m).padStart(2, '0');
            const ss = String(s).padStart(2, '0');
            return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
        };

        const _mountPipControls = (win, video) => {
            const doc = win.document;
            const root = doc.createElement('div');
            root.className = 'mm-pip-root';

            const stage = doc.createElement('div');
            stage.className = 'mm-pip-stage';

            const bar = doc.createElement('div');
            bar.className = 'mm-pip-bar';
            bar.innerHTML = `
                <button class="mm-pip-play" type="button" title="播放/暂停">▶</button>
                <span class="mm-pip-time" data-role="cur">0:00</span>
                <input class="mm-pip-seek" type="range" min="0" max="1000" step="1" value="0">
                <span class="mm-pip-time" data-role="dur">0:00</span>
            `;

            const playBtn = bar.querySelector('.mm-pip-play');
            const seek = bar.querySelector('.mm-pip-seek');
            const curEl = bar.querySelector('[data-role="cur"]');
            const durEl = bar.querySelector('[data-role="dur"]');
            let seeking = false;

            const sync = () => {
                const dur = video.duration;
                const cur = video.currentTime || 0;
                playBtn.textContent = video.paused ? '▶' : '❚❚';
                curEl.textContent = _fmtTime(cur);
                durEl.textContent = _fmtTime(dur);
                if (!seeking && Number.isFinite(dur) && dur > 0) {
                    seek.value = String(Math.round((cur / dur) * 1000));
                }
            };

            const seekTo = (ratio) => {
                const dur = video.duration;
                if (!Number.isFinite(dur) || dur <= 0) return;
                video.currentTime = Math.min(dur, Math.max(0, ratio * dur));
            };

            const showBar = () => bar.classList.add('show');
            const hideBar = () => {
                if (bar.matches(':hover') || seeking) return;
                bar.classList.remove('show');
            };

            const onPlay = () => sync();
            const onPause = () => sync();
            const onTime = () => sync();
            const onMeta = () => sync();
            const onClickStage = () => {
                if (video.paused) video.play().catch(() => {});
                else video.pause();
            };
            const onPlayClick = (e) => {
                e.stopPropagation();
                if (video.paused) video.play().catch(() => {});
                else video.pause();
            };
            const onSeekInput = () => {
                seeking = true;
                seekTo(Number(seek.value) / 1000);
                curEl.textContent = _fmtTime(video.currentTime);
            };
            const onSeekChange = () => {
                seekTo(Number(seek.value) / 1000);
                seeking = false;
                sync();
            };
            const onKey = (e) => {
                if (e.key === ' ' || e.code === 'Space') {
                    e.preventDefault();
                    if (video.paused) video.play().catch(() => {});
                    else video.pause();
                } else if (e.key === 'ArrowRight') {
                    video.currentTime = Math.min(video.duration || 0, (video.currentTime || 0) + 5);
                } else if (e.key === 'ArrowLeft') {
                    video.currentTime = Math.max(0, (video.currentTime || 0) - 5);
                }
            };

            video.addEventListener('play', onPlay);
            video.addEventListener('pause', onPause);
            video.addEventListener('timeupdate', onTime);
            video.addEventListener('durationchange', onMeta);
            video.addEventListener('loadedmetadata', onMeta);
            stage.addEventListener('click', onClickStage);
            playBtn.addEventListener('click', onPlayClick);
            seek.addEventListener('input', onSeekInput);
            seek.addEventListener('change', onSeekChange);
            doc.addEventListener('keydown', onKey);
            doc.addEventListener('mousemove', showBar);
            doc.addEventListener('mouseenter', showBar, true);
            doc.documentElement.addEventListener('mouseleave', hideBar);
            bar.addEventListener('mouseenter', showBar);
            bar.addEventListener('mouseleave', hideBar);

            stage.appendChild(video);
            root.appendChild(stage);
            root.appendChild(bar);
            doc.body.appendChild(root);
            sync();

            return () => {
                video.removeEventListener('play', onPlay);
                video.removeEventListener('pause', onPause);
                video.removeEventListener('timeupdate', onTime);
                video.removeEventListener('durationchange', onMeta);
                video.removeEventListener('loadedmetadata', onMeta);
                stage.removeEventListener('click', onClickStage);
                playBtn.removeEventListener('click', onPlayClick);
                seek.removeEventListener('input', onSeekInput);
                seek.removeEventListener('change', onSeekChange);
                doc.removeEventListener('keydown', onKey);
                doc.removeEventListener('mousemove', showBar);
                doc.removeEventListener('mouseenter', showBar, true);
                doc.documentElement.removeEventListener('mouseleave', hideBar);
                bar.removeEventListener('mouseenter', showBar);
                bar.removeEventListener('mouseleave', hideBar);
            };
        };

        const _applyVideoRotation = (el) => {
            if (!el || el.tagName !== 'VIDEO') return;
            const deg = _rotationDeg;
            const swap = deg === 90 || deg === 270;
            el.style.setProperty('transform', deg ? `rotate(${deg}deg)` : 'none', 'important');
            el.style.setProperty('transform-origin', 'center center', 'important');
            if (_pip.win && el === _pip.video) {
                if (swap) {
                    el.style.setProperty('width', '100vh', 'important');
                    el.style.setProperty('height', '100vw', 'important');
                    el.style.setProperty('max-width', 'none', 'important');
                    el.style.setProperty('max-height', 'none', 'important');
                } else {
                    el.style.setProperty('width', '100%', 'important');
                    el.style.setProperty('height', '100%', 'important');
                    el.style.setProperty('max-width', '100%', 'important');
                    el.style.setProperty('max-height', '100%', 'important');
                }
            }
        };

        const _notifyPipChange = () => {
            try { document.dispatchEvent(new CustomEvent('mm-pip-change')); } catch {}
        };

        const _closeDocPip = () => {
            const { video, parent, next, win, placeholder, videoStyle, unbind } = _pip;
            if (!video && !win && !placeholder) return;
            _pip.active = false;
            _pip.video = null;
            _pip.parent = null;
            _pip.next = null;
            _pip.win = null;
            _pip.placeholder = null;
            _pip.videoStyle = '';
            _pip.unbind = null;

            if (video) {
                try {
                    if (placeholder?.isConnected) placeholder.replaceWith(video);
                    else if (parent?.isConnected) {
                        if (next && next.parentNode === parent) parent.insertBefore(video, next);
                        else parent.appendChild(video);
                    }
                    if (videoStyle) video.setAttribute('style', videoStyle);
                    else video.removeAttribute('style');
                    _applyVideoRotation(video);
                } catch (e) {
                    console.warn('[MediaMaster] 还原画中画视频失败:', e);
                    try {
                        if (parent?.isConnected) parent.appendChild(video);
                    } catch {}
                }
            } else {
                placeholder?.remove();
            }

            try { unbind?.(); } catch {}
            _unmaskOriginalForPip();
            if (win && !win.closed) {
                try { win.close(); } catch {}
            }
            _notifyPipChange();
        };

        const _enterDocPip = async (video) => {
            const api = window.documentPictureInPicture;
            if (!api?.requestWindow) return { success: false, msg: 'no-doc-pip' };

            _closeDocPip();
            const parent = video.parentNode;
            if (!parent) return { success: false, msg: '无法获取视频容器' };

            const rect = video.getBoundingClientRect();
            const placeholder = document.createElement('div');
            placeholder.id = 'mm-pip-mask';
            placeholder.style.cssText = [
                `width:${Math.max(rect.width, 120)}px`,
                `height:${Math.max(rect.height, 80)}px`,
                'background:#0b0b10', 'display:flex', 'align-items:center',
                'justify-content:center', 'flex-direction:column', 'gap:10px',
                'color:rgba(255,255,255,0.72)',
                "font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
            ].join(';');
            placeholder.innerHTML = '<div style="font-size:28px;line-height:1">📺</div><div>画中画播放中</div><div style="font-size:12px;opacity:.45">关闭小窗后恢复</div>';
            parent.insertBefore(placeholder, video);

            const swap = _rotationDeg === 90 || _rotationDeg === 270;
            const vw = video.videoWidth || rect.width || 640;
            const vh = video.videoHeight || rect.height || 360;
            const pipW = Math.max(420, Math.round((swap ? vh : vw) * 0.5));
            const pipH = Math.max(260, Math.round((swap ? vw : vh) * 0.5) + 48);

            const win = await api.requestWindow({ width: pipW, height: pipH });
            const style = win.document.createElement('style');
            style.textContent = `
                html, body { margin:0; padding:0; width:100%; height:100%; background:#000; overflow:hidden; }
                .mm-pip-root { width:100%; height:100%; display:flex; flex-direction:column; background:#000; }
                .mm-pip-stage { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; background:#000; cursor:pointer; }
                .mm-pip-stage video { width:100% !important; height:100% !important; max-width:100% !important; max-height:100% !important; object-fit:contain !important; background:#000; }
                .mm-pip-bar {
                    display:flex; align-items:center; gap:8px;
                    padding:8px 12px 10px; background:linear-gradient(180deg, transparent, rgba(0,0,0,.82));
                    color:#fff; font:12px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    opacity:0; transform:translateY(8px); transition:opacity .2s, transform .2s;
                    position:absolute; left:0; right:0; bottom:0; z-index:5;
                }
                .mm-pip-root { position:relative; }
                .mm-pip-bar.show { opacity:1; transform:none; }
                .mm-pip-play {
                    width:28px; height:28px; border:0; border-radius:6px; cursor:pointer;
                    background:rgba(255,255,255,.08); color:#fff; font-size:12px;
                }
                .mm-pip-play:hover { background:rgba(124,124,248,.35); }
                .mm-pip-time { min-width:36px; opacity:.8; font-variant-numeric:tabular-nums; }
                .mm-pip-seek { flex:1; height:4px; appearance:none; background:rgba(255,255,255,.18); border-radius:4px; outline:none; cursor:pointer; }
                .mm-pip-seek::-webkit-slider-thumb {
                    appearance:none; width:12px; height:12px; border-radius:50%;
                    background:#fbbf24; border:0; cursor:pointer;
                }
            `;
            win.document.head.appendChild(style);

            const videoStyle = video.getAttribute('style') || '';
            const unbind = _mountPipControls(win, video);
            _applyVideoRotation(video);

            _pip.active = true;
            _pip.video = video;
            _pip.parent = parent;
            _pip.next = placeholder.nextSibling;
            _pip.win = win;
            _pip.placeholder = placeholder;
            _pip.videoStyle = videoStyle;
            _pip.unbind = unbind;

            win.addEventListener('pagehide', () => { _closeDocPip(); });
            _notifyPipChange();
            return { success: true };
        };

        document.addEventListener('leavepictureinpicture', () => {
            _unmaskOriginalForPip();
        });

        const _CONTROL_HINT = [
            '[class*="control"]', '[class*="ctrlbar"]', '[class*="ctrl-bar"]',
            '[class*="dashboard"]', '[class*="progress"]', '[class*="toolbar"]',
            '[class*="bottom-bar"]', '[class*="controlbar"]',
            '[class*="kui-"]', '[class*="h5-ctrl"]', '[class*="h5player"]',
            '.kui-dashboard', '.h5player-dashboard', '#module_playbar', '[role="slider"]'
        ].join(',');

        const _hasControlBar = (root, video) => {
            if (!root || root === video) return false;
            const nodes = root.querySelectorAll(_CONTROL_HINT);
            for (const n of nodes) {
                if (n !== video && !video.contains(n)) return true;
            }
            return false;
        };

        const _markFloatingControls = (video, root) => {
            const keep = [];
            document.querySelectorAll(_CONTROL_HINT).forEach(el => {
                if (root.contains(el) || el.contains(video)) return;
                if (el.id === 'mm-panel' || el.closest('#mm-panel')) return;
                const st = getComputedStyle(el);
                const floating = ['fixed', 'absolute', 'sticky'].includes(st.position)
                    || el.parentElement === document.body;
                if (!floating) return;
                const r = el.getBoundingClientRect();
                const w = Math.max(r.width, el.offsetWidth, 0);
                if (w < 80 && el.parentElement !== document.body) return;
                el.classList.add('mm-fs-keep');
                keep.push(el);
            });
            return keep;
        };

        const _hideOtherBranches = (root) => {
            const hidden = [];
            let node = root;
            while (node && node !== document.documentElement) {
                const parent = node.parentElement;
                if (!parent) break;
                for (const sib of [...parent.children]) {
                    if (sib === node) continue;
                    if (sib.id === 'mm-panel' || sib.id === 'mm-styles' || sib.id === FS_STYLE_ID) continue;
                    if (sib.classList.contains('mm-fs-keep') || sib.id === 'mm-fs-bar') continue;
                    if (sib.tagName === 'SCRIPT' || sib.tagName === 'STYLE' || sib.tagName === 'LINK') continue;
                    const token = `${sib.className || ''} ${sib.id || ''}`.toLowerCase();
                    if (/control|ctrlbar|dashboard|progress|toolbar|playbar|kui-|h5-ctrl|h5player/.test(token)) {
                        sib.classList.add('mm-fs-keep');
                        continue;
                    }
                    hidden.push({
                        el: sib,
                        vis: sib.style.getPropertyValue('visibility'),
                        visPri: sib.style.getPropertyPriority('visibility'),
                        pe: sib.style.getPropertyValue('pointer-events'),
                        pePri: sib.style.getPropertyPriority('pointer-events')
                    });
                    sib.style.setProperty('visibility', 'hidden', 'important');
                    sib.style.setProperty('pointer-events', 'none', 'important');
                }
                node = parent;
            }
            return hidden;
        };

        const _unlockAncestors = (root) => {
            const saved = [];
            let node = root.parentElement;
            while (node && node !== document.documentElement) {
                saved.push({ el: node, css: node.getAttribute('style') || '' });
                node.style.setProperty('transform', 'none', 'important');
                node.style.setProperty('filter', 'none', 'important');
                node.style.setProperty('perspective', 'none', 'important');
                node.style.setProperty('contain', 'none', 'important');
                node.style.setProperty('clip-path', 'none', 'important');
                node.style.setProperty('overflow', 'visible', 'important');
                node = node.parentElement;
            }
            return saved;
        };

        // 找到包含控件的播放器外壳，避免只挪 <video> 导致进度条丢失
        const _findPlayerRoot = (video) => {
            const selectors = [
                '#ykPlayer', '#youkuplayer', '.yk-player', '.youku-player',
                '.youku-film-player', '.kui-player', '.h5-player', '.h5player',
                '.mgp', '.mgp_container', '.mgp_player',
                '#player', '#video-player',
                '.html5-video-player',
                '.bpx-player-container', '.bilibili-player',
                '.xgplayer', '.dplayer', '.jwplayer', '.video-js',
                '.artplayer', '.plyr', '.fp-player',
                '[class*="player-container"]', '[class*="player-wrapper"]',
                '[class*="video-player"]', '.html5-video-container'
            ];

            const vr = video.getBoundingClientRect();
            const vw = Math.max(video.clientWidth, vr.width);
            const vh = Math.max(video.clientHeight, vr.height);
            const tooHuge = (el) => {
                const r = el.getBoundingClientRect();
                return r.width > innerWidth * 0.98 && r.height > innerHeight * 0.92;
            };

            let withControls = null;
            for (const sel of selectors) {
                const hit = video.closest(sel);
                if (!hit || hit === document.body || hit === document.documentElement) continue;
                if (tooHuge(hit)) continue;
                if (_hasControlBar(hit, video)) withControls = hit;
            }
            if (withControls) return withControls;

            let node = video.parentElement;
            let best = video;
            for (let i = 0; i < 12 && node && node !== document.body && node !== document.documentElement; i++) {
                const r = node.getBoundingClientRect();
                if (r.width < 16 || r.height < 16) {
                    node = node.parentElement;
                    continue;
                }
                if (tooHuge(node)) break;
                const stillPlayer = r.width <= Math.max(vw * 1.35, vw + 64)
                    && r.height <= Math.max(vh * 2.1, vh + 180);
                const compactPage = r.width <= innerWidth * 0.98
                    && r.height <= innerHeight * 0.92
                    && (r.width * r.height) / Math.max(vw * vh, 1) < 5;
                if (stillPlayer || compactPage) {
                    if (_hasControlBar(node, video)) withControls = node;
                    best = node;
                    node = node.parentElement;
                    continue;
                }
                if (_hasControlBar(node, video) && r.height <= innerHeight) {
                    withControls = node;
                }
                break;
            }
            return withControls || best;
        };

        const _maskOriginalForPip = (source) => {
            _unmaskOriginalForPip();
            if (!source) return;

            const host = document.getElementById(FS_ID)
                || _findPlayerRoot(source)
                || source.parentElement
                || source;
            const pos = getComputedStyle(host).position;
            if (pos === 'static') {
                _pipMask.pos = 'static';
                host.style.position = 'relative';
            } else {
                _pipMask.pos = '';
            }

            const mask = document.createElement('div');
            mask.id = 'mm-pip-mask';
            mask.style.cssText = [
                'position:absolute', 'inset:0', 'z-index:2147483645',
                'background:#0b0b10', 'display:flex', 'align-items:center',
                'justify-content:center', 'flex-direction:column', 'gap:10px',
                'color:rgba(255,255,255,0.72)',
                "font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
                'pointer-events:none', 'letter-spacing:0.3px'
            ].join(';');
            mask.innerHTML = '<div style="font-size:28px;line-height:1">📺</div><div>画中画播放中</div><div style="font-size:12px;opacity:.45">关闭小窗后恢复</div>';
            host.appendChild(mask);
            _pipMask.source = source;
            _pipMask.host = host;
            _pipMask.el = mask;
        };

        const _unmaskOriginalForPip = () => {
            document.querySelectorAll('video').forEach(el => {
                if (el.style.getPropertyValue('opacity') === '0'
                    && el.style.getPropertyPriority('opacity') === 'important') {
                    el.style.removeProperty('opacity');
                }
            });
            if (_pipMask.host && _pipMask.pos === 'static') {
                _pipMask.host.style.position = '';
            }
            _pipMask.el?.remove();
            document.getElementById('mm-pip-mask')?.remove();
            _pipMask.source = null;
            _pipMask.host = null;
            _pipMask.pos = '';
            _pipMask.el = null;
        };

        const _injectFsStyle = () => {
            if (document.getElementById(FS_STYLE_ID)) return;
            const css = document.createElement('style');
            css.id = FS_STYLE_ID;
            css.textContent = `
                html.${FS_CLASS},
                html.${FS_CLASS} body {
                    overflow: hidden !important;
                    transform: none !important;
                    filter: none !important;
                    perspective: none !important;
                    contain: none !important;
                    clip: auto !important;
                    clip-path: none !important;
                    will-change: auto !important;
                }
                html.${FS_CLASS} .mm-fs-player {
                    position: fixed !important;
                    inset: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    max-width: none !important;
                    max-height: none !important;
                    z-index: 2147483645 !important;
                    background: #000 !important;
                    margin: 0 !important;
                    transform: none !important;
                    visibility: visible !important;
                    pointer-events: auto !important;
                }
                html.${FS_CLASS} .mm-fs-keep,
                html.${FS_CLASS} .mm-fs-player [class*="control"],
                html.${FS_CLASS} .mm-fs-player [class*="ctrlbar"],
                html.${FS_CLASS} .mm-fs-player [class*="dashboard"],
                html.${FS_CLASS} .mm-fs-player [class*="progress"],
                html.${FS_CLASS} .mm-fs-player [class*="toolbar"],
                html.${FS_CLASS} .mm-fs-player [class*="kui-"] {
                    z-index: 2147483646 !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                    pointer-events: auto !important;
                    transform: none !important;
                }
                html.${FS_CLASS} #mm-panel {
                    z-index: 2147483647 !important;
                    visibility: visible !important;
                    pointer-events: auto !important;
                }
                #mm-fs-bar {
                    position: fixed !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
                    z-index: 2147483646 !important; display: flex !important; align-items: center !important;
                    gap: 10px !important; padding: 12px 16px 16px !important;
                    background: linear-gradient(180deg, transparent, rgba(0,0,0,.78)) !important;
                    color: #fff !important; font: 13px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
                    opacity: 0 !important; transform: translateY(16px) !important;
                    pointer-events: none !important; transition: opacity .2s ease, transform .2s ease !important;
                }
                #mm-fs-bar.show {
                    opacity: 1 !important; transform: none !important; pointer-events: auto !important;
                }
                #mm-fs-bar button {
                    width: 32px; height: 32px; border: 0; border-radius: 8px; cursor: pointer;
                    background: rgba(255,255,255,.1); color: #fff; font-size: 13px;
                }
                #mm-fs-bar .mm-fs-time { min-width: 40px; opacity: .85; font-variant-numeric: tabular-nums; }
                #mm-fs-bar input[type="range"] {
                    flex: 1; height: 5px; appearance: none; background: rgba(255,255,255,.2);
                    border-radius: 5px; outline: none; cursor: pointer;
                }
                #mm-fs-bar input[type="range"]::-webkit-slider-thumb {
                    appearance: none; width: 14px; height: 14px; border-radius: 50%;
                    background: #fbbf24; border: 0; cursor: pointer;
                }
            `;
            document.documentElement.appendChild(css);
        };

        const _restoreFsPlace = () => {
            window.__MM_FS_ACTIVE = false;
            _fs.hidden.forEach(({ el, vis, visPri, pe, pePri }) => {
                if (vis) el.style.setProperty('visibility', vis, visPri || undefined);
                else el.style.removeProperty('visibility');
                if (pe) el.style.setProperty('pointer-events', pe, pePri || undefined);
                else el.style.removeProperty('pointer-events');
            });
            _fs.ancestorStyles.forEach(({ el, css }) => {
                if (css) el.setAttribute('style', css);
                else el.removeAttribute('style');
            });
            if (_fs.video) {
                if (_fs.videoStyle) _fs.video.setAttribute('style', _fs.videoStyle);
                else _fs.video.removeAttribute('style');
            }
            if (_fs.root) {
                _fs.root.classList.remove('mm-fs-player');
                if (_fs.rootStyle) _fs.root.setAttribute('style', _fs.rootStyle);
                else _fs.root.removeAttribute('style');
            }
            _fs.keep.forEach(el => el.classList.remove('mm-fs-keep'));
            try { _fs.unbindBar?.(); } catch {}
            _fs.bar?.remove();
            document.documentElement.classList.remove(FS_CLASS);
            _fs = {
                active: false,
                video: null,
                root: null,
                videoStyle: '',
                rootStyle: '',
                ancestorStyles: [],
                hidden: [],
                keep: [],
                bar: null,
                unbindBar: null
            };
            document.dispatchEvent(new CustomEvent('mm-fs-change'));
        };

        const _applyFillStyle = (el, isVideo, keepOverlay) => {
            el.style.setProperty('width', '100%', 'important');
            el.style.setProperty('max-width', 'none', 'important');
            el.style.setProperty('max-height', 'none', 'important');
            el.style.setProperty('margin', '0', 'important');
            el.style.setProperty('border', 'none', 'important');
            if (!isVideo) {
                el.style.setProperty('height', '100%', 'important');
                el.style.setProperty('display', 'block', 'important');
                el.style.setProperty('position', 'relative', 'important');
                el.style.setProperty('overflow', keepOverlay ? 'visible' : 'hidden', 'important');
                el.style.setProperty('inset', 'auto', 'important');
            } else {
                el.style.setProperty('object-fit', 'contain', 'important');
                el.style.setProperty('display', 'block', 'important');
                if (!keepOverlay) el.style.setProperty('height', '100%', 'important');
            }
        };

        const _mountFsBar = (video) => {
            document.getElementById('mm-fs-bar')?.remove();
            const bar = document.createElement('div');
            bar.id = 'mm-fs-bar';
            bar.innerHTML = `
                <button type="button" data-role="play">❚❚</button>
                <span class="mm-fs-time" data-role="cur">0:00</span>
                <input type="range" min="0" max="1000" step="1" value="0">
                <span class="mm-fs-time" data-role="dur">0:00</span>
            `;
            const playBtn = bar.querySelector('[data-role="play"]');
            const seek = bar.querySelector('input');
            const curEl = bar.querySelector('[data-role="cur"]');
            const durEl = bar.querySelector('[data-role="dur"]');
            let seeking = false;

            const sync = () => {
                const dur = video.duration;
                const cur = video.currentTime || 0;
                playBtn.textContent = video.paused ? '▶' : '❚❚';
                curEl.textContent = _fmtTime(cur);
                durEl.textContent = _fmtTime(dur);
                if (!seeking && Number.isFinite(dur) && dur > 0) {
                    seek.value = String(Math.round((cur / dur) * 1000));
                }
            };
            const seekTo = (ratio) => {
                const dur = video.duration;
                if (!Number.isFinite(dur) || dur <= 0) return;
                video.currentTime = Math.min(dur, Math.max(0, ratio * dur));
            };
            const onPlayClick = () => {
                if (video.paused) video.play().catch(() => {});
                else video.pause();
            };
            const onSeekInput = () => {
                seeking = true;
                seekTo(Number(seek.value) / 1000);
                curEl.textContent = _fmtTime(video.currentTime);
            };
            const onSeekChange = () => {
                seekTo(Number(seek.value) / 1000);
                seeking = false;
                sync();
            };

            video.addEventListener('play', sync);
            video.addEventListener('pause', sync);
            video.addEventListener('timeupdate', sync);
            video.addEventListener('durationchange', sync);
            playBtn.addEventListener('click', onPlayClick);
            seek.addEventListener('input', onSeekInput);
            seek.addEventListener('change', onSeekChange);

            const showBar = () => bar.classList.add('show');
            const hideBar = () => {
                if (bar.matches(':hover') || seeking) return;
                bar.classList.remove('show');
            };
            document.addEventListener('mousemove', showBar);
            document.addEventListener('mouseenter', showBar, true);
            document.documentElement.addEventListener('mouseleave', hideBar);
            bar.addEventListener('mouseenter', showBar);
            bar.addEventListener('mouseleave', hideBar);

            document.body.appendChild(bar);
            sync();

            return {
                bar,
                unbind() {
                    video.removeEventListener('play', sync);
                    video.removeEventListener('pause', sync);
                    video.removeEventListener('timeupdate', sync);
                    video.removeEventListener('durationchange', sync);
                    playBtn.removeEventListener('click', onPlayClick);
                    seek.removeEventListener('input', onSeekInput);
                    seek.removeEventListener('change', onSeekChange);
                    document.removeEventListener('mousemove', showBar);
                    document.removeEventListener('mouseenter', showBar, true);
                    document.documentElement.removeEventListener('mouseleave', hideBar);
                    bar.removeEventListener('mouseenter', showBar);
                    bar.removeEventListener('mouseleave', hideBar);
                    bar.remove();
                }
            };
        };

        // ============ 窗口全屏（视频充满当前窗口，压住页面其它层） ============
        const toggleWindowFullscreen = async () => {
            try {
                if (_fs.active) {
                    _restoreFsPlace();
                    return { success: true, msg: '已退出窗口全屏', isFullscreen: false };
                }

                const videos = _getVideos();
                let target = Array.from(videos).find(el => !el.paused && el.currentTime > 0 && !el.ended);
                if (!target) target = videos[0];
                if (!target) return { success: false, msg: '未找到视频' };

                const root = _findPlayerRoot(target);
                if (!root) return { success: false, msg: '无法获取视频容器' };

                _injectFsStyle();
                const keep = _markFloatingControls(target, root);
                const ancestorStyles = _unlockAncestors(root);
                const hidden = _hideOtherBranches(root);

                _fs = {
                    active: true,
                    video: target,
                    root,
                    videoStyle: target.getAttribute('style') || '',
                    rootStyle: root.getAttribute('style') || '',
                    ancestorStyles,
                    hidden,
                    keep
                };

                root.classList.add('mm-fs-player');
                target.style.setProperty('width', '100%', 'important');
                target.style.setProperty('height', '100%', 'important');
                target.style.setProperty('max-width', 'none', 'important');
                target.style.setProperty('max-height', 'none', 'important');
                target.style.setProperty('object-fit', 'contain', 'important');
                document.documentElement.classList.add(FS_CLASS);
                window.__MM_FS_ACTIVE = true;

                const mounted = _mountFsBar(target);
                _fs.bar = mounted.bar;
                _fs.unbindBar = mounted.unbind;

                document.dispatchEvent(new CustomEvent('mm-fs-change'));
                return { success: true, msg: '已进入窗口全屏', isFullscreen: true };
            } catch (err) {
                console.warn('[MediaMaster] 窗口全屏失败:', err);
                if (_fs.active) _restoreFsPlace();
                return { success: false, msg: err.message || '窗口全屏切换失败' };
            }
        };

        const isWindowFullscreen = () => _fs.active;

        const cleanupFullscreen = () => {
            if (_fs.active) _restoreFsPlace();
        };

        return {
            setSpeed: (val) => {
                if (val <= 0) return;
                _getAll().forEach(el => { el.playbackRate = val; });
            },
            setGain: (val) => {
                if (val < 0) return;
                _getAll().forEach(el => {
                    if (val > 0) _unmute(el);
                    _resumeCtx(el);
                    if (val <= 1) {
                        el.volume = val;
                        const g = _cache.get(el);
                        if (g) g.gain.value = 1;
                    } else {
                        el.volume = 1;
                        const g = _ensureGain(el);
                        if (g) g.gain.value = val;
                    }
                });
            },
            setRotation: (deg) => {
                _rotationDeg = ((Number(deg) || 0) % 360 + 360) % 360;
                _getVideos().forEach(_applyVideoRotation);
                if (_pip.video) _applyVideoRotation(_pip.video);
            },
            togglePiP: async () => {
                const videos = _getVideos();
                let target = videos.find(el => !el.paused && el.currentTime > 0 && !el.ended);
                if (!target) target = videos[0];

                const inMediaPiP = !!document.pictureInPictureElement
                    || target?.webkitPresentationMode === 'picture-in-picture';
                const inDocPiP = !!(_pip.active || _pip.win || window.documentPictureInPicture?.window);

                if (!target && !inMediaPiP && !inDocPiP) {
                    return { success: false, msg: '未找到视频' };
                }

                try {
                    if (inMediaPiP || inDocPiP) {
                        if (inDocPiP) _closeDocPip();
                        if (document.pictureInPictureElement) {
                            await document.exitPictureInPicture();
                        } else if (target?.webkitSetPresentationMode && target.webkitPresentationMode === 'picture-in-picture') {
                            target.webkitSetPresentationMode('inline');
                        }
                        _unmaskOriginalForPip();
                        return { success: true, msg: '已退出画中画', inPiP: false };
                    }

                    if (document.fullscreenElement) {
                        document.exitFullscreen().catch(() => {});
                    } else if (document.webkitFullscreenElement) {
                        document.webkitExitFullscreen?.();
                    }

                    const docPip = await _enterDocPip(target);
                    if (docPip.success) return { success: true, msg: '已进入画中画', inPiP: true };

                    if (document.pictureInPictureEnabled === false
                        && typeof target.webkitSetPresentationMode !== 'function') {
                        return { success: false, msg: '当前页面不允许画中画' };
                    }

                    await _enterPiP(target);
                    _maskOriginalForPip(target);
                    return { success: true, msg: '已进入画中画', inPiP: true };
                } catch (err) {
                    _closeDocPip();
                    _unmaskOriginalForPip();
                    return { success: false, msg: _pipErrorMsg(err) };
                }
            },
            // 窗口全屏
            toggleWindowFullscreen: async () => {
                return await toggleWindowFullscreen();
            },
            isPiPActive: () => {
                return !!(document.pictureInPictureElement
                    || _pip.active
                    || window.documentPictureInPicture?.window);
            },
            isWindowFullscreen: () => {
                return isWindowFullscreen();
            },
            cleanupFullscreen: cleanupFullscreen,
            getActiveVideo: () => {
                const videos = _getVideos();
                let target = Array.from(videos).find(el => !el.paused && el.currentTime > 0 && !el.ended);
                if (!target) target = videos[0];
                return target || null;
            },
            getInfo: () => {
                const list = _getAll();
                if (!list.length) return null;
                const target = Array.from(list).find(el => !el.paused && el.currentTime > 0) || list[0];
                const gain = _cache.get(target)?.gain.value ?? 1;
                const pipAllowed = target.tagName !== 'VIDEO'
                    || document.pictureInPictureEnabled !== false
                    || typeof target.webkitSetPresentationMode === 'function';
                return {
                    total: list.length,
                    speed: target.playbackRate,
                    volume: Math.round(target.volume * gain * 100) / 100,
                    muted: target.muted,
                    paused: target.paused,
                    rotation: _rotationDeg,
                    isPiP: !!(document.pictureInPictureElement || _pip.active || window.documentPictureInPicture?.window),
                    isWindowFullscreen: _fs.active,
                    pipAllowed: pipAllowed
                };
            }
        };
    })();

    window.__MM_FS_TOGGLE = () => { MediaEngine.toggleWindowFullscreen(); };

    // ============================================================
    // 模块3: 浮动面板 UI
    // ============================================================
    const PanelUI = (() => {
        let _panel = null;
        let _visible = false;
        let _closed = false;
        let _speed = 1;
        let _gain = 1;
        let _rotation = 0;
        let _statusTimer = null;

        // --- 样式注入 ---
        const _injectStyles = () => {
            if (document.getElementById('mm-styles')) return;
            const css = document.createElement('style');
            css.id = 'mm-styles';
            css.textContent = `
                .mm-overlay {
                    position: fixed; bottom: 28px; right: 28px;
                    z-index: 2147483647;
                    width: 280px;
                    background: rgba(18,18,26,0.95);
                    backdrop-filter: blur(20px);
                    -webkit-backdrop-filter: blur(20px);
                    border: 1px solid rgba(255,255,255,0.07);
                    border-radius: 20px;
                    padding: 20px 22px 16px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    color: #eaeef2;
                    box-shadow: 0 20px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04);
                    user-select: none;
                    transition: opacity 0.2s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                    transform-origin: bottom right;
                }
                .mm-overlay.mm-hidden {
                    opacity: 0;
                    transform: scale(0.92) translateY(12px);
                    pointer-events: none;
                }
                .mm-drag {
                    position: absolute; top: 0; left: 0; right: 0; height: 44px;
                    border-radius: 20px 20px 0 0;
                    cursor: grab;
                    z-index: 10;
                }
                .mm-drag:active { cursor: grabbing; }
                .mm-drag::after {
                    content: '';
                    position: absolute; top: 12px; left: 50%;
                    transform: translateX(-50%);
                    width: 44px; height: 3px;
                    border-radius: 4px;
                    background: rgba(255,255,255,0.06);
                    transition: background 0.25s;
                }
                .mm-drag:hover::after { background: rgba(255,255,255,0.14); }
                .mm-header {
                    display: flex; align-items: center; justify-content: space-between;
                    margin-bottom: 16px; padding-top: 4px;
                    pointer-events: none;
                }
                .mm-header h3 {
                    font-size: 15px; font-weight: 600; letter-spacing: 0.3px;
                    margin: 0; color: #f0f2f5;
                }
                .mm-header .tag {
                    font-size: 10px; font-weight: 400;
                    background: rgba(255,255,255,0.06);
                    padding: 3px 12px; border-radius: 30px;
                    color: rgba(255,255,255,0.35);
                    max-width: 100px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .mm-row { margin: 10px 0 12px; }
                .mm-row-label {
                    display: flex; justify-content: space-between;
                    font-size: 12px; font-weight: 500;
                    color: rgba(255,255,255,0.5);
                    margin-bottom: 5px;
                }
                .mm-row-label .val { color: #fff; font-weight: 600; }
                .mm-row-label .val.gold { color: #fbbf24; }
                .mm-row-label .val.cyan { color: #5eead4; }
                .mm-slider {
                    -webkit-appearance: none; appearance: none;
                    width: 100%; height: 4px; border-radius: 4px;
                    background: rgba(255,255,255,0.08);
                    outline: none; margin: 4px 0;
                }
                .mm-slider::-webkit-slider-track {
                    -webkit-appearance: none; height: 4px; border-radius: 4px;
                    background: rgba(255,255,255,0.08);
                }
                .mm-slider::-webkit-slider-thumb {
                    -webkit-appearance: none; appearance: none;
                    width: 17px; height: 17px; border-radius: 50%;
                    background: linear-gradient(135deg, #7c7cf8, #5b5bef);
                    cursor: pointer; border: 2px solid rgba(255,255,255,0.10);
                    box-shadow: 0 2px 12px rgba(91,91,239,0.35);
                    transition: transform 0.15s, box-shadow 0.15s;
                }
                .mm-slider::-webkit-slider-thumb:hover { transform: scale(1.12); box-shadow: 0 4px 20px rgba(91,91,239,0.5); }
                .mm-slider::-moz-range-track { height: 4px; border-radius: 4px; background: rgba(255,255,255,0.08); border: none; }
                .mm-slider::-moz-range-thumb {
                    width: 17px; height: 17px; border-radius: 50%;
                    background: linear-gradient(135deg, #7c7cf8, #5b5bef);
                    cursor: pointer; border: 2px solid rgba(255,255,255,0.10);
                }
                .mm-slider.gold::-webkit-slider-thumb {
                    background: linear-gradient(135deg, #fbbf24, #f59e0b);
                    box-shadow: 0 2px 12px rgba(245,158,11,0.35);
                }
                .mm-slider.gold::-moz-range-thumb {
                    background: linear-gradient(135deg, #fbbf24, #f59e0b);
                    box-shadow: 0 2px 12px rgba(245,158,11,0.35);
                }
                .mm-status {
                    font-size: 11px; color: rgba(255,255,255,0.30);
                    text-align: center; padding: 10px 0 4px;
                    border-top: 1px solid rgba(255,255,255,0.04);
                    margin-top: 6px; line-height: 1.6;
                }
                .mm-status .hl { color: rgba(255,255,255,0.55); }
                .mm-status .pip-active {
                    color: #5eead4 !important;
                    font-weight: 500 !important;
                }
                .mm-status .pip-blocked {
                    color: #f87171 !important;
                    font-weight: 400 !important;
                }
                .mm-status .fullscreen-active {
                    color: #fbbf24 !important;
                    font-weight: 500 !important;
                }

                /* 工具按钮组 */
                .mm-tools-group {
                    display: flex !important;
                    align-items: center !important;
                    justify-content: space-between !important;
                    margin: 6px 0 2px !important;
                    padding: 4px 0 !important;
                    flex-wrap: wrap !important;
                    gap: 3px !important;
                }
                .mm-tools-group .label {
                    font-size: 12px !important;
                    font-weight: 500 !important;
                    color: rgba(255,255,255,0.5) !important;
                }
                .mm-tools-group .badge {
                    font-size: 11px !important;
                    font-weight: 600 !important;
                    color: #5eead4 !important;
                    min-width: 44px !important;
                    text-align: center !important;
                }
                .mm-tool-btn {
                    padding: 3px 8px !important;
                    border: none !important;
                    border-radius: 6px !important;
                    font-size: 11px !important;
                    font-weight: 500 !important;
                    cursor: pointer !important;
                    font-family: inherit !important;
                    background: rgba(255,255,255,0.05) !important;
                    color: rgba(255,255,255,0.45) !important;
                    transition: all 0.2s !important;
                    line-height: 1.6 !important;
                    white-space: nowrap !important;
                }
                .mm-tool-btn:hover {
                    background: rgba(255,255,255,0.12) !important;
                    color: #fff !important;
                }
                .mm-tool-btn.active {
                    background: rgba(94, 234, 212, 0.15) !important;
                    color: #5eead4 !important;
                }
                .mm-tool-btn.active:hover {
                    background: rgba(94, 234, 212, 0.25) !important;
                }
                .mm-tool-btn.rotate-btn {
                    background: rgba(94, 234, 212, 0.08) !important;
                    color: #5eead4 !important;
                }
                .mm-tool-btn.rotate-btn:hover {
                    background: rgba(94, 234, 212, 0.20) !important;
                }
                .mm-tool-btn.pip-btn {
                    background: rgba(124, 124, 248, 0.08) !important;
                    color: #9b9bf8 !important;
                }
                .mm-tool-btn.pip-btn:hover {
                    background: rgba(124, 124, 248, 0.20) !important;
                }
                .mm-tool-btn.pip-btn.active {
                    background: rgba(124, 124, 248, 0.25) !important;
                    color: #c4c4ff !important;
                }
                .mm-tool-btn.pip-btn.disabled {
                    opacity: 0.4 !important;
                    cursor: not-allowed !important;
                }
                /* 窗口全屏按钮 - 黄色系 */
                .mm-tool-btn.window-fullscreen-btn {
                    background: rgba(251, 191, 36, 0.08) !important;
                    color: #fbbf24 !important;
                }
                .mm-tool-btn.window-fullscreen-btn:hover {
                    background: rgba(251, 191, 36, 0.20) !important;
                }
                .mm-tool-btn.window-fullscreen-btn.active {
                    background: rgba(251, 191, 36, 0.25) !important;
                    color: #fcd34d !important;
                }
                .mm-tool-btn.reset-rotate {
                    background: rgba(255,255,255,0.04) !important;
                    color: rgba(255,255,255,0.25) !important;
                    font-size: 10px !important;
                    padding: 3px 6px !important;
                }
                .mm-tool-btn.reset-rotate:hover {
                    background: rgba(255,255,255,0.10) !important;
                    color: #fff !important;
                }

                /* 底部按钮区域 */
                .mm-actions {
                    display: flex !important;
                    justify-content: center !important;
                    gap: 8px !important;
                    margin-top: 10px !important;
                    padding-top: 10px !important;
                    border-top: 1px solid rgba(255,255,255,0.04) !important;
                }
                .mm-btn {
                    padding: 5px 18px !important;
                    border: none !important;
                    border-radius: 8px !important;
                    font-size: 12px !important;
                    font-weight: 500 !important;
                    cursor: pointer !important;
                    font-family: inherit !important;
                    background: rgba(255,255,255,0.05) !important;
                    color: rgba(255,255,255,0.45) !important;
                    transition: all 0.2s !important;
                }
                .mm-btn:hover { background: rgba(255,255,255,0.10) !important; color: #fff !important; }
                .mm-btn.primary {
                    background: rgba(91,91,239,0.18) !important;
                    color: #9b9bf8 !important;
                }
                .mm-btn.primary:hover { background: rgba(91,91,239,0.30) !important; color: #c4c4ff !important; }

                /* 快捷键脚注 */
                .mm-footer {
                    text-align: center !important;
                    margin-top: 10px !important;
                    padding-top: 8px !important;
                    border-top: 1px solid rgba(255,255,255,0.03) !important;
                    font-size: 10px !important;
                    color: rgba(255,255,255,0.18) !important;
                    letter-spacing: 0.3px !important;
                    font-weight: 400 !important;
                    line-height: 1.8 !important;
                }
                .mm-footer kbd {
                    display: inline-block !important;
                    padding: 0 7px !important;
                    font-size: 10px !important;
                    font-weight: 500 !important;
                    font-family: 'SF Mono', 'Fira Code', monospace !important;
                    color: rgba(255,255,255,0.35) !important;
                    background: rgba(255,255,255,0.05) !important;
                    border-radius: 4px !important;
                    border: 1px solid rgba(255,255,255,0.04) !important;
                    letter-spacing: 0.2px !important;
                }
            `;
            document.head.appendChild(css);
        };

        const _updateStatus = (el) => {
            const info = MediaEngine.getInfo();
            if (!el) el = _panel?.querySelector('#mm-status');
            if (!el) return;
            if (!info) {
                el.innerHTML = '📭 未检测到媒体';
                return;
            }
            const icon = info.paused ? '⏸' : '▶';
            const rotText = info.rotation > 0 ? ` 🔄${info.rotation}°` : '';
            const pipText = info.isPiP ? ' <span class="pip-active">📺 画中画</span>' : '';
            const fsText = info.isWindowFullscreen ? ' <span class="fullscreen-active">🖥 窗口全屏</span>' : '';
            const blockedText = (!info.pipAllowed && !info.isPiP) ? ' <span class="pip-blocked">🚫 画中画禁用</span>' : '';
            el.innerHTML = `<span class="hl">${info.total}</span> 个 · ${icon} ${info.paused ? '暂停' : '播放中'}${info.muted ? ' 🔇' : ''}${rotText}${pipText}${fsText}${blockedText}<br>🔊 音量 ${info.volume.toFixed(2)}`;
        };

        const _startStatusLoop = () => {
            if (_statusTimer) clearInterval(_statusTimer);
            _statusTimer = setInterval(() => {
                if (_visible && _panel) {
                    _updateStatus();
                    _syncButtons();
                }
            }, 2000);
        };

        const _syncButtons = () => {
            const pipBtn = _panel?.querySelector('#mm-pip-btn');
            const fsBtn = _panel?.querySelector('#mm-window-fullscreen-btn');
            const info = MediaEngine.getInfo();
            const isActive = MediaEngine.isPiPActive();
            const isFsActive = MediaEngine.isWindowFullscreen();
            const isBlocked = info && !info.pipAllowed && !isActive;

            if (pipBtn) {
                if (isActive) {
                    pipBtn.classList.add('active');
                    pipBtn.classList.remove('disabled');
                    pipBtn.textContent = '📺 退出画中画';
                } else if (isBlocked) {
                    pipBtn.classList.remove('active');
                    pipBtn.classList.add('disabled');
                    pipBtn.textContent = '🚫 画中画禁用';
                } else {
                    pipBtn.classList.remove('active', 'disabled');
                    pipBtn.textContent = '📺 画中画';
                }
            }

            if (fsBtn) {
                if (isFsActive) {
                    fsBtn.classList.add('active');
                    fsBtn.textContent = '🖥 退出全屏';
                } else {
                    fsBtn.classList.remove('active');
                    fsBtn.textContent = '🖥 窗口全屏';
                }
            }
        };

        const _render = () => {
            if (_panel) return;

            _injectStyles();

            const saved = StorageEngine.load();
            _speed = saved.speed;
            _gain = saved.gain;
            _rotation = saved.rotation ?? 0;

            const site = location.hostname.replace(/^www\./, '');
            const volText = Math.round(_gain * 100) + '%' + (_gain > 1 ? ` <span class="val gold">+${(_gain - 1).toFixed(1)}×</span>` : '');
            const rotationLabels = ['0°', '90°', '180°', '270°'];
            const rotationIndex = [0, 90, 180, 270].indexOf(_rotation);
            const currentRotLabel = rotationLabels[rotationIndex >= 0 ? rotationIndex : 0];

            _panel = document.createElement('div');
            _panel.className = 'mm-overlay';
            _panel.id = 'mm-panel';
            _panel.innerHTML = `
                <div class="mm-drag" id="mm-drag"></div>
                <div class="mm-header">
                    <h3>🎛 媒体大师</h3>
                    <span class="tag" title="${location.hostname}">${site}</span>
                </div>
                <div class="mm-row">
                    <div class="mm-row-label"><span>⚡ 倍速</span><span class="val" id="mm-speed-label">${_speed.toFixed(2)}×</span></div>
                    <input type="range" class="mm-slider" id="mm-speed" min="0.25" max="4" step="0.05" value="${_speed}">
                </div>
                <div class="mm-row">
                    <div class="mm-row-label"><span>🔊 增益</span><span class="val" id="mm-gain-label">${volText}</span></div>
                    <input type="range" class="mm-slider gold" id="mm-gain" min="0" max="3" step="0.05" value="${_gain}">
                </div>
                <div class="mm-tools-group">
                    <span class="label">🛠 工具</span>
                    <span class="badge" id="mm-rotation-label">${currentRotLabel}</span>
                    <div style="display:flex;gap:3px;flex-wrap:wrap;">
                        <button class="mm-tool-btn rotate-btn" id="mm-rotate-btn">⟳ 旋转</button>
                        <button class="mm-tool-btn reset-rotate" id="mm-rotate-reset">↺</button>
                        <button class="mm-tool-btn pip-btn" id="mm-pip-btn">📺 画中画</button>
                        <button class="mm-tool-btn window-fullscreen-btn" id="mm-window-fullscreen-btn">🖥 窗口全屏</button>
                    </div>
                </div>
                <div class="mm-status" id="mm-status">⏳ 初始化...</div>
                <div class="mm-actions">
                    <button class="mm-btn" id="mm-reset">↺ 重置</button>
                    <button class="mm-btn primary" id="mm-close">✕ 关闭</button>
                </div>
                <div class="mm-footer">
                    ⌨ 切换面板 <kbd>Ctrl+Shift+M</kbd> &nbsp;|&nbsp; 窗口全屏 <kbd>Ctrl+Shift+F</kbd>
                </div>
            `;
            document.body.appendChild(_panel);

            // --- 控件绑定 ---
            const speedSlider = _panel.querySelector('#mm-speed');
            const gainSlider = _panel.querySelector('#mm-gain');
            const speedLabel = _panel.querySelector('#mm-speed-label');
            const gainLabel = _panel.querySelector('#mm-gain-label');
            const statusEl = _panel.querySelector('#mm-status');
            const rotationLabel = _panel.querySelector('#mm-rotation-label');

            // 倍速
            speedSlider.addEventListener('input', () => {
                const v = parseFloat(speedSlider.value);
                _speed = v;
                MediaEngine.setSpeed(v);
                speedLabel.textContent = v.toFixed(2) + '×';
                StorageEngine.save(_speed, _gain, _rotation);
                _updateStatus(statusEl);
            });

            // 增益
            gainSlider.addEventListener('input', () => {
                const v = parseFloat(gainSlider.value);
                _gain = v;
                MediaEngine.setGain(v);
                let txt = Math.round(v * 100) + '%';
                if (v > 1) txt += ` <span class="val gold">+${(v - 1).toFixed(1)}×</span>`;
                gainLabel.innerHTML = txt;
                StorageEngine.save(_speed, _gain, _rotation);
                _updateStatus(statusEl);
            });

            // 旋转
            const rotateBtn = _panel.querySelector('#mm-rotate-btn');
            const rotateReset = _panel.querySelector('#mm-rotate-reset');
            const rotationValues = [0, 90, 180, 270];
            const rotationLabelsMap = ['0°', '90°', '180°', '270°'];

            const applyRotation = (deg) => {
                _rotation = deg;
                MediaEngine.setRotation(deg);
                const idx = rotationValues.indexOf(deg);
                rotationLabel.textContent = rotationLabelsMap[idx >= 0 ? idx : 0];
                StorageEngine.save(_speed, _gain, _rotation);
                _updateStatus(statusEl);
            };

            rotateBtn.addEventListener('click', () => {
                const idx = rotationValues.indexOf(_rotation);
                const nextIdx = (idx + 1) % rotationValues.length;
                applyRotation(rotationValues[nextIdx]);
            });

            rotateReset.addEventListener('click', () => {
                applyRotation(0);
            });

            // --- 画中画 ---
            const pipBtn = _panel.querySelector('#mm-pip-btn');
            let pipCooldown = false;

            pipBtn.addEventListener('click', async () => {
                if (pipCooldown) return;
                pipCooldown = true;

                const result = await MediaEngine.togglePiP();

                if (result.success) {
                    _syncButtons();
                    _updateStatus(statusEl);
                } else {
                    pipBtn.textContent = '⚠️ ' + result.msg;
                    pipBtn.classList.add('disabled');
                    setTimeout(() => {
                        pipBtn.textContent = '📺 画中画';
                        pipBtn.classList.remove('disabled');
                        _syncButtons();
                    }, 2500);
                }

                setTimeout(() => { pipCooldown = false; }, 600);
            });

            // --- ★★★ 窗口全屏按钮 ★★★ ---
            const fsBtn = _panel.querySelector('#mm-window-fullscreen-btn');
            let fsCooldown = false;

            fsBtn.addEventListener('click', async () => {
                if (fsCooldown) return;
                fsCooldown = true;
                fsBtn.textContent = '⏳ 处理中...';
                fsBtn.disabled = true;

                const result = await MediaEngine.toggleWindowFullscreen();

                if (result.success) {
                    _syncButtons();
                    _updateStatus(statusEl);
                } else {
                    fsBtn.textContent = '⚠️ ' + result.msg;
                    setTimeout(() => {
                        fsBtn.textContent = '🖥 窗口全屏';
                        fsBtn.classList.remove('active');
                        _syncButtons();
                    }, 2500);
                }

                setTimeout(() => {
                    fsCooldown = false;
                    fsBtn.disabled = false;
                }, 1000);
            });

            // 监听 ESC 键退出全屏（由 MediaEngine 处理）
            // 但我们需要同步UI状态
            document.addEventListener('mm-fs-change', () => {
                _syncButtons();
                _updateStatus(statusEl);
            });
            document.addEventListener('keydown', (e) => {
                if ((e.key === 'Escape' || e.key === 'Esc') && MediaEngine.isWindowFullscreen()) {
                    setTimeout(() => {
                        _syncButtons();
                        _updateStatus(statusEl);
                    }, 200);
                }
            }, true);

            // 监听画中画退出事件
            document.addEventListener('leavepictureinpicture', () => {
                _syncButtons();
                _updateStatus(statusEl);
            });
            document.addEventListener('mm-pip-change', () => {
                _syncButtons();
                _updateStatus(statusEl);
            });

            // 关闭
            _panel.querySelector('#mm-close').addEventListener('click', _hide);

            // 重置所有
            _panel.querySelector('#mm-reset').addEventListener('click', () => {
                _speed = 1; _gain = 1; _rotation = 0;
                speedSlider.value = 1; gainSlider.value = 1;
                speedLabel.textContent = '1.00×';
                gainLabel.innerHTML = '100%';
                rotationLabel.textContent = '0°';
                MediaEngine.setSpeed(1);
                MediaEngine.setGain(1);
                MediaEngine.setRotation(0);
                StorageEngine.save(1, 1, 0);
                _updateStatus(statusEl);
            });

            // --- 拖拽 ---
            let dragging = false, ox = 0, oy = 0;
            const dragEl = _panel.querySelector('#mm-drag');
            dragEl.addEventListener('mousedown', (e) => {
                if (e.target.closest('.mm-btn') || e.target.closest('.mm-tool-btn')) return;
                dragging = true;
                const r = _panel.getBoundingClientRect();
                ox = e.clientX - r.left;
                oy = e.clientY - r.top;
                _panel.style.transition = 'none';
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                let x = e.clientX - ox, y = e.clientY - oy;
                x = Math.max(0, Math.min(innerWidth - _panel.offsetWidth, x));
                y = Math.max(0, Math.min(innerHeight - _panel.offsetHeight, y));
                _panel.style.left = x + 'px';
                _panel.style.right = 'auto';
                _panel.style.bottom = 'auto';
                _panel.style.top = y + 'px';
            });
            document.addEventListener('mouseup', () => {
                if (dragging) { dragging = false; _panel.style.transition = ''; }
            });
            dragEl.addEventListener('dblclick', () => {
                _panel.style.left = 'auto';
                _panel.style.right = '28px';
                _panel.style.bottom = '28px';
                _panel.style.top = 'auto';
                _panel.style.transition = 'all 0.3s ease';
                setTimeout(() => { _panel.style.transition = ''; }, 300);
            });

            // 初始应用旋转
            if (_rotation > 0) {
                MediaEngine.setRotation(_rotation);
            }

            setTimeout(() => {
                _updateStatus(statusEl);
                _syncButtons();
            }, 300);
            _startStatusLoop();
        };

        const _show = () => {
            if (!_panel) _render();
            if (!_panel) return;
            _panel.classList.remove('mm-hidden');
            _panel.style.display = '';
            _visible = true;
            _closed = false;
            setTimeout(() => {
                _updateStatus();
                _syncButtons();
            }, 200);
        };

        const _hide = () => {
            if (!_panel) return;
            _panel.classList.add('mm-hidden');
            setTimeout(() => { if (_panel) _panel.style.display = 'none'; }, 250);
            _visible = false;
            _closed = true;
        };

        const _toggle = () => {
            if (_visible) {
                _hide();
            } else {
                _show();
            }
        };

        return {
            show: _show,
            hide: _hide,
            toggle: _toggle,
            get visible() { return _visible; },
            get closed() { return _closed; },
            updateStatus: _updateStatus
        };
    })();

    // ============================================================
    // 模块4: 应用启动器
    // ============================================================
    const App = (() => {
        const init = () => {
            if (window.__MM_INITED) return;
            window.__MM_INITED = true;

            const saved = StorageEngine.load();
            MediaEngine.setSpeed(saved.speed);
            MediaEngine.setGain(saved.gain);
            if (saved.rotation > 0) {
                MediaEngine.setRotation(saved.rotation);
            }

            let autoShown = false;

            const tryShow = () => {
                if (autoShown) return;
                if (document.querySelectorAll('video, audio').length > 0 && !PanelUI.closed) {
                    PanelUI.show();
                    autoShown = true;
                }
            };

            setTimeout(tryShow, 1500);

            const watcher = new MutationObserver(() => {
                if (document.querySelectorAll('video, audio').length > 0 && !PanelUI.visible && !PanelUI.closed) {
                    PanelUI.show();
                    autoShown = true;
                }
            });
            watcher.observe(document.body, { childList: true, subtree: true });

            document.addEventListener('keydown', (e) => {
                // 切换面板
                if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm') {
                    e.preventDefault();
                    PanelUI.toggle();
                }
                // ★★★ 窗口全屏快捷键 ★★★
                if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
                    e.preventDefault();
                    MediaEngine.toggleWindowFullscreen();
                    // 延迟更新UI
                    setTimeout(() => {
                        PanelUI.updateStatus();
                    }, 200);
                }
            });

            // 页面卸载时清理全屏
            window.addEventListener('beforeunload', () => {
                MediaEngine.cleanupFullscreen();
            });

            window.addEventListener('load', () => {
                setTimeout(() => {
                    const info = MediaEngine.getInfo();
                    if (info) {
                        console.log(`[MediaMaster] 🚀 已就绪 | ${info.total} 个媒体 | ${info.speed.toFixed(2)}× | ${info.volume.toFixed(2)} | 旋转${info.rotation}°`);
                    }
                    if (!autoShown && document.querySelectorAll('video, audio').length > 0) {
                        PanelUI.show();
                        autoShown = true;
                    }
                }, 800);
            });

            console.log('🎯 Media Master Pro v3.1.4 已加载');
            console.log('  ⌨ Ctrl+Shift+M  → 切换面板');
            console.log('  ⌨ Ctrl+Shift+F  → 窗口全屏（视频充满当前窗口）');
            console.log('  ⌨ ESC           → 退出窗口全屏');
        };

        return { init };
    })();

    // ============================================================
    // 启动
    // ============================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', App.init);
    } else {
        App.init();
    }

})();