const env = import.meta.env ?? {};
const baseUrl = env.BASE_URL || '/';
const DIRECTUS_URL = (
  env.VITE_DIRECTUS_URL ||
  document.querySelector('meta[name="directus-url"]')?.content ||
  'https://cms.ohwatcha.evolinq.link'
).replace(/\/$/, '');
const configuredApiBase =
  env.VITE_API_BASE ||
  document.querySelector('meta[name="api-base"]')?.content;
const API_BASE = (
  configuredApiBase ||
  (env.DEV ? '/api' : DIRECTUS_URL)
).replace(/\/$/, '');
const RELATIVE_API_BASE = API_BASE.startsWith('/');
let relativeApiBaseDisabled = false;

function shouldUseRelativeApiBase() {
  return RELATIVE_API_BASE && !relativeApiBaseDisabled;
}

function disableRelativeApiBase(reason) {
  if (!RELATIVE_API_BASE || relativeApiBaseDisabled) return;
  relativeApiBaseDisabled = true;
  console.warn(`API base "${API_BASE}" disabled: ${reason}. Falling back to "${DIRECTUS_URL}".`);
}
const UPDATE_INTERVAL = 60000;
// Maximum age (hours) for showing recent locations; configurable via Vite env:
// - VITE_SHISHI_MAX_AGE_HOURS (preferred)
// - VITE_MAX_AGE_HOURS (fallback)
// Set to 0 to disable filtering (show all locations)
const MAX_AGE_HOURS = (() => {
  const raw = env.VITE_SHISHI_MAX_AGE_HOURS ?? env.VITE_MAX_AGE_HOURS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 2;
})();

import { createSampleIcon } from './components/SampleIcon.js';

import shishiIconUrl from '../assets/icons/shishi.png';
let shopIconUrl;
// resolve optional shop.png without causing build-time unresolved import
{
  const icons = import.meta.glob('../assets/icons/*.png', { eager: true });
  const key = '../assets/icons/shop.png';
  const mod = icons[key];
  shopIconUrl = mod ? (mod.default || mod) : shishiIconUrl;
}

let homeIconUrl = null;
{
  const iconsPng = import.meta.glob('../assets/icons/*.png', { eager: true });
  const keyHome = '../assets/icons/home.png';
  const modHome = iconsPng[keyHome];
  homeIconUrl = modHome ? (modHome.default || modHome) : null;
}

// build icon filename -> url map from assets/icons
const iconFiles = import.meta.glob('../assets/icons/*.{png,webp}', { eager: true });
const iconUrlMap = {};
for (const p in iconFiles) {
  const fn = p.split('/').pop();
  iconUrlMap[fn] = (iconFiles[p] && (iconFiles[p].default || iconFiles[p]));
}

// shop icon cache by url
const shopIconCache = new Map();
const MAP_MARKER_ICON_CLASS = 'ohwatcha-marker-icon';
function getLeafletIconForUrl(url, { iconSize = [32, 32] } = {}) {
  if (!url) return null;
  if (shopIconCache.has(url)) return shopIconCache.get(url);
  try {
    const ic = L.icon({
      iconUrl: url,
      iconSize,
      iconAnchor: [Math.round(iconSize[0] / 2), iconSize[1]],
      popupAnchor: [0, -iconSize[1]],
      className: MAP_MARKER_ICON_CLASS
    });
    shopIconCache.set(url, ic);
    return ic;
  } catch (e) {
    console.warn('create icon failed', e);
    return null;
  }
}

function getShopIconByType(type) {
  if (!type) return getLeafletIconForUrl(shopIconUrl) || shopIcon;
  // normalize type: trim, lowercase, NFKC
  const normType = String(type).trim().toLowerCase().normalize('NFKC');
  const candidates = [
    `shop-${normType}.png`,
    `shop_${normType}.png`,
    `${normType}.png`,
    `shop-${normType}.webp`,
    `shop_${normType}.webp`,
    `${normType}.webp`
  ];

  // exact filename match first
  for (const c of candidates) {
    if (iconUrlMap[c]) {
      const ic = getLeafletIconForUrl(iconUrlMap[c]);
      try { ic.__source = c; } catch (e) {}
      return ic;
    }
  }

  // loose match: search icon filenames for ones that include the normalized type
  for (const fn in iconUrlMap) {
    const nameOnly = fn.replace(/\.[^.]+$/, '').toLowerCase().normalize('NFKC');
    if (nameOnly === normType || nameOnly.includes(normType) || normType.includes(nameOnly)) {
      const ic = getLeafletIconForUrl(iconUrlMap[fn]);
      try { ic.__source = fn + ' (loose)'; } catch (e) {}
      return ic;
    }
  }

  // final fallback
  const fallback = getLeafletIconForUrl(shopIconUrl) || shopIcon;
  try { fallback.__source = 'shop.png (fallback)'; } catch (e) {}
  return fallback;
}

const map = L.map('map', { zoomControl: false }).setView([36.78058, 137.09447], 15);
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
});
const gsiStd = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
  attribution: '&copy; Geospatial Information Authority of Japan'
});
const gsiPale = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
  attribution: '&copy; Geospatial Information Authority of Japan (淡色地図)'
});
const gsiAerial = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/ort/{z}/{x}/{y}.jpg', {
  attribution: '&copy; Geospatial Information Authority of Japan (航空写真)'
});

const baseLayers = {
  OpenStreetMap: osmLayer,
  '地理院地図（空中写真）': gsiAerial
};
let currentBaseOpacity = 1;
const setBaseLayerOpacity = (nextOpacity) => {
  const clamped = Math.max(0, Math.min(1, Number(nextOpacity)));
  currentBaseOpacity = clamped;
  Object.values(baseLayers).forEach((layer) => {
    try { layer.setOpacity(clamped); } catch (e) {}
  });
};

