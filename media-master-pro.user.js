// ==UserScript==
// @name         Media Master Pro - 视频音频增强控制
// @namespace    https://github.com/ItmeiCode/Media-Master-Pro
// @version      2.5.0
// @description  智能媒体控制器：倍速调节、音量增益、站点记忆、加密存储
// @author       itmei
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237c7cf8' stroke-width='2'%3E%3Cpath d='M3 18v-6a9 9 0 0 1 18 0v6'/%3E%3Cpath d='M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z'/%3E%3C/svg%3E
// ==/UserScript==

(() => {
    'use strict';

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
                    if (!raw) return { speed: 1, gain: 1 };
                    const data = _decode(raw);
                    const site = data[getSiteId()];
                    return site ? { speed: site.speed ?? 1, gain: site.gain ?? 1 } : { speed: 1, gain: 1 };
                } catch {
                    return { speed: 1, gain: 1 };
                }
            },
            save: (speed, gain) => {
                try {
                    let db = {};
                    const raw = localStorage.getItem(DB_KEY);
                    if (raw) db = _decode(raw);
                    db[getSiteId()] = { speed, gain };
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

        const _getAll = () => document.querySelectorAll('video, audio');

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
                return gain;
            } catch {
                return null;
            }
        };

        return {
            setSpeed: (val) => {
                if (val <= 0) return;
                _getAll().forEach(el => { el.playbackRate = val; });
            },
            setGain: (val) => {
                if (val < 0) return;
                _getAll().forEach(el => {
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
            getInfo: () => {
                const list = _getAll();
                if (!list.length) return null;
                const target = Array.from(list).find(el => !el.paused && el.currentTime > 0) || list[0];
                const gain = _cache.get(target)?.gain.value ?? 1;
                return {
                    total: list.length,
                    speed: target.playbackRate,
                    volume: Math.round(target.volume * gain * 100) / 100,
                    muted: target.muted,
                    paused: target.paused
                };
            }
        };
    })();

    // ============================================================
    // 模块3: 浮动面板 UI
    // ============================================================
    const PanelUI = (() => {
        let _panel = null;
        let _visible = false;
        let _closed = false;
        let _speed = 1;
        let _gain = 1;
        let _statusTimer = null;

        // --- 样式注入 ---
        const _injectStyles = () => {
            if (document.getElementById('mm-styles')) return;
            const css = document.createElement('style');
            css.id = 'mm-styles';
            css.textContent = `
                .mm-overlay {
                    position: fixed; bottom: 28px; right: 28px;
                    z-index: 999999;
                    width: 268px;
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

                /* 底部按钮区域 - 居中 */
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

                /* 快捷键脚注 - 在按钮下方 */
                .mm-footer {
                    text-align: center !important;
                    margin-top: 10px !important;
                    padding-top: 8px !important;
                    border-top: 1px solid rgba(255,255,255,0.03) !important;
                    font-size: 10px !important;
                    color: rgba(255,255,255,0.18) !important;
                    letter-spacing: 0.3px !important;
                    font-weight: 400 !important;
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
            el.innerHTML = `<span class="hl">${info.total}</span> 个 · ${icon} ${info.paused ? '暂停' : '播放中'}${info.muted ? ' 🔇' : ''}<br>🔊 音量 ${info.volume.toFixed(2)}`;
        };

        const _startStatusLoop = () => {
            if (_statusTimer) clearInterval(_statusTimer);
            _statusTimer = setInterval(() => {
                if (_visible && _panel) {
                    _updateStatus();
                }
            }, 2000);
        };

        const _render = () => {
            if (_panel) return;

            _injectStyles();

            const saved = StorageEngine.load();
            _speed = saved.speed;
            _gain = saved.gain;

            const site = location.hostname.replace(/^www\./, '');
            const volText = Math.round(_gain * 100) + '%' + (_gain > 1 ? ` <span class="val gold">+${(_gain - 1).toFixed(1)}×</span>` : '');

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
                <div class="mm-status" id="mm-status">⏳ 初始化...</div>
                <div class="mm-actions">
                    <button class="mm-btn" id="mm-reset">↺ 重置</button>
                    <button class="mm-btn primary" id="mm-close">✕ 关闭</button>
                </div>
                <div class="mm-footer">⌨ 切换面板 <kbd>Ctrl+Shift+M</kbd></div>
            `;
            document.body.appendChild(_panel);

            // --- 控件绑定 ---
            const speedSlider = _panel.querySelector('#mm-speed');
            const gainSlider = _panel.querySelector('#mm-gain');
            const speedLabel = _panel.querySelector('#mm-speed-label');
            const gainLabel = _panel.querySelector('#mm-gain-label');
            const statusEl = _panel.querySelector('#mm-status');

            speedSlider.addEventListener('input', () => {
                const v = parseFloat(speedSlider.value);
                _speed = v;
                MediaEngine.setSpeed(v);
                speedLabel.textContent = v.toFixed(2) + '×';
                StorageEngine.save(_speed, _gain);
                _updateStatus(statusEl);
            });

            gainSlider.addEventListener('input', () => {
                const v = parseFloat(gainSlider.value);
                _gain = v;
                MediaEngine.setGain(v);
                let txt = Math.round(v * 100) + '%';
                if (v > 1) txt += ` <span class="val gold">+${(v - 1).toFixed(1)}×</span>`;
                gainLabel.innerHTML = txt;
                StorageEngine.save(_speed, _gain);
                _updateStatus(statusEl);
            });

            _panel.querySelector('#mm-close').addEventListener('click', _hide);
            _panel.querySelector('#mm-reset').addEventListener('click', () => {
                _speed = 1; _gain = 1;
                speedSlider.value = 1; gainSlider.value = 1;
                speedLabel.textContent = '1.00×';
                gainLabel.innerHTML = '100%';
                MediaEngine.setSpeed(1);
                MediaEngine.setGain(1);
                StorageEngine.save(1, 1);
                _updateStatus(statusEl);
            });

            // --- 拖拽 ---
            let dragging = false, ox = 0, oy = 0;
            const dragEl = _panel.querySelector('#mm-drag');
            dragEl.addEventListener('mousedown', (e) => {
                if (e.target.closest('.mm-btn')) return;
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

            setTimeout(() => _updateStatus(statusEl), 300);
            _startStatusLoop();
        };

        const _show = () => {
            if (!_panel) _render();
            if (!_panel) return;
            _panel.classList.remove('mm-hidden');
            _panel.style.display = '';
            _visible = true;
            _closed = false;
            setTimeout(() => _updateStatus(), 200);
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
                if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm') {
                    e.preventDefault();
                    PanelUI.toggle();
                }
            });

            window.addEventListener('load', () => {
                setTimeout(() => {
                    const info = MediaEngine.getInfo();
                    if (info) {
                        console.log(`[MediaMaster] 🚀 已就绪 | ${info.total} 个媒体 | ${info.speed.toFixed(2)}× | ${info.volume.toFixed(2)}`);
                    }
                    if (!autoShown && document.querySelectorAll('video, audio').length > 0) {
                        PanelUI.show();
                        autoShown = true;
                    }
                }, 800);
            });

            console.log('🎯 Media Master Pro v2.5 已加载 | 快捷键 Ctrl+Shift+M 切换面板');
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