// Use OpenStreetMap as the default base layer
osmLayer.addTo(map);
currentBaseOpacity = 0.8;
setBaseLayerOpacity(currentBaseOpacity);
const layerControl = L.control.layers(baseLayers, null, { position: 'bottomright' }).addTo(map);

// opacity slider for background map tiles
const opacityControl = L.control({ position: 'bottomleft' });
opacityControl.onAdd = () => {
  const wrap = L.DomUtil.create('div', 'leaflet-bar');
  Object.assign(wrap.style, {
    background: 'rgba(255,255,255,0.95)',
    borderRadius: '6px',
    padding: '8px 10px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    marginLeft: '12px',
    marginBottom: '72px',
    minWidth: '140px'
  });

  const header = L.DomUtil.create('div', '', wrap);
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px'
  });

  const label = L.DomUtil.create('span', '', header);
  label.textContent = '地図透明度';
  Object.assign(label.style, {
    display: 'block',
    fontSize: '12px',
    color: '#333'
  });

  const toggle = L.DomUtil.create('button', '', header);
  toggle.type = 'button';
  toggle.title = '折りたたむ／開く';
  Object.assign(toggle.style, {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '14px',
    lineHeight: '1',
    padding: '0 2px'
  });

  const row = L.DomUtil.create('div', '', wrap);
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '6px'
  });

  const slider = L.DomUtil.create('input', '', row);
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.value = String(Math.round(currentBaseOpacity * 100));
  Object.assign(slider.style, {
    width: '92px'
  });

  const value = L.DomUtil.create('span', '', row);
  value.textContent = `${Math.round(currentBaseOpacity * 100)}%`;
  Object.assign(value.style, {
    fontSize: '12px',
    color: '#333',
    minWidth: '34px',
    textAlign: 'right'
  });

  const onInput = () => {
    const next = Number(slider.value) / 100;
    setBaseLayerOpacity(next);
    value.textContent = `${Math.round(next * 100)}%`;
  };
  slider.addEventListener('input', onInput);
  slider.addEventListener('change', onInput);

  let collapsed = true;
  const applyCollapsedState = () => {
    row.style.display = collapsed ? 'none' : 'flex';
    toggle.textContent = collapsed ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    wrap.style.minWidth = collapsed ? 'auto' : '140px';
  };
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    applyCollapsedState();
  });
  applyCollapsedState();

  L.DomEvent.disableClickPropagation(wrap);
  L.DomEvent.disableScrollPropagation(wrap);

  return wrap;
};
opacityControl.addTo(map);

map.on('baselayerchange', (ev) => {
  try {
    if (ev && ev.layer && ev.layer.setOpacity) ev.layer.setOpacity(currentBaseOpacity);
  } catch (e) {}
});

// Nudge the layer control up so it doesn't overlap browser bottom UI
try {
  const container = layerControl && layerControl.getContainer && layerControl.getContainer();
  if (container && container.style) {
    // lift above typical browser bottom bars; tweak value if necessary
    container.style.bottom = '72px';
    // keep a small right offset
    container.style.right = '12px';
    container.style.zIndex = '1005';
  }
} catch (e) {
  console.warn('adjust layer control position failed', e);
}

// adjust map height when a bottom banner is present so they don't overlap
function adjustMapForBanner() {
  try {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    const banner = document.getElementById('sponsor-banner-wrap');

    // Create a layout container that stacks map above banner using flex column
    let appFrame = document.getElementById('app-frame');
    if (!appFrame) {
      appFrame = document.createElement('div');
      appFrame.id = 'app-frame';
      Object.assign(appFrame.style, {
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        minHeight: '100vh',
        width: '100%',
        overflow: 'hidden'
      });
      // insert appFrame at the top of body
      document.body.insertBefore(appFrame, document.body.firstChild);
    }

    // map uses all remaining vertical space above banner
    if (mapEl.parentElement !== appFrame) appFrame.prepend(mapEl);
    Object.assign(mapEl.style, {
      position: 'relative',
      flex: '1 1 auto',
      width: '100%',
      height: 'auto',
      minHeight: '0'
    });

    if (banner) {
      // move banner into appFrame before the map so it's above the map in flow
      if (banner.parentElement !== appFrame) appFrame.insertBefore(banner, mapEl);
      // banner keeps intrinsic height and never overlaps map
      Object.assign(banner.style, {
        position: 'relative',
        width: '100%',
        left: '',
        right: '',
        top: '',
        zIndex: '999',
        flex: '0 0 auto'
      });
    }

    // position the sidebar menu and locate button under the banner (if present)
    try {
      const bannerEl = document.getElementById('sponsor-banner-wrap');
      const menuEl = document.getElementById('shishi-menu');
      const bannerHeight = bannerEl ? bannerEl.offsetHeight || 0 : 0;

      if (menuEl) {
        // menu is fixed positioned; shift it below the banner
        menuEl.style.position = 'fixed';
        menuEl.style.left = menuEl.style.left || '8px';
        menuEl.style.top = `${Math.max(8, bannerHeight + 8)}px`;
        menuEl.style.zIndex = '1000';
      }

      if (locateBtn) {
        // place locateBtn fixed at top-right under the banner
        Object.assign(locateBtn.style, {
          position: 'fixed',
          right: '16px',
          top: `${Math.max(8, bannerHeight + 12)}px`,
          zIndex: '1001'
        });
        // ensure it's in document flow (if not already)
        if (!locateBtn.parentElement || locateBtn.parentElement !== document.body) document.body.appendChild(locateBtn);
      }
    } catch (e) {
      console.warn('positioning menu/locateBtn failed', e);
    }

    // ensure leaflet recalculates size after layout changes and image load
    if (typeof map !== 'undefined' && map && map.invalidateSize) {
      requestAnimationFrame(() => {
        map.invalidateSize();
        setTimeout(() => map.invalidateSize(), 120);
      });
    }
  } catch (e) {
    console.warn('adjustMapForBanner failed', e);
  }
}
window.addEventListener('resize', adjustMapForBanner);
adjustMapForBanner();

const shishiIcon = L.icon({
  iconUrl: shishiIconUrl,
  iconSize: [48, 48],
  iconAnchor: [24, 48],
  popupAnchor: [0, -48],
  className: MAP_MARKER_ICON_CLASS
});

const shopIcon = L.icon({
  iconUrl: shopIconUrl,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
  className: MAP_MARKER_ICON_CLASS
});

// create homeIcon while preserving aspect ratio (fit within max size)
let homeIcon = null;
if (homeIconUrl) {
  (function loadHomeIcon() {
    const img = new Image();
    img.src = homeIconUrl;
    img.onload = () => {
      const maxSize = 32; // max width/height to fit into
      const scale = maxSize / Math.max(img.width || maxSize, img.height || maxSize);
      const w = Math.max(8, Math.round((img.width || maxSize) * scale));
      const h = Math.max(8, Math.round((img.height || maxSize) * scale));
      homeIcon = L.icon({
        iconUrl: homeIconUrl,
        iconSize: [w, h],
        iconAnchor: [Math.round(w / 2), h],
        popupAnchor: [0, -h],
        className: MAP_MARKER_ICON_CLASS
      });
      // apply to existing current location marker if present
      try {
        if (currentLocationMarker) currentLocationMarker.setIcon(homeIcon);
      } catch (e) {
        console.warn('apply homeIcon failed', e);
      }
    };
    img.onerror = (e) => {
      console.warn('failed to load home icon', e);
    };
  })();
}

const shishiMarkers = {};
// shop markers and data
const shopMarkers = {};
let shopsData = [];
const SHOP_TYPE_MAP = {
  '1': 'カフェ',
  '2': '食事',
  '3': '史跡',
  '4': '公共施設',
  '5': '会場'
};
const selectedShopTypes = new Set(Object.keys(SHOP_TYPE_MAP));
let shopFilterRendered = false;

// --- Sidebar menu for current shishi list (merged into single "スポット" panel) ---
const menuHtml = `
  <aside id="shishi-menu" style="position:fixed;left:8px;top:8px;z-index:1000;
    background:white;padding:8px;border-radius:6px;max-height:70vh;overflow:auto;width:260px;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
    <h4 style="margin:0 0 8px 0"><span class="shishi-menu-title">スポット</span></h4>
    <ul id="shishi-list" style="list-style:none;padding:0;margin:0;"></ul>
    <!-- shop filters will be injected here by renderShopFilterUI -->
  </aside>
`;
document.body.insertAdjacentHTML('afterbegin', menuHtml);

// prepend sample icon to the menu header (demonstrates importing SVG as URL)
try {
  const aside = document.getElementById('shishi-menu');
  if (aside) {
    const h4 = aside.querySelector('h4');
    if (h4) h4.prepend(createSampleIcon());
  }
} catch (e) {
  console.warn('insert icon failed', e);
}

// reduce font size for shishi list title and items
try {
  const style = document.createElement('style');
  style.textContent = `
    #shishi-menu .shishi-menu-title { font-size: 0.85rem; }
    #shishi-menu #shishi-list { font-size: 0.85rem; }
    #shishi-menu #shishi-list li { font-size: 0.85rem; }
  `;
  document.head.appendChild(style);
} catch (e) {
  console.warn('apply shishi font-size failed', e);
}

// ensure popup images never overflow their popup containers
try {
  const popupStyle = document.createElement('style');
  popupStyle.textContent = `
    .leaflet-marker-icon.${MAP_MARKER_ICON_CLASS} { object-fit: contain; object-position: center center; }
    .shop-popup img, .shishi-popup img { max-width: 100%; height: auto; max-height: 40vh; display: block; object-fit: cover; }
    .shop-popup .popup-image-empty, .shishi-popup .popup-image-empty { color: #666; font-size: 0.95rem; }
  `;
  document.head.appendChild(popupStyle);
} catch (e) {
  console.warn('apply popup image styles failed', e);
}

// make the current-location list collapsible
try {
  const aside = document.getElementById('shishi-menu');
  if (aside) {
    const header = aside.querySelector('h4');
    const list = aside.querySelector('#shishi-list');
    if (header && list) {
      // style header for flexible layout
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.justifyContent = 'space-between';

      const toggle = document.createElement('button');
      toggle.id = 'shishi-menu-toggle';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.title = '折りたたむ／開く';
      toggle.textContent = '▾';
      Object.assign(toggle.style, {
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontSize: '16px',
        lineHeight: '1'
      });

      header.appendChild(toggle);

      let collapsed = false;
      const applyState = () => {
        if (collapsed) {
          // keep the header visible but hide the list; reduce width
          aside.style.width = '140px';
          list.style.display = 'none';
          toggle.textContent = '▸';
          toggle.setAttribute('aria-expanded', 'false');
        } else {
          aside.style.width = '240px';
          list.style.display = '';
          toggle.textContent = '▾';
          toggle.setAttribute('aria-expanded', 'true');
        }
      };

      toggle.addEventListener('click', () => {
        collapsed = !collapsed;
        applyState();
      });

      // initial state (expanded)
      applyState();
    }
  }
} catch (e) {
  console.warn('collapsible menu setup failed', e);
}

// --- Current location button and handler ---
let currentLocationMarker = null;

const locateBtn = document.createElement('button');
locateBtn.id = 'btn-current-location';
// replace text with an accessible icon (visible label kept for screen readers)
locateBtn.innerHTML = `
  <span aria-hidden="true" style="display:inline-block;width:20px;height:20px;line-height:0">
    <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#333" stroke-width="1.8">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2" fill="#333" stroke="none" />
    </svg>
  </span>
  <span style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">現在地</span>
`;
Object.assign(locateBtn.style, {
  position: 'fixed',
  right: '16px',
  bottom: '16px',
  zIndex: 1000,
  background: '#ffffff',
  border: '1px solid rgba(0,0,0,0.08)',
  width: '40px',
  height: '40px',
  padding: '6px',
  borderRadius: '50%',
  boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
});
locateBtn.title = '現在地を取得して地図の中心に移動';

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('このブラウザでは位置情報が利用できません');
    return;
  }

  locateBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const coords = [lat, lon];

      if (currentLocationMarker) {
        currentLocationMarker.setLatLng(coords);
        if (homeIcon) currentLocationMarker.setIcon(homeIcon);
      } else {
        const opts = homeIcon ? { icon: homeIcon } : {};
        currentLocationMarker = L.marker(coords, opts).addTo(map);
        currentLocationMarker.bindPopup('現在地').openPopup();
      }

      map.setView(coords, Math.max(map.getZoom(), 17), { animate: true });
      locateBtn.disabled = false;
    },
    (err) => {
      console.warn('geolocation error', err);
      alert('現在地を取得できませんでした: ' + (err.message || err.code));
      locateBtn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
});

// if a banner wasn't created (no sponsor images), append locateBtn to body
if (!document.getElementById('sponsor-banner-wrap')) {
  document.body.appendChild(locateBtn);
}

// --- Sponsor banner (fetch from CMS `banner` collection and rotate) ---
;(async function renderBannersFromCMS() {
  try {
    const toBannerItems = (raw) => (Array.isArray(raw) ? raw : [])
      .filter(Boolean)
      .map((b) => ({
      raw: b,
      category: b.category ?? '',
      imageId: extractFileId(b.banner_image || b.image),
      name: b.name ?? '',
      url: extractUrlFromField(b.url) ?? ''
    }))
      .filter((i) => i.imageId || i.name);

    let raw = await fetchCollection('banner');
    console.debug('banner fetch result (primary)', raw);
    let items = toBannerItems(raw);

    // If proxy/public response has no usable URL, retry direct Directus endpoint
    // and prefer direct response when primary has no items, or when it restores URLs.
    if (items.length === 0 || !items.some((i) => sanitizeExternalUrl(i.url))) {
      const directRaw = await fetchCollectionDirect('banner');
      const directItems = toBannerItems(directRaw);
      if (directItems.length > 0 && (items.length === 0 || directItems.some((i) => sanitizeExternalUrl(i.url)))) {
        console.info('banner: using direct endpoint response because primary was empty or had no valid URL');
        raw = directRaw;
        items = directItems;
      }
    }

    if (items.length === 0) {
      console.warn('banner: no displayable items', { primary: raw });
      return;
    }

    // create container
    const bannerWrap = document.createElement('div');
    bannerWrap.id = 'sponsor-banner-wrap';
    Object.assign(bannerWrap.style, {
      position: 'relative',
      left: '0',
      right: '0',
      top: '0',
      flex: '0 0 auto',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '6px',
      background: 'rgba(255,255,255,0.95)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      zIndex: 2002,
      pointerEvents: 'auto'
    });

    const img = document.createElement('img');
    img.id = 'sponsor-banner';
    Object.assign(img.style, {
      maxHeight: '40px',
      maxWidth: '90%',
      objectFit: 'contain',
      cursor: 'pointer',
      display: 'block'
    });

    // anchor wraps image when a target URL exists
    const anchor = document.createElement('a');
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.appendChild(img);

    console.debug('banner items resolved', items.map(i => ({ category: i.category, imageId: i.imageId, name: i.name, hasUrl: Boolean(i.url) })));

    // center the image inside a flexible container so it's always centered
    const imgContainer = document.createElement('div');
    Object.assign(imgContainer.style, {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      flex: '1 1 auto'
    });

    // left label (use .category for current banner)
    const leftLabel = document.createElement('div');
    leftLabel.textContent = items[0].category || '';
    Object.assign(leftLabel.style, {
      marginRight: '8px',
      flex: '0 0 auto',
      fontSize: '0.95rem',
      fontWeight: '600',
      color: '#333',
      pointerEvents: 'none'
    });

    imgContainer.appendChild(leftLabel);
    imgContainer.appendChild(anchor);
    bannerWrap.appendChild(imgContainer);

    // Do NOT append the locate button into the banner; it will be positioned
    // below the banner by `adjustMapForBanner` so it doesn't interfere with centering.
    try {
      Object.assign(locateBtn.style, {
        position: '',
        right: '',
        top: '',
        transform: '',
        zIndex: 1000
      });
    } catch (e) {
      console.warn('prepare locateBtn failed', e);
    }

    document.body.insertBefore(bannerWrap, document.body.firstChild);
    try { adjustMapForBanner(); } catch (e) {}

    // rotation logic: load image URL and set anchor href if present
    let idx = 0;
    let currentImageCandidates = [];
    let currentImageAttempt = 0;

    const applyTextFallback = (it) => {
      img.style.display = 'none';
      if (!anchor.querySelector('.banner-text')) {
        const textDiv = document.createElement('div');
        textDiv.className = 'banner-text';
        textDiv.textContent = it.name || '';
        textDiv.style.fontSize = '1.1rem';
        textDiv.style.fontWeight = 'bold';
        textDiv.style.color = '#333';
        textDiv.style.padding = '4px 12px';
        anchor.appendChild(textDiv);
      } else {
        anchor.querySelector('.banner-text').textContent = it.name || '';
      }
    };

    const tryLoad = (i) => {
      if (!items || items.length === 0) return;
      idx = i % items.length;
      const it = items[idx];
      currentImageCandidates = buildImageUrls(it.imageId);
      currentImageAttempt = 0;
      const explicitHref = sanitizeExternalUrl(it.url);
      if (!currentImageCandidates.length) {
        // 画像がない場合はテキストで表示
        applyTextFallback(it);
      } else {
        // 画像がある場合は画像を表示しテキストを消す
        img.style.display = 'block';
        img.src = currentImageCandidates[currentImageAttempt];
        const textDiv = anchor.querySelector('.banner-text');
        if (textDiv) textDiv.remove();
      }
      if (explicitHref) {
        anchor.href = explicitHref;
        anchor.style.cursor = 'pointer';
        img.style.cursor = 'pointer';
      } else {
        anchor.removeAttribute('href');
        anchor.style.cursor = 'default';
        img.style.cursor = 'default';
      }
      leftLabel.textContent = it.category || '';
    };

    img.onload = () => {
      try { bannerWrap.style.display = 'flex'; adjustMapForBanner(); } catch (e) {}
    };
    img.onerror = () => {
      if (currentImageCandidates.length > 0 && currentImageAttempt < currentImageCandidates.length - 1) {
        currentImageAttempt += 1;
        img.src = currentImageCandidates[currentImageAttempt];
        return;
      }

      const it = items[idx];
      if (it && it.name) {
        applyTextFallback(it);
      }

      const next = (idx + 1) % items.length;
      if (next === idx && !(it && it.name)) {
        console.warn('sponsor banner: all image URLs failed to load', items.map(i => i.imageId));
        return;
      }
      if (next !== idx) {
        tryLoad(next);
      }
    };

    tryLoad(0);

    const rotate = () => tryLoad((idx + 1) % items.length);
    let timer = setInterval(rotate, 15000);
    img.addEventListener('mouseenter', () => clearInterval(timer));
    img.addEventListener('mouseleave', () => { timer = setInterval(rotate, 15000); });
  } catch (err) {
    console.warn('renderBannersFromCMS failed', err);
  }
})();

// startNavigation: obtain current position and open Google Maps directions
window.startNavigation = function startNavigation(destLat, destLon) {
  if (destLat == null || destLon == null) return;

  const lat = encodeURIComponent(destLat);
  const lon = encodeURIComponent(destLon);
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`;

  // Prefer native map app on mobile using platform-specific schemes/intents
  if (isMobileDevice()) {
    try {
      const ua = (navigator.userAgent || '').toLowerCase();
      const isAndroid = /android/.test(ua);
      const isIOS = /iphone|ipad|ipod/.test(ua);

      const comgoogle = `comgooglemaps://?daddr=${lat},${lon}&directionsmode=walking`;
      const appleMaps = `http://maps.apple.com/?daddr=${lat},${lon}&dirflg=w`;
      const intentUrl = `intent://www.google.com/maps/dir/?api=1&destination=${lat},${lon}#Intent;package=com.google.android.apps.maps;scheme=https;end`;

      if (isIOS) {
        // try Google Maps scheme first, then Apple Maps
        window.location.href = comgoogle;
        // if app not installed, fallback to Apple Maps after short delay
        setTimeout(() => { window.location.href = appleMaps; }, 800);
        return;
      }

      if (isAndroid) {
        // intent should open Google Maps app on Android Chrome
        window.location.href = intentUrl;
        // fallback to web view if intent not handled
        setTimeout(() => { window.location.href = webUrl; }, 800);
        return;
      }

      // other mobile browsers: try Google Maps scheme then web
      window.location.href = comgoogle;
      setTimeout(() => { window.location.href = webUrl; }, 800);
      return;
    } catch (e) {
      console.warn('mobile navigation attempt failed', e);
      window.open(webUrl, '_blank', 'noopener');
      return;
    }
  }

  // Desktop behavior: try to get origin then open directions in new tab
  if (!navigator.geolocation) {
    window.open(webUrl, '_blank', 'noopener');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const originLat = pos.coords.latitude;
      const originLon = pos.coords.longitude;
      const url = `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLon}&destination=${lat},${lon}&travelmode=walking`;
      window.open(url, '_blank', 'noopener');
    },
    (err) => {
      console.warn('geolocation error for navigation', err);
      window.open(webUrl, '_blank', 'noopener');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
};

function renderShishiList(items) {
  const list = document.getElementById('shishi-list');
  if (!list) return;
  list.innerHTML = '';
  items.forEach((shishi) => {
    const coords = extractCoordinates(shishi);
    if (!coords) return;
    const id = String(shishi.id ?? shishi.name ?? `${coords[0]}:${coords[1]}`);
    const li = document.createElement('li');
    li.style.padding = '6px 4px';
    li.style.borderBottom = '1px solid #eee';
    const name = escapeHtml(shishi.name || '名称未設定');
    li.innerHTML = `<button data-id="${id}" style="all:unset;cursor:pointer;display:block;width:100%;text-align:left;padding:6px 0">
                      ${name}
                    </button>`;
    li.querySelector('button').addEventListener('click', () => {
      const marker = shishiMarkers[id];
      if (marker) {
        const latlng = marker.getLatLng();
        map.setView(latlng, Math.max(map.getZoom(), 17), { animate: true });
        marker.openPopup();
      } else {
        map.setView(coords, 17, { animate: true });
      }
    });
    list.appendChild(li);
  });
}

function renderShopFilterUI() {
  if (shopFilterRendered) return;
  shopFilterRendered = true;

  const aside = document.getElementById('shishi-menu');
  if (!aside) return;

  // create filter container inside the existing "スポット" panel
  const container = document.createElement('div');
  container.id = 'shop-filters';
  container.style.marginTop = '8px';
  container.innerHTML = `
    <h5 style="margin:0 0 6px 0;display:flex;align-items:center;justify-content:space-between;font-size:0.95rem">
      <span>施設情報</span>
      <button id="shop-filters-toggle" aria-expanded="false" title="折りたたむ／開く" style="background:transparent;border:none;cursor:pointer;font-size:14px;line-height:1">▸</button>
    </h5>
    <form id="shop-type-form" style="margin:6px 0 0 0;padding:0;display:none"></form>
  `;
  aside.appendChild(container);

  const form = document.getElementById('shop-type-form');
  const toggle = document.getElementById('shop-filters-toggle');

  // Only show checkboxes for types that have at least one record in shopsData
  const typeHasRecord = {};
  if (Array.isArray(shopsData)) {
    shopsData.forEach((shop) => {
      const type = shop.type || shop.category || shop.shop_type || null;
      const typeVal = String(type ?? '');
      if (typeVal) typeHasRecord[typeVal] = true;
    });
  }

  Object.entries(SHOP_TYPE_MAP).forEach(([k, v]) => {
    if (!typeHasRecord[k]) return; // skip types with no records
    const id = `shop-type-${k}`;
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '6px';
    wrapper.innerHTML = `<label style="cursor:pointer;font-size:0.85rem"><input type="checkbox" id="${id}" data-val="${k}" checked> ${escapeHtml(v)}</label>`;
    form.appendChild(wrapper);
    const cb = wrapper.querySelector('input');
    cb.addEventListener('change', () => {
      if (cb.checked) selectedShopTypes.add(k); else selectedShopTypes.delete(k);
      renderShops();
    });
  });

  // collapsible behavior for filters (default collapsed)
  let collapsed = true;
  const applyState = () => {
    if (collapsed) {
      form.style.display = 'none';
      toggle.textContent = '▸';
      toggle.setAttribute('aria-expanded', 'false');
    } else {
      form.style.display = '';
      toggle.textContent = '▾';
      toggle.setAttribute('aria-expanded', 'true');
    }
  };

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    applyState();
  });

  applyState();
}

function renderShops() {
  // remove existing markers
  Object.keys(shopMarkers).forEach((id) => {
    try { map.removeLayer(shopMarkers[id]); } catch (e) {}
    delete shopMarkers[id];
  });

  if (!Array.isArray(shopsData) || shopsData.length === 0) return;

  shopsData.forEach((shop) => {
    const coords = extractCoordinates(shop);
    if (!coords) return;
    const id = String(shop.id ?? shop.name ?? `${coords[0]}:${coords[1]}`);
    const type = shop.type || shop.category || shop.shop_type || null;
    const typeVal = String(type ?? '');
    if (!selectedShopTypes.has(typeVal)) return; // filtered out

    const iconForShop = getShopIconByType(String(type || '').toLowerCase());
    const marker = L.marker(coords, { icon: iconForShop || shopIcon }).addTo(map);
    marker.bindPopup(buildShopPopupContent(shop), {
      maxWidth: 300,
      className: 'shop-popup-container'
    });
    shopMarkers[id] = marker;
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatText(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function sanitizeExternalUrl(value) {
  if (!value) {
    return null;
  }

  try {
    let raw = String(value).trim();
    if (!raw) return null;
    // Accept plain domains like "example.com" by prepending https.
    if (
      !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw) &&
      /^[^/\s]+\.[^/\s]+/.test(raw)
    ) {
      raw = `https://${raw}`;
    }
    const url = new URL(raw, DIRECTUS_URL);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }
  } catch (error) {
    console.warn('invalid external url', value, error);
  }

  return null;
}

// lightweight mobile detection: userAgent or coarse pointer
function isMobileDevice() {
  try {
    if (typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod|Windows Phone|webOS/i.test(navigator.userAgent)) return true;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer:coarse)').matches) return true;
  } catch (e) {
    // ignore
  }
  return false;
}

function extractFileId(fileField) {
  if (!fileField) {
    return null;
  }

  if (typeof fileField === 'string' || typeof fileField === 'number') {
    return fileField;
  }

  if (Array.isArray(fileField) && fileField.length > 0) {
    return extractFileId(fileField[0]);
  }

  if (typeof fileField === 'object') {
    return fileField.id || fileField.filename_disk || extractFileId(fileField.data);
  }

  return null;
}

function buildImageUrls(imageId) {
  if (!imageId) {
    return [];
  }

  const assetPath = `/assets/${encodeURIComponent(String(imageId))}?width=400`;
  const urls = [];

  // If API_BASE is a relative path (e.g. '/api'), request via API_BASE so
  // the Vite dev proxy can forward the request to the CMS and avoid CORS.
  if (shouldUseRelativeApiBase()) {
    urls.push(`${API_BASE}${assetPath}`);
  }

  // Also include direct CMS URL as fallback.
  urls.push(`${DIRECTUS_URL}${assetPath}`);
  return [...new Set(urls)];
}

function buildImageUrl(imageId) {
  const urls = buildImageUrls(imageId);
  return urls.length ? urls[0] : null;
}

function buildEndpoints(collection) {
  const path = `/items/${collection}`;
  const endpoints = [];
  if (shouldUseRelativeApiBase()) {
    endpoints.push(`${API_BASE}${path}`);
  }
  const direct = `${DIRECTUS_URL}${path}`;
  if (!endpoints.includes(direct)) {
    endpoints.push(direct);
  }
  return endpoints;
}

function extractCoordinates(item) {
  if (item.lat != null && item.lon != null) {
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }

  if (item.location && Array.isArray(item.location.coordinates) && item.location.coordinates.length >= 2) {
    const lon = Number(item.location.coordinates[0]);
    const lat = Number(item.location.coordinates[1]);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }

  if (item.location && item.location.lat != null && item.location.lon != null) {
    const lat = Number(item.location.lat);
    const lon = Number(item.location.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }

  return null;
}

function getUpdatedAt(item) {
  if (!item) return null;
  const candidates = [
    'updated_at', 'updated', 'date_updated', 'modified', 'modified_on',
    'updatedAt', 'updated_on', 'changed_at', 'created_at', 'created'
  ];

  for (const key of candidates) {
    const val = item[key];
    if (!val) continue;
    const ts = Date.parse(val);
    if (Number.isFinite(ts)) return ts;
  }

  // fallback: if item.meta or item._meta contains timestamp
  if (item.meta && item.meta.updated_at) {
    const ts2 = Date.parse(item.meta.updated_at);
    if (Number.isFinite(ts2)) return ts2;
  }

  return null;
}

function isWithinHours(timestamp, hours) {
  if (!timestamp) return false;
  const ageMs = Date.now() - timestamp;
  return ageMs <= hours * 60 * 60 * 1000;
}

function attachAutoNavigationOnPopupOpen(marker, coords) {
  if (!marker || !coords) return;
  try {
    if (marker.__autoNavAttached) return;
    marker.__autoNavAttached = true;
    marker.on('popupopen', () => {
      if (isMobileDevice()) {
        try {
          startNavigation(coords[0], coords[1]);
        } catch (e) {
          console.warn('auto startNavigation failed', e);
        }
      }
    });
  } catch (e) {
    // ignore
  }
}

function buildDescriptionHtml(description) {
  return description
    ? `<p>${formatText(description)}</p>`
    : '<p><i>説明はありません</i></p>';
}

function buildImageHtml(imageId, altText) {
  const imgUrl = buildImageUrl(imageId);
  return imgUrl
    ? `<img src="${imgUrl}" alt="${escapeHtml(altText)}" style="max-width:100%; height:auto; max-height:40vh; display:block; object-fit:cover;">`
    : '<div class="popup-image-empty">画像なし</div>';
}

// attempt to find an external URL from various possible fields/shapes
function extractUrlFromField(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.length > 0) return extractUrlFromField(raw[0]);
  if (typeof raw === 'object') {
    if (raw.url) return raw.url;
    if (raw.href) return raw.href;
    if (raw.path) return raw.path;
    if (raw.redirect) return raw.redirect;
    if (raw.full_url) return raw.full_url;
    if (raw.data) return extractUrlFromField(raw.data);
    if (raw.value) return raw.value;
  }
  return null;
}

function resolveExternalUrl(shop) {
  if (!shop || typeof shop !== 'object') return null;
  const keys = ['url', 'website', 'link', 'external_url', 'website_url', 'instagram_url'];
  for (const k of keys) {
    if (k in shop) {
      const raw = shop[k];
      const got = extractUrlFromField(raw);
      if (got) return got;
    }
  }
  // also check any field that looks like it might contain a URL
  for (const k of Object.keys(shop)) {
    if (k.toLowerCase().includes('url') || k.toLowerCase().includes('link') || k.toLowerCase().includes('website')) {
      const got = extractUrlFromField(shop[k]);
      if (got) return got;
    }
  }
  return null;
}

function buildShopPopupContent(shop) {
  const safeName = escapeHtml(shop.name || '名称未設定');
  const shopImageId = extractFileId(shop.image || shop.photo);
  const photoCredit = String(shop.photo_credit ?? '').trim();
  const photoCreditHtml = photoCredit
    ? `<p style="margin:4px 0 0;color:#666;font-size:0.82rem;">写真提供: ${formatText(photoCredit)}</p>`
    : '';
  // prefer common URL fields; fallback to instagram_url if present
  const externalCandidate = resolveExternalUrl(shop);
  const externalUrl = sanitizeExternalUrl(externalCandidate);
  console.log('shop external candidate', { name: shop.name, externalCandidate, externalUrl, shop });
  const externalHtml = externalUrl
    ? `<p><a href="${externalUrl}" target="_blank" rel="noopener noreferrer">詳しくはこちら</a></p>`
    : '';

  // navigation button for shops (same behavior as shishi popup)
  const coords = extractCoordinates(shop);
  const navHtml = coords
    ? `<p><button onclick="startNavigation(${coords[0]},${coords[1]})" style="display:inline-block;margin-top:8px;padding:6px 8px;background:#007bff;color:#fff;border-radius:4px;border:none;cursor:pointer">ここまで行く</button></p>`
    : '';

  // if no sanitized URL, collect candidate fields for debugging and show them
  let debugHtml = '';
  if (!externalUrl) {
    const candidates = {};
    // check common named fields
    const keys = ['url', 'website', 'link', 'external_url', 'website_url', 'instagram_url'];
    for (const k of keys) {
      if (k in shop) {
        const v = extractUrlFromField(shop[k]);
        if (v) candidates[k] = v;
      }
    }
    // also check any field name that looks like url/link/website
    for (const k of Object.keys(shop)) {
      const lk = k.toLowerCase();
      if ((lk.includes('url') || lk.includes('link') || lk.includes('website')) && !(k in candidates)) {
        const v = extractUrlFromField(shop[k]);
        if (v) candidates[k] = v;
      }
    }

    // debug details are intentionally hidden in production UI
  }

  return `
    <div class="shop-popup">
      <h3>${safeName}</h3>
      ${buildDescriptionHtml(shop.description)}
      ${buildImageHtml(shopImageId, shop.name || '店舗画像')}
      ${photoCreditHtml}
      ${navHtml}
      ${externalHtml}
      ${debugHtml}
    </div>
  `;
}



function buildShishiPopupContent(shishi) {
  const safeName = escapeHtml(shishi.name || '名称未設定');
  const coords = extractCoordinates(shishi);
  const navHtml = coords
    ? `<p><button onclick="startNavigation(${coords[0]},${coords[1]})" style="display:inline-block;margin-top:8px;padding:6px 8px;background:#007bff;color:#fff;border-radius:4px;border:none;cursor:pointer">ここまで行く</button></p>`
    : '';

  // attempt to find an external URL on the shishi/current record
  const externalCandidate = resolveExternalUrl(shishi);
  const externalUrl = sanitizeExternalUrl(externalCandidate);
  const linkHtml = externalUrl
    ? `<p><a href="${externalUrl}" target="_blank" rel="noopener noreferrer">詳細をみる</a></p>`
    : '';

  return `
    <div class="shishi-popup">
      <h3>${safeName}</h3>
      ${buildDescriptionHtml(shishi.description)}
      ${buildImageHtml(extractFileId(shishi.photo || shishi.image), shishi.name || '獅子舞画像')}
      ${navHtml}
      ${linkHtml}
    </div>
  `;
}

function extractItemsFromPayload(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

async function parseCollectionResponseAsJson(resp, url) {
  const text = await resp.text();
  if (!text) return [];

  try {
    const payload = JSON.parse(text);
    return extractItemsFromPayload(payload);
  } catch (error) {
    const preview = text.slice(0, 80).replace(/\s+/g, ' ');
    const htmlLike = /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
    if (RELATIVE_API_BASE && typeof url === 'string' && url.startsWith(`${API_BASE}/`) && htmlLike) {
      disableRelativeApiBase('received HTML instead of JSON');
    }
    console.warn(`fetch ${url} returned non-JSON response`, { preview, error });
    return null;
  }
}

async function fetchCollection(collection) {
  const headers = { Accept: 'application/json' };
  // support optional Directus public token for private collections
  if (env.VITE_DIRECTUS_TOKEN) {
    headers.Authorization = `Bearer ${env.VITE_DIRECTUS_TOKEN}`;
  }

  for (const url of buildEndpoints(collection)) {
    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.warn(`fetch ${url} returned ${resp.status}`);
        continue;
      }
      const items = await parseCollectionResponseAsJson(resp, url);
      if (items === null) continue;
      return items;
    } catch (error) {
      console.warn(`fetch ${url} failed:`, error);
    }
  }

  console.error(`${collection} データの取得に失敗しました`);
  return null;
}

async function fetchCollectionDirect(collection) {
  const url = `${DIRECTUS_URL}/items/${collection}`;
  try {
    const headers = { Accept: 'application/json' };
    if (env.VITE_DIRECTUS_TOKEN) {
      headers.Authorization = `Bearer ${env.VITE_DIRECTUS_TOKEN}`;
    }
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      console.warn(`fetch direct ${url} returned ${resp.status}`);
      return null;
    }
    return await parseCollectionResponseAsJson(resp, url);
  } catch (error) {
    console.warn(`fetch direct ${url} failed:`, error);
    return null;
  }
}

async function fetchShops() {
  const shops = await fetchCollection('shop');
  if (!shops) {
    return;
  }

  // store and render with filters
  shopsData = shops;
  try { renderShopFilterUI(); } catch (e) { console.warn('renderShopFilterUI failed', e); }
  try { renderShops(); } catch (e) { console.warn('renderShops failed', e); }
}

async function updateShishiLocation() {
  const shishiList = await fetchCollection('current');
  if (!shishiList) {
    return;
  }

  // filter to items updated within the last MAX_AGE_HOURS (configurable)
  // If MAX_AGE_HOURS === 0, treat as unlimited (show all items)
  let recentList;
  if (MAX_AGE_HOURS === 0) {
    recentList = shishiList;
  } else {
    recentList = shishiList.filter((it) => {
      const ts = getUpdatedAt(it);
      return isWithinHours(ts, MAX_AGE_HOURS);
    });
  }

  // show only items that are explicitly marked visible === true
  recentList = recentList.filter((it) => it && it.visible === true);

  // if you want to fall back to showing items without timestamps, modify above

  const seenIds = new Set();

  recentList.forEach((shishi) => {
    const coords = extractCoordinates(shishi);
    if (!coords) {
      console.warn('skip shishi missing coords', shishi.id || shishi.name);
      return;
    }

    const id = String(shishi.id ?? shishi.name ?? `${coords[0]}:${coords[1]}`);
    seenIds.add(id);

    if (shishiMarkers[id]) {
      shishiMarkers[id].setLatLng(coords);
      shishiMarkers[id].setPopupContent(buildShishiPopupContent(shishi));
      return;
    }

    const marker = L.marker(coords, { icon: shishiIcon }).addTo(map);
    marker.bindPopup(buildShishiPopupContent(shishi), {
      maxWidth: 360,
      className: 'shishi-popup-container'
    });
    shishiMarkers[id] = marker;
  });

  Object.keys(shishiMarkers).forEach((id) => {
    if (!seenIds.has(id)) {
      map.removeLayer(shishiMarkers[id]);
      delete shishiMarkers[id];
    }
  });
  // update sidebar list (show only recent items)
  try {
    renderShishiList(recentList);
  } catch (e) {
    console.warn('renderShishiList failed', e);
  }
}

fetchShops();
updateShishiLocation();
setInterval(updateShishiLocation, UPDATE_INTERVAL);
