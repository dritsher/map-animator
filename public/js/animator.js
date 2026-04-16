      // ── Config ──────────────────────────────────────────────────────────────
      const MAPTILER_KEY   = window.__config.maptilerApiKey;

      // ── State ───────────────────────────────────────────────────────────────
      let viewer = null;
      let currentBasemap = "eox-s2";
      let basemapShowLabels = true;
      let basemapMaxLevelOverride = null; // null = use each basemap's natural default

      // Per-track keyframe system. Built-in: 'camera', 'tod', 'borders'.
      // Dynamic: 'hl_{key}' (highlights), 'group_{id}', 'city_{id}'.
      const tracks = {};
      let selectedKfId     = null;   // camera-track kf id selected in sidebar
      let nextKfId         = 1;
      let selectedTrackIds = new Set(['camera']); // tracks that receive "Add Keyframe"

      let isPlaying = false;
      let playbackDirection = 1; // 1 = forward, -1 = reverse
      let playStartMs = null;
      let playStartT  = 0;
      let playbackT   = 0;  // current playback time in seconds
      let animRaf = null;

      // ── Built-in track initialisation ───────────────────────────────────────
      function initBuiltinTracks() {
        tracks['camera']  = { id:'camera',  label:'Camera',      category:'builtin', color:'#4a9eff', h:28, keyframes:[] };
        tracks['tod']     = { id:'tod',     label:'Time of Day', category:'builtin', color:'#ffaa44', h:22, keyframes:[] };
        tracks['borders'] = { id:'borders', label:'Borders',     category:'builtin', color:'#88cc88', h:22, keyframes:[] };
      }

      // ── Helpers ─────────────────────────────────────────────────────────────
      function setStatus(text) {
        document.getElementById("status").textContent = text;
      }

      function totalDuration() {
        return parseFloat(document.getElementById("totalDuration").value) || 10;
      }

      function playbackSpeed() {
        return parseFloat(document.getElementById("speedSelect").value) || 1;
      }

      // ── Basemap ─────────────────────────────────────────────────────────────
      const BASEMAP_META = {
        'maptiler-streets':       { source: 'MapTiler / OpenStreetMap',               resolution: 'Vector (unlimited zoom)', rights: 'API key required; free tier (100k tiles/month)', baseColor: '#c8d8e5' },
        'maptiler-basic':         { source: 'MapTiler / OpenStreetMap',               resolution: 'Vector (unlimited zoom)', rights: 'API key required; free tier (100k tiles/month)', baseColor: '#c8d8e5' },
        'maptiler-backdrop':      { source: 'MapTiler / OpenStreetMap',               resolution: 'Vector (unlimited zoom)', rights: 'API key required; free tier (100k tiles/month)', baseColor: '#c8d8e5' },
        'maptiler-satellite':     { source: 'MapTiler satellite imagery',             resolution: '~0.5m urban / ~5m elsewhere', rights: 'API key required; free tier (100k tiles/month)', baseColor: '#000811' },
        'carto-positron':         { source: 'CARTO / OpenStreetMap',                  resolution: 'Vector (unlimited zoom)', rights: 'Free with attribution; no key required', labelToggle: true, baseColor: '#d4dadc' },
        'carto-dark':             { source: 'CARTO / OpenStreetMap',                  resolution: 'Vector (unlimited zoom)', rights: 'Free with attribution; no key required', labelToggle: true, baseColor: '#0e0e0e' },
        'usgs-topo':              { source: 'USGS National Map',                      resolution: '~1m/px (US only)', rights: 'Public domain — US government data', defaultMaxLevel: 16, baseColor: '#d4dce8' },
        'usgs-relief':            { source: 'USGS National Map',                      resolution: '~30m/px (US only)', rights: 'Public domain — US government data', defaultMaxLevel: 13, baseColor: '#c8bfa0' },
        'opentopomap':            { source: 'OpenTopoMap / OpenStreetMap / SRTM',     resolution: '~30m/px', rights: 'Free — CC-BY-SA; attribution required', defaultMaxLevel: 17, baseColor: '#d4dce8' },
        'carto-voyager':          { source: 'CARTO / OpenStreetMap',                  resolution: 'Vector (unlimited zoom)', rights: 'Free with attribution; no key required', labelToggle: true, baseColor: '#d4d4d4' },
        'usgs-imagery':           { source: 'USGS National Map aerial imagery',       resolution: '~1m/px (US only)', rights: 'Public domain — US government data', defaultMaxLevel: 16, baseColor: '#000811' },
        'eox-s2':                 { source: 'ESA Sentinel-2 / EOX IT Services',       resolution: '~10m/px', note: '2024 annual cloud-free composite', rights: 'Free with attribution (Copernicus open data)', defaultMaxLevel: 17, baseColor: '#000a15' },
        'gebco':                  { source: 'GEBCO (General Bathymetric Chart)',       resolution: '~500m/px', note: 'ocean bathymetry; land shown flat', rights: 'Free — CC BY 4.0 (attribution required)', baseColor: '#1a3a5c' },
        'nasa-night':             { source: 'NASA/NOAA VIIRS (Black Marble)',          resolution: '~500m/px', note: '2016 annual composite', rights: 'Public domain — NASA open data', defaultMaxLevel: 8, baseColor: '#000000' },
        'nasa-blue-marble':       { source: 'NASA MODIS (Blue Marble)',               resolution: '~500m/px', note: 'seamless global composite', rights: 'Public domain — NASA open data', defaultMaxLevel: 8, baseColor: '#000a18' },
        'nasa-blue-marble-ocean': { source: 'NASA MODIS + SRTM30 bathymetry',        resolution: '~500m/px', note: 'includes ocean floor depth', rights: 'Public domain — NASA open data', defaultMaxLevel: 8, baseColor: '#000a18' },
        'nasa-terrain-color':     { source: 'NASA/METI ASTER GDEM',                  resolution: '~30m/px', rights: 'Public domain — NASA/METI open data', defaultMaxLevel: 12, baseColor: '#000000' },
        'nasa-terrain-grey':      { source: 'NASA/METI ASTER GDEM',                  resolution: '~30m/px', rights: 'Public domain — NASA/METI open data', baseColor: '#000000' },
        'nasa-truecolor-modis':   { source: 'NASA Terra MODIS',                      resolution: '~250m/px', dateType: 'daily', dateMin: '2000-02-24', rights: 'Public domain — NASA open data', defaultMaxLevel: 9, baseColor: '#000a18' },
        'nasa-truecolor-viirs':   { source: 'NASA NOAA-20 VIIRS',                    resolution: '~375m/px', dateType: 'daily', dateMin: '2018-01-01', rights: 'Public domain — NASA open data', defaultMaxLevel: 9, baseColor: '#000a18' },
      };

      function updateBasemapInfo(basemap) {
        const meta = BASEMAP_META[basemap] || {};
        const infoEl   = document.getElementById('basemapInfo');
        const dateRow  = document.getElementById('basemapDateRow');
        const dateInput = document.getElementById('basemapDateInput');
        const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

        let html = '';
        if (meta.source)     html += `<strong>Source:</strong> ${meta.source}<br>`;
        if (meta.resolution) { html += `<strong>Resolution:</strong> ${meta.resolution}`; if (meta.note) html += ` <span style="color:#999">(${meta.note})</span>`; html += '<br>'; }
        if (meta.rights)     html += `<strong>Rights:</strong> ${meta.rights}`;
        infoEl.innerHTML = html;

        const labelsRow = document.getElementById('basemapLabelsRow');
        if (meta.labelToggle) {
          labelsRow.style.display = '';
          document.getElementById('basemapLabelsCheck').checked = basemapShowLabels;
          updateLabelsButtons(basemapShowLabels);
        } else {
          labelsRow.style.display = 'none';
        }

        const maxInput = document.getElementById('basemapMaxLevelInput');
        maxInput.placeholder = meta.defaultMaxLevel ?? '—';
        maxInput.value = basemapMaxLevelOverride ?? '';

        if (meta.dateType === 'daily') {
          dateRow.style.display = '';
          dateInput.min = meta.dateMin;
          dateInput.max = yesterday;
          if (!dateInput.value || dateInput.value > yesterday) dateInput.value = yesterday;
        } else {
          dateRow.style.display = 'none';
        }
      }

      // Mapping for old basemap IDs that may appear in saved project files
      const BASEMAP_COMPAT = {
        'cesium-default':   'maptiler-streets',
        'cesium-night':     'nasa-night',
        'arcgis-satellite': 'maptiler-satellite',
        'arcgis-hillshade': 'maptiler-basic',
        'maptiler-outdoor': 'maptiler-streets',
        'maptiler-hybrid':  'maptiler-streets',
        'maptiler-topo':    'maptiler-basic',
      };

      async function createImageryProviderForBasemap(basemap, date) {
        // Silently upgrade any legacy IDs from old project files
        basemap = BASEMAP_COMPAT[basemap] ?? basemap;

        // Effective max level: user override takes precedence over each basemap's natural default
        const naturalMax = BASEMAP_META[basemap]?.defaultMaxLevel;
        const maxLevel   = basemapMaxLevelOverride ?? naturalMax; // undefined = no cap

        const mtUrl = (path, ext = 'png') =>
          `https://api.maptiler.com/${path}/{z}/{x}/{y}.${ext}?key=${encodeURIComponent(MAPTILER_KEY)}`;

        if (basemap === "maptiler-streets") {
          return new Cesium.UrlTemplateImageryProvider({
            url: mtUrl("maps/streets-v2/256"),
            credit: "© MapTiler © OpenStreetMap contributors",
            ...(maxLevel !== undefined && { maximumLevel: maxLevel }),
          });
        }
        if (basemap === "maptiler-basic") {
          return new Cesium.UrlTemplateImageryProvider({
            url: mtUrl("maps/basic-v2/256"),
            credit: "© MapTiler © OpenStreetMap contributors",
            ...(maxLevel !== undefined && { maximumLevel: maxLevel }),
          });
        }
        if (basemap === "maptiler-backdrop") {
          return new Cesium.UrlTemplateImageryProvider({
            url: mtUrl("maps/backdrop/256"),
            credit: "© MapTiler © OpenStreetMap contributors",
            ...(maxLevel !== undefined && { maximumLevel: maxLevel }),
          });
        }
        if (basemap === "maptiler-satellite") {
          return new Cesium.UrlTemplateImageryProvider({
            url: mtUrl("tiles/satellite-v2", "jpg"),
            credit: "© MapTiler",
            ...(maxLevel !== undefined && { maximumLevel: maxLevel }),
          });
        }
        if (basemap === "nasa-night") {
          return new Cesium.UrlTemplateImageryProvider({
            url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
            credit: "NASA GIBS / Black Marble",
            maximumLevel: maxLevel,
          });
        }
        const gibsUrl = (layer, date, tms, ext = 'jpg') =>
          `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/${tms}/{z}/{y}/{x}.${ext}`;
        const gibsStatic = (layer, tms, ext = 'jpg') =>
          `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${tms}/{z}/{y}/{x}.${ext}`;
        const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
        const tileDate = date || yesterday;

        if (basemap === "nasa-blue-marble") {
          return new Cesium.UrlTemplateImageryProvider({
            url: gibsStatic("BlueMarble_NextGeneration", "GoogleMapsCompatible_Level8"),
            credit: "NASA GIBS / Blue Marble",
            maximumLevel: maxLevel,
          });
        }
        if (basemap === "nasa-blue-marble-ocean") {
          return new Cesium.UrlTemplateImageryProvider({
            url: gibsStatic("BlueMarble_ShadedRelief_Bathymetry", "GoogleMapsCompatible_Level8"),
            credit: "NASA GIBS / Blue Marble",
            maximumLevel: maxLevel,
          });
        }
        if (basemap === "nasa-terrain-color") {
          return new Cesium.UrlTemplateImageryProvider({
            url: gibsStatic("ASTER_GDEM_Color_Shaded_Relief", "GoogleMapsCompatible_Level12"),
            credit: "NASA GIBS / ASTER GDEM",
            maximumLevel: maxLevel,
          });
        }
        if (basemap === "nasa-terrain-grey") {
          return new Cesium.UrlTemplateImageryProvider({
            url: gibsStatic("ASTER_GDEM_Greyscale_Shaded_Relief", "GoogleMapsCompatible_Level12"),
            credit: "NASA GIBS / ASTER GDEM",
            maximumLevel: maxLevel,
          });
        }
        if (basemap === "nasa-truecolor-modis") {
          return new Cesium.UrlTemplateImageryProvider({
            url: gibsUrl("MODIS_Terra_CorrectedReflectance_TrueColor", tileDate, "GoogleMapsCompatible_Level9"),
            credit: "NASA GIBS / MODIS Terra",
            maximumLevel: maxLevel,
          });
        }
        if (basemap === "nasa-truecolor-viirs") {
          return new Cesium.UrlTemplateImageryProvider({
            url: gibsUrl("VIIRS_NOAA20_CorrectedReflectance_TrueColor", tileDate, "GoogleMapsCompatible_Level9"),
            credit: "NASA GIBS / VIIRS NOAA-20",
            maximumLevel: maxLevel,
          });
        }
        if (basemap === "carto-positron") {
          const variant = basemapShowLabels ? "light_all" : "light_nolabels";
          return new Cesium.UrlTemplateImageryProvider({
            url: `https://a.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png`,
            credit: "© CARTO © OpenStreetMap contributors",
            ...(maxLevel !== undefined && { maximumLevel: maxLevel }),
          });
        }
        if (basemap === "carto-dark") {
          const variant = basemapShowLabels ? "dark_all" : "dark_nolabels";
          return new Cesium.UrlTemplateImageryProvider({
            url: `https://a.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png`,
            credit: "© CARTO © OpenStreetMap contributors",
            ...(maxLevel !== undefined && { maximumLevel: maxLevel }),
          });
        }
        if (basemap === "usgs-topo") {
          return new Cesium.UrlTemplateImageryProvider({
            url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
            credit: "USGS National Map",
            maximumLevel: maxLevel,
          });
        }
        if (basemap === "usgs-imagery") {
          return new Cesium.UrlTemplateImageryProvider({
            url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
            credit: "USGS National Map",
            maximumLevel: maxLevel,
          });
        }
        if (basemap === "eox-s2") {
          return new Cesium.UrlTemplateImageryProvider({
            url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg",
            credit: "Sentinel-2 cloudless by EOX IT Services — Contains modified Copernicus Sentinel data 2024",
            maximumLevel: maxLevel,
          });
        }
        if (basemap === "gebco") {
          return new Cesium.WebMapServiceImageryProvider({
            url: "https://wms.gebco.net/mapserv",
            layers: "GEBCO_LATEST",
            parameters: { transparent: false, format: "image/jpeg" },
            credit: "GEBCO — General Bathymetric Chart of the Oceans",
          });
        }
        if (basemap === "usgs-relief") {
          return new Cesium.UrlTemplateImageryProvider({
            url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}",
            credit: "USGS National Map — Shaded Relief",
            maximumLevel: maxLevel,
          });
        }
        if (basemap === "carto-voyager") {
          const variant = basemapShowLabels ? "rastertiles/voyager" : "rastertiles/voyager_nolabels";
          return new Cesium.UrlTemplateImageryProvider({
            url: `https://a.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png`,
            credit: "© CARTO © OpenStreetMap contributors",
            ...(maxLevel !== undefined && { maximumLevel: maxLevel }),
          });
        }
        if (basemap === "opentopomap") {
          return new Cesium.UrlTemplateImageryProvider({
            url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            subdomains: ["a", "b", "c"],
            credit: "OpenTopoMap — Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)",
            maximumLevel: 17,
          });
        }
        // Fallback
        return new Cesium.UrlTemplateImageryProvider({
          url: mtUrl("maps/streets-v2/256"),
          credit: "© MapTiler © OpenStreetMap contributors",
        });
      }

      let basemapLayer = null;
      const bmAdjust = { brightness: 1.0, contrast: 1.0, saturation: 1.0, hue: 0.0, gamma: 1.0 };

      function applyBmAdjust() {
        if (!basemapLayer) return;
        basemapLayer.brightness = bmAdjust.brightness;
        basemapLayer.contrast   = bmAdjust.contrast;
        basemapLayer.saturation = bmAdjust.saturation;
        basemapLayer.hue        = Cesium.Math.toRadians(bmAdjust.hue);
        basemapLayer.gamma      = bmAdjust.gamma;
      }

      async function applyBasemap(basemap) {
        if (!viewer) return;
        updateBasemapInfo(basemap);
        const dateInput = document.getElementById('basemapDateInput');
        const meta = BASEMAP_META[basemap] || {};
        const date = meta.dateType === 'daily' ? dateInput.value : null;
        const provider = await createImageryProviderForBasemap(basemap, date);
        viewer.imageryLayers.removeAll();
        // Add a polar fill layer beneath the basemap to cover the ±85°–±90° caps
        // that Web Mercator tiles don't reach. We fetch a level-0 tile from the
        // real provider and serve it via GeographicTilingScheme (full ±90°), which
        // stretches the basemap's edge pixels into the caps for a natural color match.
        // Falls back to the hand-picked baseColor if the tile fetch fails.
        const bgColor = meta.baseColor ?? '#000000';
        const geoScheme = new Cesium.GeographicTilingScheme();
        // Polar fill layer: covers ±85°–±90° where Web Mercator tiles don't reach.
        // Serves the matching WM level-1 tile via GeographicTilingScheme so longitude
        // bands align and edge pixels blend naturally into the polar caps.
        // After fetching each tile, we sample its brightness: if it is nearly black
        // (outside-coverage tile from regional providers like USGS), we substitute
        // the solid baseColor instead. If CORS blocks sampling we also use the solid
        // fallback — either way, no black quadrants.
        const makeSolidTile = () => {
          const c = document.createElement('canvas');
          c.width = c.height = 1;
          c.getContext('2d').fillStyle = bgColor;
          c.getContext('2d').fillRect(0, 0, 1, 1);
          return c;
        };
        const polarFillProvider = {
          get tileWidth()        { return 256; },
          get tileHeight()       { return 256; },
          get minimumLevel()     { return 0; },
          get maximumLevel()     { return 2; },
          get tilingScheme()     { return geoScheme; },
          get rectangle()        { return geoScheme.rectangle; },
          get tileDiscardPolicy(){ return undefined; },
          get errorEvent()       { return new Cesium.Event(); },
          get ready()            { return true; },
          get readyPromise()     { return Promise.resolve(true); },
          get credit()           { return undefined; },
          get hasAlphaChannel()  { return false; },
          getTileCredits()       { return []; },
          requestImage(x, y, level) {
            // Try to fetch a tile and validate it has content (brightness check).
            // Returns the tile image, or null if it's black/empty/CORS-blocked.
            const tryTile = (tx, ty) => {
              try {
                const req = provider.requestImage(tx, ty, 2);
                const p = req instanceof Promise ? req : (req ? Promise.resolve(req) : Promise.resolve(null));
                return p.then(tile => {
                  if (!tile) return null;
                  try {
                    const c = document.createElement('canvas');
                    c.width = c.height = 8;
                    const ctx = c.getContext('2d');
                    ctx.drawImage(tile, 0, 0, 8, 8);
                    const d = ctx.getImageData(0, 0, 8, 8).data;
                    let sum = 0;
                    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i+1] + d[i+2];
                    return sum / (d.length / 4 * 3) < 15 ? null : tile;
                  } catch (e) { return null; } // CORS blocked
                }).catch(() => null);
              } catch (e) { return Promise.resolve(null); }
            };
            return (async () => {
              const tile = await tryTile(x, y);
              if (tile) return tile;
              // Tile was black/empty — try x=0 (western hemisphere) which tends to
              // have ocean/coverage data even for regional providers like USGS.
              if (x !== 0) {
                const fallback = await tryTile(0, y);
                if (fallback) return fallback;
              }
              return makeSolidTile();
            })();
          },
          pickFeatures() { return undefined; },
        };
        viewer.imageryLayers.addImageryProvider(polarFillProvider);
        basemapLayer = viewer.imageryLayers.addImageryProvider(provider);
        applyBmAdjust();
        currentBasemap = basemap;
        reapplyMasks();
      }

      function reapplyMasks() {
        // viewer.imageryLayers.removeAll() destroys mask ImageryLayers along with the
        // basemap. Re-create them on top of the new basemap for any active mask region.
        for (const h of highlights) {
          if (h.invert && h.fillOpacity > 0 && h.fillEntities.length > 0) {
            h.fillEntities = []; // layers were destroyed by removeAll()
            setFillOpacity(h.key, h.fillOpacity);
          }
        }
        for (const g of regionGroups) {
          if (g.invert && g.fillOpacity > 0 && g.fillEntities.length > 0) {
            g.fillEntities = []; // layers were destroyed by removeAll()
            const polygons = getGroupPolygons(g);
            g.fillEntities = makeFillEntities(polygons, g.color, g.fillOpacity, true, null);
            g.fillEntities.forEach(item => { item.show = g.visible !== false; });
          }
        }
        // Re-add image overlay layers on top of the new basemap
        for (const o of imageOverlays) {
          const rect = Cesium.Rectangle.fromDegrees(o.west, o.south, o.east, o.north);
          const provider = new Cesium.SingleTileImageryProvider({ url: o.url, rectangle: rect });
          o.layer = viewer.imageryLayers.addImageryProvider(provider);
          o.layer.alpha = o.opacity;
          o.layer.show  = o.visible;
        }
      }

      // ── Looks / Presets ─────────────────────────────────────────────────────
      // A look captures basemap + adjustments + border opacity + default colors.
      // Values mirror bmAdjust: brightness/contrast/saturation 0-2, hue in degrees, gamma 0-2.

      let defaultRegionColor = "#ff9900";

      // Curated map-friendly palette (Tableau-inspired, visually distinct on dark/light basemaps)
      const REGION_PALETTE = [
        "#4e79a7", // blue
        "#f28e2b", // orange
        "#e15759", // red
        "#76b7b2", // teal
        "#59a14f", // green
        "#edc948", // yellow
        "#b07aa1", // purple
        "#ff9da7", // pink
        "#9c755f", // brown
        "#bab0ac", // gray
      ];
      let regionPaletteIdx = 0;
      function nextRegionColor() {
        return REGION_PALETTE[regionPaletteIdx++ % REGION_PALETTE.length];
      }
      let defaultCityColor   = "#ffffff";
      let defaultCityDotSize = 8;

      const BUILT_IN_LOOKS = [
        {
          name: "Default",
          basemap: "carto-positron",
          brightness: 1.0, contrast: 1.0, saturation: 1.0, hue: 0, gamma: 1.0,
          countryOpacity: 0.7, stateOpacity: 0.2,
          regionColor: "#ff9900", cityColor: "#ffffff", cityDotSize: 8,
        },
        {
          name: "Dark",
          basemap: "carto-dark",
          brightness: 0.45, contrast: 1.1, saturation: 0.15, hue: 0, gamma: 0.85,
          countryOpacity: 0.45, stateOpacity: 0.3,
          regionColor: "#ff9900", cityColor: "#ffffff", cityDotSize: 8,
        },
        {
          name: "Satellite",
          basemap: "maptiler-satellite",
          brightness: 1.0, contrast: 1.15, saturation: 1.2, hue: 0, gamma: 1.0,
          countryOpacity: 0.6, stateOpacity: 0.4,
          regionColor: "#ffff00", cityColor: "#ffffff", cityDotSize: 8,
        },
        {
          name: "Night",
          basemap: "nasa-night",
          brightness: 1.0, contrast: 1.0, saturation: 1.0, hue: 0, gamma: 0.9,
          countryOpacity: 0.3, stateOpacity: 0.2,
          regionColor: "#00bfff", cityColor: "#ffee55", cityDotSize: 8,
        },
        {
          name: "Monochrome",
          basemap: "carto-positron",
          brightness: 0.85, contrast: 1.2, saturation: 0.0, hue: 0, gamma: 1.0,
          countryOpacity: 0.8, stateOpacity: 0.55,
          regionColor: "#ff3333", cityColor: "#ffffff", cityDotSize: 8,
        },
        {
          name: "Election",
          basemap: "carto-positron",
          brightness: 0.55, contrast: 1.3, saturation: 0.1, hue: 0, gamma: 0.9,
          countryOpacity: 0.6, stateOpacity: 0.4,
          regionColor: "#4488ff", cityColor: "#ffffff", cityDotSize: 8,
        },
      ];

      function loadUserLooks() {
        try { return JSON.parse(localStorage.getItem("map-animator-looks") || "[]"); }
        catch (e) { return []; }
      }

      function saveUserLooks(looks) {
        localStorage.setItem("map-animator-looks", JSON.stringify(looks));
      }

      function getAllLooks() {
        return [...BUILT_IN_LOOKS, ...loadUserLooks()];
      }

      function isBuiltIn(name) {
        return BUILT_IN_LOOKS.some(l => l.name === name);
      }

      function renderLooksSelect() {
        const sel = document.getElementById("looksSelect");
        const prev = sel.value;
        sel.innerHTML = "";
        const userLooks = loadUserLooks();

        const builtInGroup = document.createElement("optgroup");
        builtInGroup.label = "Built-in";
        BUILT_IN_LOOKS.forEach(l => {
          const o = document.createElement("option");
          o.value = l.name;
          o.textContent = l.name;
          builtInGroup.appendChild(o);
        });
        sel.appendChild(builtInGroup);

        if (userLooks.length) {
          const userGroup = document.createElement("optgroup");
          userGroup.label = "Saved";
          userLooks.forEach(l => {
            const o = document.createElement("option");
            o.value = l.name;
            o.textContent = l.name;
            userGroup.appendChild(o);
          });
          sel.appendChild(userGroup);
        }

        // Restore selection if still present
        if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
        // Enable/disable delete button
        document.getElementById("deleteLookBtn").disabled = isBuiltIn(sel.value);
      }

      function captureLook(name) {
        return {
          name,
          basemap: currentBasemap,
          brightness: bmAdjust.brightness,
          contrast:   bmAdjust.contrast,
          saturation: bmAdjust.saturation,
          hue:        bmAdjust.hue,
          gamma:      bmAdjust.gamma,
          countryOpacity: parseInt(document.getElementById("countryBorderOpacity").value) / 100,
          stateOpacity:   parseInt(document.getElementById("stateBorderOpacity").value) / 100,
          borderColor,
          regionColor: defaultRegionColor,
          cityColor:   defaultCityColor,
          cityDotSize: defaultCityDotSize,
        };
      }

      async function applyLook(look) {
        // 1. Basemap — resolve any legacy IDs before setting the select
        const resolvedBasemap = BASEMAP_COMPAT[look.basemap] ?? look.basemap;
        document.getElementById("basemapSelect").value = resolvedBasemap;
        await applyBasemap(resolvedBasemap);

        // 2. Adjustments — update bmAdjust and sliders together
        const sliderMap = [
          { id: "bm-brightness", key: "brightness", toSlider: v => Math.round(v * 100), fmt: v => Math.round(v * 100) + "%" },
          { id: "bm-contrast",   key: "contrast",   toSlider: v => Math.round(v * 100), fmt: v => Math.round(v * 100) + "%" },
          { id: "bm-saturation", key: "saturation", toSlider: v => Math.round(v * 100), fmt: v => Math.round(v * 100) + "%" },
          { id: "bm-hue",        key: "hue",        toSlider: v => v,                   fmt: v => (v > 0 ? "+" : "") + v + "°" },
          { id: "bm-gamma",      key: "gamma",      toSlider: v => Math.round(v * 100), fmt: v => (v).toFixed(2) },
        ];
        sliderMap.forEach(({ id, key, toSlider, fmt }) => {
          const raw = look[key];
          bmAdjust[key] = raw;
          document.getElementById(id).value = toSlider(raw);
          document.getElementById(id + "-val").textContent = fmt(raw);
        });
        applyBmAdjust();

        // 3. Border opacities (backward-compat: old looks have a single borderOpacity)
        const legacyBo = look.borderOpacity;
        const coPct = Math.round((look.countryOpacity ?? legacyBo ?? 0.7) * 100);
        const soPct = Math.round((look.stateOpacity   ?? legacyBo ?? 0.5) * 100);
        document.getElementById("countryBorderOpacity").value = coPct;
        document.getElementById("countryBorderOpacityVal").textContent = coPct + "%";
        document.getElementById("stateBorderOpacity").value = soPct;
        document.getElementById("stateBorderOpacityVal").textContent = soPct + "%";
        if (look.borderColor) setBorderColor(look.borderColor);
        setCountryBorderOpacity(coPct / 100);
        setStateBorderOpacity(soPct / 100);

        // 4. Default colors
        defaultRegionColor = look.regionColor || "#ff9900";
        defaultCityColor   = look.cityColor   || "#ffffff";
        defaultCityDotSize = look.cityDotSize  || 8;
        document.getElementById("defaultRegionColorPicker").value = defaultRegionColor;
        document.getElementById("defaultCityColorPicker").value   = defaultCityColor;
      }

      // ── Cesium Init ─────────────────────────────────────────────────────────
      function initViewer() {
        const _isMobile = navigator.maxTouchPoints > 1 || /iPhone|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 1366;

        // Check WebGL support before attempting to load Cesium
        const testCanvas = document.createElement("canvas");
        const gl = testCanvas.getContext("webgl2") || testCanvas.getContext("webgl");
        if (!gl) {
          document.getElementById("cesiumContainer").innerHTML =
            `<div style="display:flex;align-items:center;justify-content:center;height:100%;background:#111;color:#eee;text-align:center;padding:24px;font-family:Arial,sans-serif;">
              <div><h2 style="color:#fff;">WebGL Not Available</h2>
              <p>This browser does not support WebGL, which is required to display the map.</p>
              <p>Try opening this page in Safari on desktop, or enable WebGL in your browser settings.</p></div>
            </div>`;
          return;
        }

        try {
        viewer = new Cesium.Viewer("cesiumContainer", {
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          creditContainer: document.getElementById("cesiumCreditSink"),
          // ArcGIS elevation causes geometric holes at the poles in Cesium's renderer.
          // Use the smooth mathematical ellipsoid until a Cesium-native terrain
          // source (e.g. Ion World Terrain) is available.
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
          // preserveDrawingBuffer needed for screenshot export — skip on mobile to save GPU memory
          ...(_isMobile ? {} : { contextOptions: { webgl: { preserveDrawingBuffer: true } } }),
        });

        // Update the tile-level indicator whenever the camera moves
        const levelEl = document.getElementById('basemapCurrentLevel');
        function updateLevelIndicator() {
          const h = viewer.camera.positionCartographic.height;
          const z = Math.max(0, Math.min(22, Math.round(Math.log2(40075016 / h) + 2)));
          levelEl.textContent = z;
        }
        viewer.camera.changed.addEventListener(updateLevelIndicator);
        updateLevelIndicator();

        viewer.scene.fog.enabled = true;
        viewer.scene.fog.density = 0.0002;
        viewer.scene.fog.minimumBrightness = 0.85;

        const isMobile = navigator.maxTouchPoints > 1 || /iPhone|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 1366;
        if (isMobile) {
          viewer.scene.globe.maximumScreenSpaceError = 16; // coarser tiles → fewer fetched on zoom
          viewer.scene.globe.preloadSiblings = false;
          viewer.scene.globe.preloadAncestors = false;
          viewer.scene.globe.enableLighting = false;
          viewer.scene.globe.tileCacheSize = 25;
          viewer.scene.globe.loadingDescendantLimit = 2;
          viewer.scene.skyAtmosphere.show = false;
          viewer.scene.globe.showGroundAtmosphere = false;
          viewer.shadows = false;
          viewer.scene.shadowMap.enabled = false;
          viewer.scene.moon.show = false;
          viewer.scene.skyBox.show = true;
          viewer.targetFrameRate = 30;
          currentBasemap = 'carto-dark'; // dark basemap — light borders pop against dark background
          basemapShowLabels = false;         // hide labels on mobile
          document.getElementById('basemapSelect').value = 'carto-dark';
          document.getElementById('basemapLabelsCheck').checked = false;
        } else {
          viewer.scene.globe.maximumScreenSpaceError = 2;
          viewer.scene.globe.preloadSiblings = true;
          viewer.scene.globe.preloadAncestors = true;
          viewer.scene.globe.enableLighting = true;
          viewer.scene.light = new Cesium.SunLight({ color: Cesium.Color.WHITE, intensity: 3.0 });
          viewer.scene.skyAtmosphere.show = true;
          viewer.scene.globe.showGroundAtmosphere = true;
          viewer.shadows = true;
          viewer.scene.shadowMap.enabled = true;
          viewer.scene.shadowMap.softShadows = true;
          viewer.scene.moon.show = true;
          viewer.scene.sun.show = true;
          viewer.scene.skyBox.show = true;
        }

        // When a polygon tessellation error reaches the scene:
        // 1. Remove all fill entities immediately so the bad geometry is gone.
        // 2. Restart the render loop via setTimeout — setting useDefaultRenderLoop
        //    synchronously in this handler causes recursive crashes because it triggers
        //    a new render frame before the current call stack unwinds.
        viewer.scene.renderError.addEventListener(() => {
          for (const h of highlights) {
            h.fillEntities.forEach(removeFillItem);
            h.fillEntities = [];
          }
          setTimeout(() => { viewer.useDefaultRenderLoop = true; }, 0);
        });

        setTimeout(() => { updateBasemapInfo(currentBasemap); applyBasemap(currentBasemap); }, 0);

        setStatus("Ready. Add keyframes to build an animation.");
        } catch (e) {
          console.error("Cesium init failed:", e);
          document.getElementById("cesiumContainer").innerHTML =
            `<div style="display:flex;align-items:center;justify-content:center;height:100%;background:#111;color:#eee;text-align:center;padding:24px;font-family:Arial,sans-serif;">
              <div><h2 style="color:#fff;">Map Could Not Load</h2>
              <p>The 3D map failed to initialize, likely due to memory or WebGL limitations on this device.</p>
              <p>For the full experience, open this page on a desktop browser.</p>
              <p style="font-size:11px;color:#aaa;margin-top:16px;">${e.message || e}</p></div>
            </div>`;
        }
      }

      // ── Camera Helpers ──────────────────────────────────────────────────────
      const SCENE_MODE_NAMES = {
        [Cesium.SceneMode.SCENE3D]:       "3d",
        [Cesium.SceneMode.SCENE2D]:       "2d",
        [Cesium.SceneMode.COLUMBUS_VIEW]: "columbus",
      };
      const SCENE_MODE_LABELS = { "3d": "3D", "2d": "2D", "columbus": "CV" };

      function getCurrentSceneModeName() {
        return SCENE_MODE_NAMES[viewer.scene.mode] || "3d";
      }

      function captureTrackState(trackId) {
        if (trackId === 'camera') {
          const cam = viewer.camera;
          const carto = cam.positionCartographic;
          return {
            lon: Cesium.Math.toDegrees(carto.longitude),
            lat: Cesium.Math.toDegrees(carto.latitude),
            height: carto.height,
            heading: Cesium.Math.toDegrees(cam.heading),
            pitch:   Cesium.Math.toDegrees(cam.pitch),
            roll:    Cesium.Math.toDegrees(cam.roll),
            sceneMode: getCurrentSceneModeName(),
          };
        }
        if (trackId === 'tod') {
          return { todMinutes: parseInt(document.getElementById('todSlider').value) };
        }
        if (trackId === 'borders') {
          return {
            countryOpacity: parseInt(document.getElementById('countryBorderOpacity').value) / 100,
            stateOpacity:   parseInt(document.getElementById('stateBorderOpacity').value) / 100,
            countyOpacity:  parseInt(document.getElementById('countyBorderOpacity').value) / 100,
            borderColor,
          };
        }
        if (trackId.startsWith('hl_')) {
          const h = highlights.find(h => h.key === trackId.slice(3));
          return h ? { color:h.color, outlineOpacity:h.outlineOpacity, outlineWidth:h.outlineWidth,
                       subregionOpacity:h.subregionOpacity, subregionWidth:h.subregionWidth,
                       fillOpacity:h.fillOpacity, invert:h.invert, showLabel:h.showLabel,
                       labelColor:h.labelColor??h.color,
                       labelOpacity:h.labelOpacity??1, labelFontSize:h.labelFontSize??14,
                       labelFontWeight:h.labelFontWeight??'normal', labelFontFamily:h.labelFontFamily??'Arial',
                       labelOffsetX:h.labelOffsetX??0, labelOffsetY:h.labelOffsetY??0 } : null;
        }
        if (trackId.startsWith('group_')) {
          const g = regionGroups.find(g => g.id === parseInt(trackId.slice(6)));
          return g ? { color:g.color, fillOpacity:g.fillOpacity, invert:g.invert, outlineOpacity:g.outlineOpacity??1, outlineWidth:g.outlineWidth??2 } : null;
        }
        if (trackId.startsWith('city_')) {
          const m = cityMarkers.find(m => m.id === parseInt(trackId.slice(5)));
          return m ? {
            color:             m.color,
            labelColor:        m.labelColor        ?? m.color,
            dotSize:           m.dotSize,
            showLabel:         m.showLabel,
            dotOpacity:        m.dotOpacity         ?? 1.0,
            labelOpacity:      m.labelOpacity       ?? 1.0,
            fontSize:          m.fontSize           ?? 13,
            fontWeight:        m.fontWeight         ?? 'normal',
            fontStyle:         m.fontStyle          ?? 'normal',
            fontFamily:        m.fontFamily         ?? 'Arial',
            offsetX:           m.offsetX            ?? 0,
            offsetY:           m.offsetY            ?? 0,
            outlineWidth:      m.outlineWidth       ?? 2,
            showBackground:    m.showBackground     ?? false,
            backgroundColor:   m.backgroundColor   ?? '#000000',
            backgroundOpacity: m.backgroundOpacity  ?? 0.5,
            bgPadX:            m.bgPadX             ?? 5,
            bgPadY:            m.bgPadY             ?? 3,
          } : null;
        }
        if (trackId.startsWith('kml_')) {
          const kml = kmlOverlays.find(k => k.id === parseInt(trackId.slice(4)));
          return kml ? {
            visible: kml.visible,
            layers: kml.layers.map(l => ({ name: l.name, opacity: l.opacity })),
          } : null;
        }
        if (trackId.startsWith('ann_')) {
          const ann = annotations.find(a => a.id === parseInt(trackId.slice(4)));
          return ann ? { opacity: ann.opacity } : null;
        }
        if (trackId.startsWith('route_')) {
          const g = cityRouteGroups.find(g => g.id === parseInt(trackId.slice(6)));
          return g ? { routeStart: g.routeStart ?? 0, routeEnd: g.routeEnd ?? 100 } : null;
        }
        if (trackId.startsWith('gmember_')) {
          // gmember_<groupId>_<memberKey> — capture this member's current fill opacity
          const underIdx = trackId.indexOf('_', 'gmember_'.length);
          const groupId = parseInt(trackId.slice('gmember_'.length, underIdx));
          const memberKey = trackId.slice(underIdx + 1);
          const g = regionGroups.find(g => g.id === groupId);
          const member = g?.members.find(m => m.key === memberKey);
          return member ? { opacity: member.fillOpacity ?? g.fillOpacity } : null;
        }
        return null;
      }

      // Shared helper — also updates the scene mode toggle button UI.
      function triggerSceneMode(mode, duration) {
        if (mode === "2d")       viewer.scene.morphTo2D(duration);
        else if (mode === "columbus") viewer.scene.morphToColumbusView(duration);
        else                     viewer.scene.morphTo3D(duration);
        document.querySelectorAll(".scene-mode-btn").forEach(b =>
          b.classList.toggle("active", b.dataset.mode === mode)
        );
      }

      function setCameraState(state) {
        const { lon, lat, height, heading, pitch, roll, todMinutes } = state;
        // Only move camera if position data is present (camera track may have no keyframes).
        // camera.setView() calls scene.completeMorph() internally — skip during a
        // mode transition so the animated morph can play out without snapping.
        if (lon !== undefined && viewer.scene.mode !== Cesium.SceneMode.MORPHING) {
          viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
            orientation: {
              heading: Cesium.Math.toRadians(heading),
              pitch:   Cesium.Math.toRadians(pitch),
              roll:    Cesium.Math.toRadians(roll),
            },
          });
        }
        if (todMinutes !== undefined) {
          const rounded = Math.round(todMinutes);
          document.getElementById("todSlider").value = rounded;
          document.getElementById("todDisplay").textContent = todMinutesToDisplay(rounded);
          setTimeOfDay(rounded);
        }
        applySceneState(state);
      }

      // Apply animated scene overlay state (border opacity, highlight/group/city states).
      // Updates Cesium entities in-place where possible to avoid full rebuilds each frame.
      function applySceneState(state) {
        // Border opacities — update Cesium visual every frame, sync sliders only when stopped.
        if (state.countryOpacity !== undefined) {
          setCountryBorderOpacity(state.countryOpacity);
          if (!isPlaying) {
            const pct = Math.round(state.countryOpacity * 100);
            document.getElementById("countryBorderOpacity").value = pct;
            document.getElementById("countryBorderOpacityVal").textContent = pct + "%";
          }
        }
        if (state.stateOpacity !== undefined) {
          setStateBorderOpacity(state.stateOpacity);
          if (!isPlaying) {
            const pct = Math.round(state.stateOpacity * 100);
            document.getElementById("stateBorderOpacity").value = pct;
            document.getElementById("stateBorderOpacityVal").textContent = pct + "%";
          }
        }
        if (state.countyOpacity !== undefined) {
          setCountyBorderOpacity(state.countyOpacity);
        }
        if (state.borderColor !== undefined) {
          setBorderColor(state.borderColor);
        }

        // Highlight states
        (state.highlightStates || []).forEach(hs => {
          const h = highlights.find(h => h.key === hs.key);
          if (!h) return;
          const oldColor = h.color, oldInvert = h.invert, oldFillOpacity = h.fillOpacity;
          h.color  = hs.color;
          h.invert = hs.invert;
          const colorChanged  = oldColor  !== hs.color;
          const invertChanged = oldInvert !== hs.invert;

          // Outline — update live ref (CallbackProperty reads it next frame)
          if (hs.outlineOpacity !== h.outlineOpacity || colorChanged) {
            h.outlineOpacity = hs.outlineOpacity;
            h.outlineWidth   = hs.outlineWidth;
            if (h.outlineRef) { h.outlineRef.color = h.color; h.outlineRef.opacity = hs.outlineOpacity; }
            else refreshOutlineEntities(h);
          }

          // Subregion — same pattern
          if (hs.subregionOpacity !== h.subregionOpacity || colorChanged) {
            h.subregionOpacity = hs.subregionOpacity;
            h.subregionWidth   = hs.subregionWidth;
            if (h.subregionRef && h.subregionEntities.length > 0) {
              h.subregionRef.color = h.color; h.subregionRef.opacity = hs.subregionOpacity;
            } else refreshSubregionEntities(h);
          }

          // Fill — ImageryLayer: set .alpha directly; ref: update; else rebuild
          if (hs.fillOpacity !== oldFillOpacity || colorChanged || invertChanged) {
            if (h.fillRef && h.fillEntities.length > 0 && !h.invert && !invertChanged && !colorChanged) {
              h.fillRef.opacity = hs.fillOpacity;
              h.fillOpacity = hs.fillOpacity;
            } else if (h.fillEntities.length > 0 && !h.invert && !invertChanged) {
              // ImageryLayer or legacy
              h.fillEntities.forEach(item => {
                if (item instanceof Cesium.ImageryLayer) item.alpha = hs.fillOpacity;
              });
              h.fillOpacity = hs.fillOpacity;
            } else {
              setFillOpacity(h.key, hs.fillOpacity);
            }
          }

          // Label visibility and style
          if (hs.showLabel !== undefined && hs.showLabel !== h.showLabel) {
            setHighlightLabel(h.key, hs.showLabel);
          }
          h.labelColor      = hs.labelColor      ?? h.labelColor;
          h.labelOpacity    = hs.labelOpacity    ?? h.labelOpacity;
          h.labelFontSize   = hs.labelFontSize   ?? h.labelFontSize;
          h.labelFontWeight = hs.labelFontWeight ?? h.labelFontWeight;
          h.labelFontFamily = hs.labelFontFamily ?? h.labelFontFamily;
          h.labelOffsetX    = hs.labelOffsetX    ?? h.labelOffsetX;
          h.labelOffsetY    = hs.labelOffsetY    ?? h.labelOffsetY;
          if (h.labelEntity) updateHighlightLabelStyle(h.key);
        });

        // Group states
        (state.groupStates || []).forEach(gs => {
          const g = regionGroups.find(g => g.id === gs.id);
          if (!g) return;
          const colorChanged  = g.color !== gs.color;
          const invertChanged = g.invert !== gs.invert;
          const widthChanged  = (g.outlineWidth??2) !== (gs.outlineWidth??g.outlineWidth??2);
          const newOutlineOpacity = gs.outlineOpacity ?? g.outlineOpacity ?? 1;
          g.color        = gs.color;
          g.invert       = gs.invert;
          g.outlineWidth = gs.outlineWidth ?? g.outlineWidth ?? 2;

          // Outline: fast-path via CallbackProperty ref
          if (g.outlineRef && !colorChanged && !widthChanged) {
            g.outlineRef.color   = g.color;
            g.outlineRef.opacity = newOutlineOpacity;
            g.outlineOpacity     = newOutlineOpacity;
          } else {
            g.outlineOpacity = newOutlineOpacity;
          }

          // Fill: fast-path via per-member CallbackProperty refs (normal mode) or group ref (invert mode)
          if (!g.invert && !invertChanged && !colorChanged &&
              g.members.length > 0 && g.members.every(m => (m.fillEntities?.length ?? 0) > 0)) {
            g.fillOpacity = gs.fillOpacity;
            g.members.forEach(m => {
              if (m.fillRef) { m.fillRef.color = g.color; m.fillRef.opacity = gs.fillOpacity; }
            });
          } else if (g.invert && g.fillRef && g.fillEntities.length > 0 && !invertChanged && !colorChanged) {
            g.fillRef.color   = g.color;
            g.fillRef.opacity = gs.fillOpacity;
            g.fillOpacity     = gs.fillOpacity;
          } else if (gs.fillOpacity !== g.fillOpacity || colorChanged || invertChanged || widthChanged) {
            g.fillOpacity = gs.fillOpacity;
            refreshGroupEntities(g);
          }
        });

        // Route states — update routeStart/routeEnd; CallbackProperty reads group directly
        (state.routeStates || []).forEach(rs => {
          const g = cityRouteGroups.find(g => g.id === rs.id);
          if (!g) return;
          g.routeStart = rs.routeStart ?? g.routeStart;
          g.routeEnd   = rs.routeEnd   ?? g.routeEnd;
        });

        // Member states — override individual member opacity (sequential appearance)
        // Applied after groupStates so individual overrides win over group-level animation.
        (state.memberStates || []).forEach(ms => {
          const g = regionGroups.find(g => g.id === ms.groupId);
          if (!g || g.invert) return;
          const member = g.members.find(m => m.key === ms.memberKey);
          if (!member) return;
          const opacity = ms.opacity ?? g.fillOpacity;
          member.fillOpacity = opacity;
          const memberBadge = document.querySelector(`.group-member-item[data-group-id="${ms.groupId}"][data-member-key="${CSS.escape(ms.memberKey)}"] .group-member-badge`);
          if (memberBadge) memberBadge.textContent = Math.round(opacity * 100) + '%';
          if (member.fillRef && (member.fillEntities?.length ?? 0) > 0) {
            member.fillRef.color   = g.color;
            member.fillRef.opacity = opacity;
          } else if (opacity > 0) {
            // Entities don't exist yet — create them now (member was at opacity 0)
            const entry = regionLookup.get(member.name);
            const polygons = entry?.polygons || [];
            if (!member.fillRef) member.fillRef = { color: g.color, opacity };
            member.fillRef.color   = g.color;
            member.fillRef.opacity = opacity;
            if (polygons.length > 0) {
              member.fillEntities = makeFillEntities(polygons, g.color, opacity, false, member.fillRef);
              member.fillEntities.forEach(item => { item.show = g.visible !== false; });
            }
          } else if (member.fillRef) {
            member.fillRef.opacity = 0;
          }
        });

        // City states
        (state.cityStates || []).forEach(cs => {
          const m = cityMarkers.find(m => m.id === cs.id);
          if (!m) return;
          const needRebuild = cs.color !== m.color || Math.round(cs.dotSize) !== m.dotSize;
          m.color             = cs.color;
          m.labelColor        = cs.labelColor        ?? m.labelColor;
          m.dotSize           = Math.round(cs.dotSize);
          m.showLabel         = cs.showLabel;
          m.dotOpacity        = cs.dotOpacity         ?? m.dotOpacity;
          m.labelOpacity      = cs.labelOpacity       ?? m.labelOpacity;
          m.fontSize          = cs.fontSize           ?? m.fontSize;
          m.fontWeight        = cs.fontWeight         ?? m.fontWeight;
          m.fontStyle         = cs.fontStyle          ?? m.fontStyle;
          m.fontFamily        = cs.fontFamily         ?? m.fontFamily;
          m.offsetX           = cs.offsetX            ?? m.offsetX;
          m.offsetY           = cs.offsetY            ?? m.offsetY;
          m.outlineWidth      = cs.outlineWidth       ?? m.outlineWidth;
          m.showBackground    = cs.showBackground     ?? m.showBackground;
          m.backgroundColor   = cs.backgroundColor   ?? m.backgroundColor;
          m.backgroundOpacity = cs.backgroundOpacity  ?? m.backgroundOpacity;
          m.bgPadX            = cs.bgPadX             ?? m.bgPadX;
          m.bgPadY            = cs.bgPadY             ?? m.bgPadY;
          if (needRebuild) updateCityEntity(m);
          else             updateCityLabelStyle(m);
        });

        (state.kmlStates || []).forEach(ks => {
          const kml = kmlOverlays.find(k => k.id === ks.id);
          if (!kml) return;
          kml.visible = ks.visible;
          kml.dataSource.show = ks.visible;
          (ks.layers || []).forEach((ls, i) => {
            const layer = kml.layers[i];
            if (layer && Math.abs(layer.opacity - ls.opacity) > 0.001) applyKmlLayerOpacity(layer, ls.opacity);
          });
          if (!isPlaying) renderKmlList();
        });
        (state.annStates || []).forEach(as => {
          const ann = annotations.find(a => a.id === as.id);
          if (!ann) return;
          ann.opacity = as.opacity;
          applyAnnotationOpacity(ann);
        });
      }

      // ── Keyframes ───────────────────────────────────────────────────────────
      function addKeyframe() {
        if (!viewer) return;
        const t = parseFloat(playbackT.toFixed(2));
        let count = 0;
        for (const trackId of selectedTrackIds) {
          const track = tracks[trackId];
          if (!track) continue;
          const state = captureTrackState(trackId);
          if (!state) continue;
          const existing = track.keyframes.find(k => k.time === t);
          if (existing) {
            Object.assign(existing, state);
          } else {
            const kf = { id: nextKfId++, time: t, ...state };
            track.keyframes.push(kf);
            track.keyframes.sort((a, b) => a.time - b.time);
            if (trackId === 'camera') selectedKfId = kf.id;
          }
          count++;
        }
        renderKeyframeList();
        setStatus(`Keyframe added at t=${t}s (${count} track${count !== 1 ? 's' : ''})`);
      }

      function deleteKeyframe(id) {
        deleteTrackKeyframe('camera', id);
      }

      function deleteTrackKeyframe(trackId, kfId) {
        const track = tracks[trackId];
        if (!track) return;
        track.keyframes = track.keyframes.filter(k => k.id !== kfId);
        if (tlSelectedKf?.kfId === kfId) { tlSelectedKf = null; updateEaseBar(); }
        if (trackId === 'camera') {
          if (selectedKfId === kfId) selectedKfId = track.keyframes[0]?.id ?? null;
          renderKeyframeList();
        }
      }

      const SCENE_MODE_CYCLE = { "3d": "columbus", "columbus": "2d", "2d": "3d" };

      function renderKeyframeList() {
        const camKfs = tracks['camera']?.keyframes || [];
        const list = document.getElementById("keyframeList");
        list.innerHTML = "";
        if (camKfs.length === 0) {
          list.innerHTML = '<li style="color:#aaa;font-size:12px;border:none;background:none;padding:4px 0;">No keyframes yet</li>';
          return;
        }
        camKfs.forEach((kf, idx) => {
          const li = document.createElement("li");
          if (kf.id === selectedKfId) li.classList.add("selected");

          const label = document.createElement("span");
          label.className = "kf-label";
          label.textContent = `Keyframe ${idx + 1} · t=${kf.time}s`;

          const time = document.createElement("span");
          time.className = "kf-time";
          time.textContent = `${kf.time}s`;

          // Scene mode badge — highlighted when different from previous keyframe
          const prevMode = idx > 0 ? (camKfs[idx - 1].sceneMode || "3d") : null;
          const kfMode = kf.sceneMode || "3d";
          const modeBtn = document.createElement("button");
          modeBtn.className = "kf-mode" + (prevMode !== null && kfMode !== prevMode ? " kf-mode-change" : "");
          modeBtn.textContent = SCENE_MODE_LABELS[kfMode] || "3D";
          modeBtn.title = "Scene mode — click to cycle (3D → Columbus → 2D)";
          modeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            kf.sceneMode = SCENE_MODE_CYCLE[kfMode] || "3d";
            renderKeyframeList();
          });

          const del = document.createElement("button");
          del.className = "kf-delete";
          del.textContent = "×";
          del.title = "Delete keyframe";
          del.addEventListener("click", (e) => { e.stopPropagation(); deleteKeyframe(kf.id); });

          li.append(label, time, modeBtn, del);
          li.addEventListener("click", () => {
            selectedKfId = kf.id;
            playbackT  = kf.time;
            playStartT = kf.time;
            syncSceneModeToTime(kf.time);
            viewer.scene.completeMorph(); // finish instantly when jumping directly
            setCameraState(buildStateAtTime(kf.time));
            updateProgressUI(kf.time);
            renderKeyframeList();
          });
          list.appendChild(li);
        });
      }

      // ── Animation ───────────────────────────────────────────────────────────
      // Returns the scene mode that should be active at time t (most recent keyframe mode ≤ t).
      function getSceneModeAtTime(t) {
        const kfs = tracks['camera']?.keyframes || [];
        if (kfs.length === 0) return '3d';
        let mode = kfs[0].sceneMode || '3d';
        for (const kf of kfs) {
          if (kf.time <= t) mode = kf.sceneMode || mode;
          else break;
        }
        return mode;
      }

      let lastPlaybackMode = "3d";

      // Apply the correct scene mode for time t if it differs from what's currently shown.
      // Call this whenever playbackT is set outside of animationFrame (scrub, stop, jump).
      function syncSceneModeToTime(t) {
        const mode = getSceneModeAtTime(t);
        if (mode !== getCurrentSceneModeName()) {
          triggerSceneMode(mode, 1.5);
        }
        lastPlaybackMode = mode;
      }

      function lerpAngle(a, b, t) {
        // Shortest-path interpolation for angles in degrees
        let diff = ((b - a + 540) % 360) - 180;
        return a + diff * t;
      }

      function lerpColor(ca, cb, t) {
        const ra = parseInt(ca.slice(1,3),16), ga = parseInt(ca.slice(3,5),16), ba = parseInt(ca.slice(5,7),16);
        const rb = parseInt(cb.slice(1,3),16), gb = parseInt(cb.slice(3,5),16), bb = parseInt(cb.slice(5,7),16);
        const r = Math.round(ra+(rb-ra)*t), g = Math.round(ga+(gb-ga)*t), b = Math.round(ba+(bb-ba)*t);
        return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
      }

      // ── Easing ─────────────────────────────────────────────────────────────
      function applyEase(t, ease) {
        switch (ease) {
          case 'ease-in':     return t * t;
          case 'ease-out':    return t * (2 - t);
          case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
          default:            return t; // linear
        }
      }

      // Interpolate a single track at time t. Returns the interpolated state object or null.
      function interpolateTrack(trackId, t) {
        const track = tracks[trackId];
        if (!track || track.keyframes.length === 0) return null;
        const kfs = track.keyframes;
        if (kfs.length === 1) return { ...kfs[0] };
        if (t <= kfs[0].time) return { ...kfs[0] };
        if (t >= kfs[kfs.length-1].time) return { ...kfs[kfs.length-1] };
        let i = 0;
        for (let j = 0; j < kfs.length - 1; j++) { if (t <= kfs[j+1].time) { i = j; break; } }
        const a = kfs[i], b = kfs[i+1];
        const span = b.time - a.time;
        const rawAlpha = span > 0 ? (t - a.time) / span : 1;
        const alpha = applyEase(rawAlpha, a.ease || 'linear');
        if (trackId === 'camera') {
          return {
            lon:     a.lon     + (b.lon     - a.lon)     * alpha,
            lat:     a.lat     + (b.lat     - a.lat)     * alpha,
            height:  a.height  + (b.height  - a.height)  * alpha,
            heading: lerpAngle(a.heading, b.heading, alpha),
            pitch:   lerpAngle(a.pitch,   b.pitch,   alpha),
            roll:    lerpAngle(a.roll,    b.roll,    alpha),
            sceneMode: a.sceneMode,
          };
        }
        if (trackId === 'tod') {
          return { todMinutes: a.todMinutes + (b.todMinutes - a.todMinutes) * alpha };
        }
        if (trackId === 'borders') {
          // backward-compat: old keyframes may have a single borderOpacity
          const co = a.countryOpacity ?? a.borderOpacity ?? 0.7;
          const so = a.stateOpacity   ?? a.borderOpacity ?? 0.2;
          const co2 = b.countryOpacity ?? b.borderOpacity ?? 0.7;
          const so2 = b.stateOpacity   ?? b.borderOpacity ?? 0.2;
          const cyo = a.countyOpacity ?? 0;
          const cyo2 = b.countyOpacity ?? 0;
          return {
            countryOpacity: co  + (co2  - co)  * alpha,
            stateOpacity:   so  + (so2  - so)  * alpha,
            countyOpacity:  cyo + (cyo2 - cyo) * alpha,
            borderColor:    lerpColor(a.borderColor ?? '#ffffff', b.borderColor ?? '#ffffff', alpha),
          };
        }
        if (trackId.startsWith('hl_')) {
          return {
            color:            lerpColor(a.color, b.color, alpha),
            outlineOpacity:   a.outlineOpacity   + (b.outlineOpacity   - a.outlineOpacity)   * alpha,
            outlineWidth:     a.outlineWidth     + (b.outlineWidth     - a.outlineWidth)     * alpha,
            subregionOpacity: a.subregionOpacity + (b.subregionOpacity - a.subregionOpacity) * alpha,
            subregionWidth:   a.subregionWidth   + (b.subregionWidth   - a.subregionWidth)   * alpha,
            fillOpacity:      a.fillOpacity      + (b.fillOpacity      - a.fillOpacity)      * alpha,
            invert:           alpha < 0.5 ? a.invert           : b.invert,
            showLabel:        alpha < 0.5 ? a.showLabel        : b.showLabel,
            labelColor:       lerpColor(a.labelColor ?? a.color, b.labelColor ?? b.color, alpha),
            labelOpacity:     (a.labelOpacity??1)  + ((b.labelOpacity??1)  - (a.labelOpacity??1))  * alpha,
            labelFontSize:    (a.labelFontSize??14) + ((b.labelFontSize??14) - (a.labelFontSize??14)) * alpha,
            labelFontWeight:  alpha < 0.5 ? (a.labelFontWeight??'normal') : (b.labelFontWeight??'normal'),
            labelFontFamily:  alpha < 0.5 ? (a.labelFontFamily??'Arial')  : (b.labelFontFamily??'Arial'),
            labelOffsetX:     (a.labelOffsetX??0)  + ((b.labelOffsetX??0)  - (a.labelOffsetX??0))  * alpha,
            labelOffsetY:     (a.labelOffsetY??0)  + ((b.labelOffsetY??0)  - (a.labelOffsetY??0))  * alpha,
          };
        }
        if (trackId.startsWith('group_')) {
          return {
            color:          lerpColor(a.color, b.color, alpha),
            fillOpacity:    a.fillOpacity    + (b.fillOpacity    - a.fillOpacity)    * alpha,
            outlineOpacity: (a.outlineOpacity??1) + ((b.outlineOpacity??1) - (a.outlineOpacity??1)) * alpha,
            outlineWidth:   (a.outlineWidth??2)   + ((b.outlineWidth??2)   - (a.outlineWidth??2))   * alpha,
            invert: alpha < 0.5 ? a.invert : b.invert,
          };
        }
        if (trackId.startsWith('city_')) {
          return {
            color:             lerpColor(a.color, b.color, alpha),
            labelColor:        lerpColor(a.labelColor ?? a.color, b.labelColor ?? b.color, alpha),
            dotSize:           a.dotSize           + (b.dotSize           - a.dotSize)           * alpha,
            showLabel:         alpha < 0.5 ? a.showLabel         : b.showLabel,
            dotOpacity:        a.dotOpacity        + (b.dotOpacity        - a.dotOpacity)        * alpha,
            labelOpacity:      a.labelOpacity      + (b.labelOpacity      - a.labelOpacity)      * alpha,
            fontSize:          a.fontSize          + (b.fontSize          - a.fontSize)          * alpha,
            fontWeight:        alpha < 0.5 ? a.fontWeight        : b.fontWeight,
            fontStyle:         alpha < 0.5 ? a.fontStyle         : b.fontStyle,
            fontFamily:        alpha < 0.5 ? a.fontFamily        : b.fontFamily,
            offsetX:           a.offsetX           + (b.offsetX           - a.offsetX)           * alpha,
            offsetY:           a.offsetY           + (b.offsetY           - a.offsetY)           * alpha,
            outlineWidth:      a.outlineWidth      + (b.outlineWidth      - a.outlineWidth)      * alpha,
            showBackground:    alpha < 0.5 ? a.showBackground    : b.showBackground,
            backgroundColor:   lerpColor(a.backgroundColor ?? '#000000', b.backgroundColor ?? '#000000', alpha),
            backgroundOpacity: (a.backgroundOpacity ?? 0.5) + ((b.backgroundOpacity ?? 0.5) - (a.backgroundOpacity ?? 0.5)) * alpha,
            bgPadX:            (a.bgPadX ?? 5) + ((b.bgPadX ?? 5) - (a.bgPadX ?? 5)) * alpha,
            bgPadY:            (a.bgPadY ?? 3) + ((b.bgPadY ?? 3) - (a.bgPadY ?? 3)) * alpha,
          };
        }
        if (trackId.startsWith('kml_')) {
          return {
            visible: alpha < 0.5 ? a.visible : b.visible,
            layers: (a.layers || []).map((al, i) => {
              const bl = b.layers?.[i];
              return { name: al.name, opacity: bl !== undefined ? al.opacity + (bl.opacity - al.opacity) * alpha : al.opacity };
            }),
          };
        }
        if (trackId.startsWith('ann_')) {
          return { opacity: (a.opacity??1) + ((b.opacity??1) - (a.opacity??1)) * alpha };
        }
        if (trackId.startsWith('gmember_')) {
          return { opacity: (a.opacity??0) + ((b.opacity??0) - (a.opacity??0)) * alpha };
        }
        if (trackId.startsWith('route_')) {
          return {
            routeStart: (a.routeStart??0)   + ((b.routeStart??0)   - (a.routeStart??0))   * alpha,
            routeEnd:   (a.routeEnd??100)   + ((b.routeEnd??100)   - (a.routeEnd??100))   * alpha,
          };
        }
        return null;
      }

      // Build the full scene state at time t by querying all active tracks.
      // Falls back to current entity state if a track has no keyframes.
      function buildStateAtTime(t) {
        const state = {};
        const cam = interpolateTrack('camera', t);
        if (cam) Object.assign(state, cam);
        const tod = interpolateTrack('tod', t);
        if (tod) state.todMinutes = tod.todMinutes;
        const brd = interpolateTrack('borders', t);
        if (brd) { state.countryOpacity = brd.countryOpacity; state.stateOpacity = brd.stateOpacity; }

        // Only include entity states if their track has keyframes — avoids calling
        // applySceneState on every entity every animation frame when nothing is animating.
        const hlAnimated = highlights.filter(h => (tracks['hl_'+h.key]?.keyframes.length ?? 0) > 0);
        if (hlAnimated.length > 0) {
          state.highlightStates = hlAnimated.map(h => {
            const hs = interpolateTrack('hl_' + h.key, t);
            return { key:h.key, ...hs };
          });
        }
        const grpAnimated = regionGroups.filter(g => (tracks['group_'+g.id]?.keyframes.length ?? 0) > 0);
        if (grpAnimated.length > 0) {
          state.groupStates = grpAnimated.map(g => {
            const gs = interpolateTrack('group_' + g.id, t);
            return { id:g.id, ...gs };
          });
        }
        const cityAnimated = cityMarkers.filter(m => (tracks['city_'+m.id]?.keyframes.length ?? 0) > 0);
        if (cityAnimated.length > 0) {
          state.cityStates = cityAnimated.map(m => {
            const cs = interpolateTrack('city_' + m.id, t);
            return { id:m.id, ...cs };
          });
        }
        const kmlAnimated = kmlOverlays.filter(k => (tracks['kml_'+k.id]?.keyframes.length ?? 0) > 0);
        if (kmlAnimated.length > 0) {
          state.kmlStates = kmlAnimated.map(k => {
            const ks = interpolateTrack('kml_' + k.id, t);
            return { id: k.id, ...ks };
          });
        }
        const annAnimated = annotations.filter(a => (tracks['ann_'+a.id]?.keyframes.length ?? 0) > 0);
        if (annAnimated.length > 0) {
          state.annStates = annAnimated.map(a => {
            const as = interpolateTrack('ann_' + a.id, t);
            return { id: a.id, ...as };
          });
        }
        // Route states — routeStart/routeEnd for draw-on animation
        const routeAnimated = cityRouteGroups.filter(g => (tracks['route_'+g.id]?.keyframes.length ?? 0) > 0);
        if (routeAnimated.length > 0) {
          state.routeStates = routeAnimated.map(g => {
            const rs = interpolateTrack('route_' + g.id, t);
            return { id: g.id, ...rs };
          });
        }
        // Member states — per-member opacity for sequential region appearance
        const memberAnimated = [];
        for (const g of regionGroups) {
          for (const m of g.members) {
            const tid = `gmember_${g.id}_${m.key}`;
            if ((tracks[tid]?.keyframes.length ?? 0) > 0) memberAnimated.push({ groupId: g.id, memberKey: m.key, tid });
          }
        }
        if (memberAnimated.length > 0) {
          state.memberStates = memberAnimated.map(({ groupId, memberKey, tid }) => ({
            groupId, memberKey, ...interpolateTrack(tid, t),
          }));
        }
        return state;
      }

      function updateProgressUI(t) {
        const dur = totalDuration();
        document.getElementById("playheadDisplay").textContent =
          `${t.toFixed(1)}s / ${dur.toFixed(1)}s`;
        document.getElementById("progressFill").style.width =
          `${Math.min(100, (t / dur) * 100)}%`;
      }

      function updateTransportBtns() {
        const fwd = isPlaying && playbackDirection > 0;
        const rev = isPlaying && playbackDirection < 0;
        document.getElementById("playBtn").textContent = fwd ? "⏸ Pause" : "▶ Play";
        document.getElementById("tlRevBtn") .classList.toggle("tl-transport-active", rev);
        document.getElementById("tlPlayBtn").classList.toggle("tl-transport-active", fwd);
      }

      function animationFrame(nowMs) {
        if (!isPlaying) return;

        const elapsed = (nowMs - playStartMs) / 1000 * playbackSpeed() * playbackDirection;
        playbackT = playStartT + elapsed;

        const dur = totalDuration();
        if (playbackT >= dur) {
          playbackT = dur;
          isPlaying = false;
          updateTransportBtns();
        } else if (playbackT <= 0) {
          playbackT = 0;
          isPlaying = false;
          updateTransportBtns();
        }

        // Trigger morph when playback crosses a keyframe with a new scene mode
        const activeMode = getSceneModeAtTime(playbackT);
        if (activeMode !== lastPlaybackMode) {
          triggerSceneMode(activeMode, 2.0);
          lastPlaybackMode = activeMode;
        }

        const state = buildStateAtTime(playbackT);
        setCameraState(state); // no-ops while MORPHING
        updateProgressUI(playbackT);

        if (isPlaying) animRaf = requestAnimationFrame(animationFrame);
      }

      function startPlayback() {
        if (!Object.values(tracks).some(tr => tr.keyframes.length >= 2)) {
          setStatus("Need at least 2 keyframes in at least one track to play."); return;
        }
        if (playbackT >= totalDuration()) { playbackT = 0; syncSceneModeToTime(0); }
        playbackDirection = 1;
        isPlaying = true;
        playStartMs = performance.now();
        playStartT  = playbackT;
        lastPlaybackMode = getSceneModeAtTime(playbackT);
        updateTransportBtns();
        animRaf = requestAnimationFrame(animationFrame);
      }

      function startReverse() {
        if (!Object.values(tracks).some(tr => tr.keyframes.length >= 2)) {
          setStatus("Need at least 2 keyframes in at least one track to reverse."); return;
        }
        if (playbackT <= 0) { playbackT = totalDuration(); syncSceneModeToTime(playbackT); }
        playbackDirection = -1;
        isPlaying = true;
        playStartMs = performance.now();
        playStartT  = playbackT;
        lastPlaybackMode = getSceneModeAtTime(playbackT);
        updateTransportBtns();
        animRaf = requestAnimationFrame(animationFrame);
      }

      function pausePlayback() {
        isPlaying = false;
        if (animRaf) cancelAnimationFrame(animRaf);
        updateTransportBtns();
        syncControlsToState(buildStateAtTime(playbackT));
      }

      // Sync sidebar controls to the current animated state — called on pause/stop
      // so sliders reflect the correct value without updating them every frame.
      function syncControlsToState(state) {
        if (state.countryOpacity !== undefined) {
          const pct = Math.round(state.countryOpacity * 100);
          document.getElementById("countryBorderOpacity").value = pct;
          document.getElementById("countryBorderOpacityVal").textContent = pct + "%";
        }
        if (state.stateOpacity !== undefined) {
          const pct = Math.round(state.stateOpacity * 100);
          document.getElementById("stateBorderOpacity").value = pct;
          document.getElementById("stateBorderOpacityVal").textContent = pct + "%";
        }
        if (state.countyOpacity !== undefined) {
          const pct = Math.round(state.countyOpacity * 100);
          document.getElementById("countyBorderOpacity").value = pct;
          document.getElementById("countyBorderOpacityVal").textContent = pct + "%";
        }
      }

      function stopPlayback() {
        pausePlayback();
        playbackT = 0;
        updateProgressUI(0);
        if (Object.values(tracks).some(tr => tr.keyframes.length > 0)) {
          syncSceneModeToTime(0);
          setCameraState(buildStateAtTime(0));
        }
      }

      // ── Export ──────────────────────────────────────────────────────────────
      async function exportFrames() {
        if (!Object.values(tracks).some(tr => tr.keyframes.length >= 2)) { setStatus("Need at least 2 keyframes to export."); return; }

        const [w, h] = document.getElementById("resolutionSelect").value.split("x").map(Number);
        const fps    = parseInt(document.getElementById("framerateSelect").value);
        const dur    = totalDuration();
        const total  = Math.ceil(dur * fps);
        const btn    = document.getElementById("exportBtn");

        btn.disabled = true;
        setViewerResolution(w, h);
        await new Promise(r => setTimeout(r, 100)); // allow resize repaint

        // Apply starting scene mode instantly before capture begins
        const initMode = getSceneModeAtTime(0);
        triggerSceneMode(initMode, 0);
        viewer.scene.completeMorph();
        await new Promise(r => setTimeout(r, 50));

        // 1. Start session
        setStatus("Starting export session…");
        const startRes = await fetch("/api/export/start", { method: "POST" });
        const { sessionId } = await startRes.json();

        // 2. Render and upload each frame
        let exportMode = initMode;
        let morphFramesLeft = 0; // frames remaining in active export morph

        for (let f = 0; f < total; f++) {
          const t = f / fps;

          // Detect scene mode change — trigger a morph spanning the gap to the next keyframe.
          // We set a conservatively long duration (8× the nominal gap) because frame capture
          // takes real wall-clock time that's much slower than frame rate.  After all desired
          // morph frames are done we force-complete to avoid an open-ended transition.
          const activeMode = getSceneModeAtTime(t);
          if (activeMode !== exportMode && morphFramesLeft === 0) {
            exportMode = activeMode;
            // Count frames until next keyframe (or default 2s worth)
            const camKfs  = tracks['camera']?.keyframes || [];
            const modeKf  = [...camKfs].reverse().find(kf => kf.time <= t);
            const nextKf  = camKfs.find(kf => kf.time > (modeKf?.time ?? t));
            const gapSecs = nextKf ? Math.min(nextKf.time - (modeKf?.time ?? t), 5) : 2;
            morphFramesLeft = Math.round(gapSecs * fps);
            // Conservative morph duration: each frame typically takes ~150-300ms in practice.
            // 8× gives enough headroom for the animation to still be mid-transition during capture.
            triggerSceneMode(activeMode, morphFramesLeft / fps * 8);
          }

          if (morphFramesLeft > 0) {
            morphFramesLeft--;
            if (morphFramesLeft === 0) viewer.scene.completeMorph();
          }

          const state = buildStateAtTime(t);
          applySceneState(state);
          setCameraState(state); // no-ops while MORPHING

          // Wait for Cesium to finish rendering this frame
          await new Promise(r => viewer.scene.postRender.addEventListener(function once() {
            viewer.scene.postRender.removeEventListener(once);
            r();
          }));

          const dataUrl = viewer.scene.canvas.toDataURL("image/png");

          const res = await fetch("/api/export/frame", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, frameIndex: f, dataUrl }),
          });
          if (!res.ok) {
            setStatus("Frame upload failed. Export aborted.");
            btn.disabled = false;
            return;
          }

          setStatus(`Capturing frame ${f + 1} / ${total}…`);
        }

        // 3. Run ffmpeg on the server
        setStatus("Rendering MP4 with ffmpeg…");
        const renderRes = await fetch("/api/export/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, fps }),
        });
        if (!renderRes.ok) {
          const err = await renderRes.json();
          setStatus("ffmpeg failed: " + (err.detail || err.error));
          btn.disabled = false;
          setViewerResolution(null);
          return;
        }

        // 4. Download the MP4
        setStatus("Downloading animation.mp4…");
        const a = document.createElement("a");
        a.href = `/api/export/download/${sessionId}`;
        a.download = "animation.mp4";
        a.click();

        btn.disabled = false;
        setViewerResolution(null); // restore grid-fill layout after export
        setStatus("Export complete.");
      }

      // ── After Effects null object export ────────────────────────────────────
      async function exportAENulls() {
        const hasTracks = Object.values(tracks).some(tr => tr.keyframes.length >= 2);
        if (!hasTracks) { setStatus("Need at least 2 keyframes to export."); return; }

        const includeCities      = document.getElementById('aeNullCities').checked;
        const includeAnnotations = document.getElementById('aeNullAnnotations').checked;

        // Collect points to track
        const points = [];
        if (includeCities) {
          cityMarkers.forEach(m => {
            if (m.lat != null && m.lon != null) {
              points.push({ name: m.name || ('City ' + m.id), lat: m.lat, lon: m.lon });
            }
          });
        }
        if (includeAnnotations) {
          annotations.filter(a => a.type === 'globe' && a.lat != null && a.lon != null).forEach(a => {
            points.push({ name: a.text || ('Ann ' + a.id), lat: a.lat, lon: a.lon });
          });
        }
        if (!points.length) { setStatus("No cities or globe annotations to track."); return; }

        const [compW, compH] = document.getElementById("resolutionSelect").value.split("x").map(Number);
        const fps = parseInt(document.getElementById("framerateSelect").value);
        const dur = totalDuration();
        const totalFrames = Math.ceil(dur * fps);
        const btn = document.getElementById("exportAeNullsBtn");
        btn.disabled = true;
        setStatus("Sampling camera positions…");

        // Save current state
        const savedT = playbackT;

        // Pre-convert points to Cartesian3
        const cartesians = points.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));

        // For each point, an array of [x, y] per frame (null if off-screen)
        const frameData = points.map(() => []);

        // Canvas dimensions at sampling time (may differ from comp dimensions — normalise)
        const canvasW = viewer.scene.canvas.width;
        const canvasH = viewer.scene.canvas.height;

        const scratchCart2 = new Cesium.Cartesian2();

        for (let f = 0; f <= totalFrames; f++) {
          const t = Math.min(f / fps, dur);
          const state = buildStateAtTime(t);
          setCameraState(state);

          cartesians.forEach((cart, pi) => {
            const screen = viewer.scene.cartesianToCanvasCoordinates(cart, scratchCart2);
            if (screen) {
              // Normalise to comp resolution
              const x = (screen.x / canvasW) * compW;
              const y = (screen.y / canvasH) * compH;
              frameData[pi].push([parseFloat(x.toFixed(2)), parseFloat(y.toFixed(2))]);
            } else {
              // Point behind globe — use previous position or comp center
              const prev = frameData[pi].length ? frameData[pi][frameData[pi].length - 1] : [compW / 2, compH / 2];
              frameData[pi].push(prev);
            }
          });
        }

        // Restore
        playbackT = savedT;
        const restoredState = buildStateAtTime(savedT);
        setCameraState(restoredState);

        // Build JSX
        const pointsJSON = JSON.stringify(points.map((p, pi) => ({
          name: p.name,
          frames: frameData[pi],
        })));

        const jsx = `// Generated by Map Animator — run via File > Scripts > Run Script File in After Effects
(function () {
  var compW    = ${compW};
  var compH    = ${compH};
  var fps      = ${fps};
  var dur      = ${parseFloat(dur.toFixed(3))};
  var points   = ${pointsJSON};

  var comp = app.project.items.addComp(
    "Map Animator Nulls", compW, compH, 1, dur, fps
  );
  comp.bgColor = [0, 0, 0];

  for (var i = 0; i < points.length; i++) {
    var pt    = points[i];
    var layer = comp.layers.addNull(dur);
    layer.name  = pt.name;
    layer.label = (i % 16) + 1;
    layer.threeDLayer = false;

    var pos = layer.property("Position");
    pos.setValueAtTime(0, pt.frames[0]);
    for (var f = 0; f < pt.frames.length; f++) {
      pos.setValueAtTime(f / fps, pt.frames[f]);
    }
  }

  alert("Map Animator: created " + points.length + " null layer" +
    (points.length === 1 ? "" : "s") + " in comp \\"" + comp.name + "\\".");
})();
`;

        const blob = new Blob([jsx], { type: 'application/octet-stream' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'map-animator-nulls.jsx';
        a.click();
        URL.revokeObjectURL(url);

        btn.disabled = false;
        setStatus(`Exported ${points.length} null${points.length === 1 ? '' : 's'} (${totalFrames + 1} frames each).`);
      }

      // Apply an explicit export resolution to the viewport so the user sees
      // exactly what will be captured (WYSIWYG).  Pass null to restore the
      // default grid-fill behaviour.
      function setViewerResolution(w, h) {
        const pane = document.getElementById("cesiumPane");
        if (w === null) {
          pane.style.width  = "";
          pane.style.height = "";
          const badge = document.getElementById("resPreviewBadge");
          if (badge) badge.remove();
        } else {
          pane.style.width  = w + "px";
          pane.style.height = h + "px";
          // Show a small badge so the user knows they're in preview mode
          let badge = document.getElementById("resPreviewBadge");
          if (!badge) {
            badge = document.createElement("div");
            badge.id = "resPreviewBadge";
            badge.style.cssText = "position:absolute;top:6px;left:6px;z-index:10;" +
              "background:rgba(0,0,0,0.55);color:#fff;font-size:11px;padding:3px 7px;" +
              "border-radius:4px;pointer-events:none;font-family:Arial,sans-serif;";
            pane.appendChild(badge);
          }
          badge.textContent = `Preview: ${w} × ${h}`;
        }
        viewer.resize();
      }

      // ── Time of Day ─────────────────────────────────────────────────────────
      function setTimeOfDay(totalMinutes) {
        if (!viewer) return;
        // Use a fixed reference date (J2000 epoch day) and offset by minutes
        const baseJd = Cesium.JulianDate.fromIso8601("2024-06-21T00:00:00Z");
        const jd = Cesium.JulianDate.addSeconds(baseJd, totalMinutes * 60, new Cesium.JulianDate());
        viewer.clock.currentTime = jd;
        viewer.clock.shouldAnimate = false;
      }

      let nightDarknessEnabled = true;

      function setNightDarkness(on) {
        nightDarknessEnabled = on;
        if (!viewer) return;
        viewer.scene.globe.enableLighting = on;
        if (on && viewer.scene.light) viewer.scene.light.intensity = 3.0;
        document.getElementById('nightDarknessOn').style.background  = on  ? '#4a9eff' : '';
        document.getElementById('nightDarknessOn').style.color        = on  ? '#fff'    : '';
        document.getElementById('nightDarknessOn').style.fontWeight   = on  ? 'bold'    : '';
        document.getElementById('nightDarknessOff').style.background  = !on ? '#4a9eff' : '';
        document.getElementById('nightDarknessOff').style.color       = !on ? '#fff'    : '';
        document.getElementById('nightDarknessOff').style.fontWeight  = !on ? 'bold'    : '';
      }

      function todMinutesToDisplay(totalMinutes) {
        const h = Math.floor(totalMinutes / 60) % 24;
        const m = totalMinutes % 60;
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }

      // ── Regions ─────────────────────────────────────────────────────────────
      let countryDataSource = null;
      let stateDataSource   = null;
      let regionLookup      = new Map(); // displayStr → { key, name, polygons[] }
      let bordersLandOnly   = true;
      let highlights        = [];        // [{ key, name, type, color, outlineEntities[], outlineOpacity, outlineWidth, subregionEntities[], subregionOpacity, subregionWidth, fillEntities[], fillOpacity, invert }]

      const DEFAULT_OUTLINE = Cesium.Color.WHITE.withAlpha(0.7);
      const DEFAULT_WIDTH   = 1.5;

      let borderColor = '#ffffff'; // shared color for all border layers

      function hexToCesiumColor(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return new Cesium.Color(r, g, b, alpha !== undefined ? alpha : 1);
      }

      function cesiumColorToHex(c) {
        const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
        return '#' + toHex(c.red) + toHex(c.green) + toHex(c.blue);
      }

      const STATE_FIPS = {
        '01':'Alabama','02':'Alaska','04':'Arizona','05':'Arkansas','06':'California',
        '08':'Colorado','09':'Connecticut','10':'Delaware','11':'Washington D.C.',
        '12':'Florida','13':'Georgia','15':'Hawaii','16':'Idaho','17':'Illinois',
        '18':'Indiana','19':'Iowa','20':'Kansas','21':'Kentucky','22':'Louisiana',
        '23':'Maine','24':'Maryland','25':'Massachusetts','26':'Michigan','27':'Minnesota',
        '28':'Mississippi','29':'Missouri','30':'Montana','31':'Nebraska','32':'Nevada',
        '33':'New Hampshire','34':'New Jersey','35':'New Mexico','36':'New York',
        '37':'North Carolina','38':'North Dakota','39':'Ohio','40':'Oklahoma',
        '41':'Oregon','42':'Pennsylvania','44':'Rhode Island','45':'South Carolina',
        '46':'South Dakota','47':'Tennessee','48':'Texas','49':'Utah','50':'Vermont',
        '51':'Virginia','53':'Washington','54':'West Virginia','55':'Wisconsin',
        '56':'Wyoming','72':'Puerto Rico',
      };

      // Maps states.geojson `admin` values → countries.geojson `NAME` where they differ
      // ADMIN_TO_COUNTRY was removed — countries.geojson is now dissolved from
      // states.geojson so country NAME values exactly match state admin values.
      const ADMIN_TO_COUNTRY = {};

      function hexToColor(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return new Cesium.Color(r, g, b, 1.0);
      }

      function patchDataSourceEntities(ds, borderWidth, zIndex = 0, clamp = true) {
        // clampToGround is forced false — GroundPolylinePrimitive tessellation
        // is too slow for thousands of features. At globe scale the difference
        // is imperceptible.
        const now = Cesium.JulianDate.now();
        const toRemove = [];

        for (const entity of ds.entities.values) {
          if (!entity.polygon) continue;

          let hierarchy;
          try { hierarchy = entity.polygon.hierarchy?.getValue(now); } catch (e) {}

          if (!hierarchy?.positions?.length) {
            toRemove.push(entity);
            continue;
          }

          entity.polygon.show = false;

          try {
            const raw = [...hierarchy.positions, hierarchy.positions[0]];
            const positions = [raw[0]];
            for (let i = 1; i < raw.length; i++) {
              const p = raw[i], q = positions[positions.length - 1];
              if (Math.abs(p.x - q.x) > 1 || Math.abs(p.y - q.y) > 1 || Math.abs(p.z - q.z) > 1) {
                positions.push(p);
              }
            }
            if (positions.length < 2) continue;
            entity.polyline = new Cesium.PolylineGraphics({
              positions:     positions,
              width:         borderWidth || DEFAULT_WIDTH,
              material:      new Cesium.ColorMaterialProperty(DEFAULT_OUTLINE),
              clampToGround: false,
              arcType:       Cesium.ArcType.GEODESIC,
            });
          } catch (e) {}
        }

        for (const entity of toRemove) ds.entities.remove(entity);
      }

      function setBordersLoadingProgress(pct, label) {
        document.getElementById('bordersLoadingFill').style.width  = pct + '%';
        document.getElementById('bordersLoadingLabel').textContent = label;
      }

      async function loadRegionData() {
        document.getElementById('bordersLoadingBar').style.display = '';
        setBordersLoadingProgress(5, 'Loading countries…');

        const isMob   = navigator.maxTouchPoints > 1 || /iPhone|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 1366;
        const suffix  = bordersLandOnly ? "-land" : "";
        const mob     = isMob ? "-mobile" : "";
        const countriesUrl = `/data/countries${mob}${suffix}.geojson`;
        const statesUrl    = `/data/states${mob}${suffix}.geojson`;

        setBordersLoadingProgress(15, 'Loading borders…');

        // Kick off both fetches simultaneously, but process/display countries first
        // so they appear immediately while states are still being parsed by Cesium.
        const statesPromise = Cesium.GeoJsonDataSource.load(statesUrl, {
          fill: Cesium.Color.WHITE.withAlpha(0.0), stroke: DEFAULT_OUTLINE, strokeWidth: DEFAULT_WIDTH * 0.6,
        });

        countryDataSource = await Cesium.GeoJsonDataSource.load(countriesUrl, {
          fill: Cesium.Color.WHITE.withAlpha(0.0), stroke: DEFAULT_OUTLINE, strokeWidth: DEFAULT_WIDTH,
        });
        patchDataSourceEntities(countryDataSource, DEFAULT_WIDTH);
        viewer.dataSources.add(countryDataSource);
        setBordersLoadingProgress(50, 'Loading states…');

        stateDataSource = await statesPromise;
        patchDataSourceEntities(stateDataSource, DEFAULT_WIDTH * 0.6);
        viewer.dataSources.add(stateDataSource);
        setBordersLoadingProgress(85, 'Building region index…');

        // Build unified lookup covering all countries and states.
        // Each entry stores polygons[] so multi-part regions (e.g. Alaska) are complete.
        const now = Cesium.JulianDate.now();

        for (const entity of countryDataSource.entities.values) {
          const name = entity.properties?.NAME?.getValue();
          if (!name) continue;
          let hier;
          try { hier = entity.polygon?.hierarchy?.getValue(now); } catch (e) {}
          const positions = hier?.positions;
          if (!positions?.length) continue;
          if (!regionLookup.has(name)) {
            regionLookup.set(name, { key: `country||${name}`, name, polygons: [] });
          }
          regionLookup.get(name).polygons.push(positions);
        }

        for (const entity of stateDataSource.entities.values) {
          const sname = entity.properties?.name?.getValue();
          const admin = entity.properties?.admin?.getValue();
          if (!sname || !admin) continue;
          const displayStr = `${sname} (${admin})`;
          let hier;
          try { hier = entity.polygon?.hierarchy?.getValue(now); } catch (e) {}
          const positions = hier?.positions;
          if (!positions?.length) continue;
          // Resolve admin name to the matching country NAME (handles naming mismatches)
          const resolvedAdmin = ADMIN_TO_COUNTRY[admin] || admin;
          if (!regionLookup.has(displayStr)) {
            regionLookup.set(displayStr, { key: `state||${resolvedAdmin}||${sname}`, name: displayStr, polygons: [] });
          }
          regionLookup.get(displayStr).polygons.push(positions);
        }

        // Populate datalist
        const dl = document.getElementById("regionDatalist");
        dl.innerHTML = "";
        // Order: countries first, then states, then counties (added later by loadCountyPositions)
        const entries = [...regionLookup.entries()];
        const countries = entries.filter(([,e]) => e.key.startsWith('country||')).map(([k]) => k).sort();
        const states    = entries.filter(([,e]) => e.key.startsWith('state||')).map(([k]) => k).sort();
        [...countries, ...states].forEach(str => {
          const opt = document.createElement("option");
          opt.value = str;
          dl.appendChild(opt);
        });

        // Apply initial slider values to the newly loaded data sources.
        setCountryBorderOpacity(parseInt(document.getElementById('countryBorderOpacity').value) / 100);
        setStateBorderOpacity(parseInt(document.getElementById('stateBorderOpacity').value) / 100);

        // Load county data in the background so counties appear in the region search
        // even if county borders are never enabled. loadCountyPositions() is idempotent.
        loadCountyPositions();

        setBordersLoadingProgress(100, 'Rendering borders…');
        setStatus("Region data loaded.");

        // Keep bar visible until Cesium finishes tessellating GroundPolylinePrimitives.
        // We can't reliably read primitive.ready in 1.118, so instead:
        // hide once groundPrimitives.length has been stable for 2s AND at least 3s
        // have passed since entities were added. Safety valve at 30s.
        const loadedAt = Date.now();
        const MIN_MS = 3000, STABLE_MS = 2000, MAX_MS = 30000;
        let lastGPCount = viewer.scene.groundPrimitives.length;
        let stableSince = Date.now();
        const removeBordersListener = viewer.scene.postRender.addEventListener(() => {
          const now = Date.now();
          const count = viewer.scene.groundPrimitives.length;
          if (count !== lastGPCount) { lastGPCount = count; stableSince = now; }
          const elapsed = now - loadedAt;
          const stable  = now - stableSince;
          if ((elapsed >= MIN_MS && stable >= STABLE_MS) || elapsed >= MAX_MS) {
            removeBordersListener();
            document.getElementById('bordersLoadingBar').style.display = 'none';
          }
        });
      }

      async function reloadBorders() {
        // Remove existing border data sources
        if (countryDataSource) { viewer.dataSources.remove(countryDataSource, true); countryDataSource = null; }
        if (stateDataSource)   { viewer.dataSources.remove(stateDataSource,   true); stateDataSource   = null; }
        regionLookup.clear();
        // Rebuild datalist immediately so stale entries don't linger during load
        document.getElementById('regionDatalist').innerHTML = '';
        await loadRegionData();
      }

      // ref may be a plain number/string (static) or { color, opacity } (live, read by CallbackProperty)
      function makePolylineEntities(polygons, color, width, opacity, ref) {
        const getMat = ref
          ? new Cesium.CallbackProperty(() => hexToColor(ref.color).withAlpha(ref.opacity), false)
          : hexToColor(color).withAlpha(opacity === undefined ? 1.0 : opacity);
        const material = new Cesium.ColorMaterialProperty(getMat);

        return polygons.map(pts => {
          const raw = [...pts, pts[0]];
          // Deduplicate consecutive identical vertices (some GeoJSON features have
          // duplicate points that create zero-length segments causing rendering glitches).
          const positions = [raw[0]];
          for (let i = 1; i < raw.length; i++) {
            const p = raw[i], q = positions[positions.length - 1];
            if (Math.abs(p.x - q.x) > 1 || Math.abs(p.y - q.y) > 1 || Math.abs(p.z - q.z) > 1)
              positions.push(p);
          }
          return viewer.entities.add({
            polyline: new Cesium.PolylineGraphics({
              positions,
              width,
              material,
              clampToGround: true,
            }),
          });
        });
      }

      function toSurfacePositions(pts) {
        // Convert Cartesian3 positions to deduplicated surface-clamped positions.
        // Raw Cartesian3 from polygon hierarchies can have precision/height issues
        // that trip up Cesium's polygon tessellator.
        const surface = [];
        const seen = new Set();
        for (const p of pts) {
          const c = Cesium.Cartographic.fromCartesian(p);
          if (!c) continue;
          const key = `${c.longitude.toFixed(5)},${c.latitude.toFixed(5)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          surface.push(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 0));
        }
        return surface;
      }

      function makeFillEntities(polygons, color, fillOpacity, invert, ref) {
        if (invert) return makeInvertMask(polygons, color, fillOpacity);

        const getMat = ref
          ? new Cesium.CallbackProperty(() => hexToColor(ref.color).withAlpha(ref.opacity), false)
          : hexToColor(color).withAlpha(fillOpacity);
        const material = new Cesium.ColorMaterialProperty(getMat);

        const results = [];
        for (const pts of polygons) {
          const surface = toSurfacePositions(pts);
          if (surface.length < 3) continue;
          try {
            const check = Cesium.PolygonGeometry.fromPositions({ positions: surface });
            if (!Cesium.PolygonGeometry.createGeometry(check)) continue;
          } catch (e) { continue; }
          try {
            results.push(viewer.entities.add({
              polygon: new Cesium.PolygonGraphics({
                hierarchy: new Cesium.PolygonHierarchy(surface),
                material,
                outline:   false,
              }),
            }));
          } catch (e) {}
        }
        return results;
      }

      function makeInvertMask(polygons, color, fillOpacity) {
        // Use an ImageryLayer (tile-based) instead of polygon entities.
        // Each 256×256 tile is drawn on a canvas: filled with the mask colour,
        // then the selected region is punched out with destination-out compositing.
        // This gives seamless global coverage with no winding-order issues.

        // Pre-convert positions to [lon, lat] in radians once (reused per tile).
        const rings = [];
        for (const pts of polygons) {
          const surface = toSurfacePositions(pts);
          if (surface.length < 3) continue;
          const ring = surface.map(p => {
            const c = Cesium.Cartographic.fromCartesian(p);
            return c ? [c.longitude, c.latitude] : null;
          }).filter(Boolean);
          if (ring.length >= 3) rings.push(ring);
        }
        if (rings.length === 0) return [];

        const hexR = parseInt(color.slice(1, 3), 16);
        const hexG = parseInt(color.slice(3, 5), 16);
        const hexB = parseInt(color.slice(5, 7), 16);
        const scheme = new Cesium.GeographicTilingScheme();
        const errEvt = new Cesium.Event();

        const provider = {
          get tileWidth()        { return 256; },
          get tileHeight()       { return 256; },
          get maximumLevel()     { return 12; },
          get minimumLevel()     { return 0; },
          get tilingScheme()     { return scheme; },
          get rectangle()        { return scheme.rectangle; },
          get tileDiscardPolicy(){ return undefined; },
          get errorEvent()       { return errEvt; },
          get ready()            { return true; },
          get readyPromise()     { return Promise.resolve(true); },
          get hasAlphaChannel()  { return true; },
          get credit()           { return undefined; },
          getTileCredits()       { return []; },

          requestImage(x, y, level) {
            const rect = scheme.tileXYToRectangle(x, y, level);
            const W = 256, H = 256;
            const canvas = document.createElement('canvas');
            canvas.width = W; canvas.height = H;
            const ctx = canvas.getContext('2d');

            // Fill tile with mask colour at full opacity; layer.alpha controls transparency.
            ctx.fillStyle = `rgba(${hexR},${hexG},${hexB},1)`;
            ctx.fillRect(0, 0, W, H);

            // Erase the selected region so the imagery shows through.
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = '#000';
            for (const ring of rings) {
              ctx.beginPath();
              for (let i = 0; i < ring.length; i++) {
                const u =       (ring[i][0] - rect.west)  / (rect.east  - rect.west);
                const v = 1.0 - (ring[i][1] - rect.south) / (rect.north - rect.south);
                if (i === 0) ctx.moveTo(u * W, v * H);
                else         ctx.lineTo(u * W, v * H);
              }
              ctx.closePath();
              ctx.fill();
            }
            return Promise.resolve(canvas);
          },
        };

        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = fillOpacity;
        return [layer];
      }

      // Remove a fill item that may be an entity or an ImageryLayer.
      function removeFillItem(item) {
        if (item instanceof Cesium.ImageryLayer) {
          viewer.imageryLayers.remove(item, true);
        } else {
          viewer.entities.remove(item);
        }
      }

      function getPolygonCentroid(polygons) {
        const positions = polygons[0];
        if (!positions?.length) return null;
        let sumLon = 0, sumLat = 0;
        for (const pos of positions) {
          const c = Cesium.Cartographic.fromCartesian(pos);
          sumLon += Cesium.Math.toDegrees(c.longitude);
          sumLat += Cesium.Math.toDegrees(c.latitude);
        }
        return { lon: sumLon / positions.length, lat: sumLat / positions.length };
      }

      function updateHighlightLabelStyle(key) {
        const h = highlights.find(h => h.key === key);
        if (!h?.labelEntity) return;
        const la = h.labelOpacity ?? 1.0;
        const fontStr = `${h.labelFontWeight === 'bold' ? 'bold ' : ''}${h.labelFontSize ?? 14}px ${h.labelFontFamily ?? 'Arial'}`;
        h.labelEntity.label.font         = fontStr;
        h.labelEntity.label.fillColor    = hexToColor(h.labelColor ?? h.color).withAlpha(la);
        h.labelEntity.label.outlineColor = Cesium.Color.BLACK.withAlpha(la);
        h.labelEntity.label.pixelOffset  = new Cesium.Cartesian2(h.labelOffsetX ?? 0, h.labelOffsetY ?? 0);
        if (h.showLabel) h.labelEntity.label.show = la > 0;
      }

      function setHighlightLabel(key, show) {
        const h = highlights.find(h => h.key === key);
        if (!h) return;
        h.showLabel = show;
        if (!show) {
          if (h.labelEntity) { viewer.entities.remove(h.labelEntity); h.labelEntity = null; }
          return;
        }
        if (!h.centroid) return;
        if (h.labelEntity) viewer.entities.remove(h.labelEntity);
        const la = h.labelOpacity ?? 1.0;
        const fontStr = `${h.labelFontWeight === 'bold' ? 'bold ' : ''}${h.labelFontSize ?? 14}px ${h.labelFontFamily ?? 'Arial'}`;
        h.labelEntity = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(h.centroid.lon, h.centroid.lat),
          label: new Cesium.LabelGraphics({
            text: h.labelText,
            font: fontStr,
            fillColor: hexToColor(h.color).withAlpha(la),
            outlineColor: Cesium.Color.BLACK.withAlpha(la),
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(h.labelOffsetX ?? 0, h.labelOffsetY ?? 0),
            show: la > 0,
          }),
        });
      }

      function addHighlight(displayStr) {
        const entry = regionLookup.get(displayStr);
        if (!entry || !entry.polygons.length) return;
        if (highlights.some(h => h.key === entry.key)) return; // no duplicates

        const type  = entry.key.startsWith("country||") ? "country" : "state";
        const color = nextRegionColor();
        const DEFAULT_FILL_OPACITY = 0.25;

        // Live refs — CallbackProperty reads from these every frame so opacity/color
        // changes are instant with no entity rebuild or retessellation.
        const outlineRef    = { color, opacity: 1.0, renderedWidth: 2.0 };
        const subregionRef  = { color, opacity: 0.0 };
        const fillRef       = { color, opacity: DEFAULT_FILL_OPACITY };

        const outlineEntities = makePolylineEntities(entry.polygons, color, 2.0, 1.0, outlineRef);
        const fillEntities    = makeFillEntities(entry.polygons, color, DEFAULT_FILL_OPACITY, false, fillRef);

        highlights.push({
          key: entry.key, name: entry.name, type, color,
          outlineRef, subregionRef, fillRef,
          outlineEntities, outlineOpacity: 1.0, outlineWidth: 2.0,
          subregionEntities: [], subregionOpacity: 0.0, subregionWidth: 1.0,
          fillEntities, fillOpacity: DEFAULT_FILL_OPACITY, invert: false,
          showLabel: false, labelText: entry.name.split(' (')[0], labelEntity: null,
          labelColor: color,
          labelFontSize: 14, labelFontWeight: 'normal', labelFontFamily: 'Arial',
          labelOffsetX: 0, labelOffsetY: 0, labelOpacity: 1.0,
          centroid: getPolygonCentroid(entry.polygons),
        });
        tracks['hl_' + entry.key] = { id:'hl_'+entry.key, label:entry.name, category:'highlight',
          color, h:22, keyframes:[], collapsed:true };
        selectedTrackIds.add('hl_' + entry.key);
        tlBuildLabels();
        renderHighlightList();
      }

      function removeHighlight(key) {
        const idx = highlights.findIndex(h => h.key === key);
        if (idx === -1) return;
        const h = highlights[idx];
        const hlKey = h.key;
        h.outlineEntities.forEach(e => viewer.entities.remove(e));
        h.subregionEntities.forEach(e => viewer.entities.remove(e));
        h.fillEntities.forEach(removeFillItem);
        if (h.labelEntity) viewer.entities.remove(h.labelEntity);
        highlights.splice(idx, 1);
        delete tracks['hl_' + hlKey];
        selectedTrackIds.delete('hl_' + hlKey);
        tlBuildLabels();
        renderHighlightList();
      }

      function setFillOpacity(key, opacity) {
        const h = highlights.find(h => h.key === key);
        if (!h) return;
        h.fillOpacity = opacity;
        // If we have a live ref and non-invert fill entities already, just update the ref
        if (h.fillRef && h.fillEntities.length > 0 && !h.invert) {
          h.fillRef.color   = h.color;
          h.fillRef.opacity = opacity;
          return;
        }
        // Otherwise rebuild (first time, invert mode, or color changed)
        h.fillEntities.forEach(removeFillItem);
        const polygons = regionLookup.get(h.name)?.polygons || [];
        if (opacity > 0) {
          if (!h.invert) {
            h.fillRef = h.fillRef || { color: h.color, opacity };
            h.fillRef.color   = h.color;
            h.fillRef.opacity = opacity;
          }
          h.fillEntities = makeFillEntities(polygons, h.color, opacity, h.invert, h.invert ? null : h.fillRef);
        } else {
          h.fillEntities = [];
        }
      }

      function setFillInvert(key, invert) {
        const h = highlights.find(h => h.key === key);
        if (!h) return;
        h.invert = invert;
        if (invert && h.fillOpacity === 0) h.fillOpacity = 0.5;
        setFillOpacity(key, h.fillOpacity);
        renderHighlightList();
      }

      function getCountryStates(countryName) {
        const prefix = `state||${countryName}||`;
        const results = [];
        for (const entry of regionLookup.values()) {
          if (entry.key.startsWith(prefix) && entry.polygons.length) results.push(entry);
        }
        return results;
      }

      function refreshOutlineEntities(h) {
        if (h.outlineRef && h.outlineRef.renderedWidth === h.outlineWidth) {
          // Width unchanged — update color/opacity instantly via the live ref
          h.outlineRef.color   = h.color;
          h.outlineRef.opacity = h.outlineOpacity;
          return;
        }
        // Width changed (or no ref yet) — rebuild entities
        h.outlineEntities.forEach(e => viewer.entities.remove(e));
        const polygons = regionLookup.get(h.name)?.polygons || [];
        if (h.outlineOpacity > 0) {
          h.outlineRef = { color: h.color, opacity: h.outlineOpacity, renderedWidth: h.outlineWidth };
          h.outlineEntities = makePolylineEntities(polygons, h.color, h.outlineWidth, h.outlineOpacity, h.outlineRef);
        } else {
          h.outlineRef = null;
          h.outlineEntities = [];
        }
      }

      function refreshSubregionEntities(h) {
        if (h.subregionRef && h.subregionEntities.length > 0) {
          h.subregionRef.color   = h.color;
          h.subregionRef.opacity = h.subregionOpacity;
          return;
        }
        h.subregionEntities.forEach(e => viewer.entities.remove(e));
        if (h.type !== "country") { h.subregionEntities = []; return; }
        const polygons = [];
        getCountryStates(h.name).forEach(e => polygons.push(...e.polygons));
        if (h.subregionOpacity > 0) {
          h.subregionRef = h.subregionRef || { color: h.color, opacity: h.subregionOpacity };
          h.subregionRef.color   = h.color;
          h.subregionRef.opacity = h.subregionOpacity;
          h.subregionEntities = makePolylineEntities(polygons, h.color, h.subregionWidth, h.subregionOpacity, h.subregionRef);
        } else {
          h.subregionEntities = [];
        }
      }

      function makeCtrlRow(labelText, opacity, width, onOpacityChange, onWidthChange) {
        const row = document.createElement("div");
        row.className = "hl-ctrl-row";

        const lbl = document.createElement("span");
        lbl.className = "hl-ctrl-label";
        lbl.textContent = labelText;

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.step = "5";
        slider.value = String(Math.round(opacity * 100));
        slider.className = "hl-ctrl-slider";

        const pct = document.createElement("span");
        pct.className = "hl-ctrl-pct";
        pct.textContent = Math.round(opacity * 100) + "%";

        slider.addEventListener("input", (e) => {
          pct.textContent = e.target.value + "%";
          onOpacityChange(parseInt(e.target.value) / 100);
        });

        const widthInput = document.createElement("input");
        widthInput.type = "number";
        widthInput.min = "0.5";
        widthInput.max = "10";
        widthInput.step = "0.5";
        widthInput.value = String(width);
        widthInput.className = "hl-ctrl-width";
        widthInput.title = "Line width (px)";
        widthInput.addEventListener("change", (e) => {
          const w = Math.max(0.5, parseFloat(e.target.value) || 1.0);
          e.target.value = w;
          onWidthChange(w);
        });

        row.appendChild(lbl);
        row.appendChild(slider);
        row.appendChild(pct);
        row.appendChild(widthInput);
        return row;
      }

      function renderHighlightList() {
        const container = document.getElementById("highlightList");
        container.innerHTML = "";
        highlights.forEach(h => {
          const card = document.createElement("div");
          card.className = "hl-card";

          // ── Header ──────────────────────────────────────────────────────────
          const header = document.createElement("div");
          header.className = "hl-card-header";

          const swatch = document.createElement("div");
          swatch.className = "hl-swatch";
          swatch.style.background = h.color;
          const colorInput = document.createElement("input");
          colorInput.type = "color";
          colorInput.value = h.color;
          colorInput.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
          swatch.appendChild(colorInput);
          swatch.addEventListener("click", () => colorInput.click());
          colorInput.addEventListener("input", (e) => {
            h.color = e.target.value;
            swatch.style.background = h.color;
            // Update live refs — CallbackProperty picks up the new color next frame
            if (h.outlineRef)   h.outlineRef.color   = h.color;
            if (h.subregionRef) h.subregionRef.color  = h.color;
            if (h.fillRef && !h.invert) h.fillRef.color = h.color;
            // Invert mask is tile-based and needs a rebuild on color change
            if (h.invert && h.fillOpacity > 0) setFillOpacity(h.key, h.fillOpacity);
            if (h.labelEntity) updateHighlightLabelStyle(h.key);
          });

          const nameEl = document.createElement("span");
          nameEl.className = "hl-name";
          nameEl.textContent = h.name;
          nameEl.title = h.name;

          // Label toggle
          const labelBtn = document.createElement("button");
          labelBtn.className = "hl-toggle" + (h.showLabel ? " hl-toggle-active" : "");
          labelBtn.textContent = "label";
          labelBtn.title = "Show label on map";
          labelBtn.addEventListener("click", () => {
            setHighlightLabel(h.key, !h.showLabel);
            labelBtn.className = "hl-toggle" + (h.showLabel ? " hl-toggle-active" : "");
            labelTextInput.style.display = h.showLabel ? "inline-block" : "none";
          });

          // Editable label text (shown only when label is on)
          const labelTextInput = document.createElement("input");
          labelTextInput.type = "text";
          labelTextInput.value = h.labelText;
          labelTextInput.title = "Label text";
          labelTextInput.style.cssText = `display:${h.showLabel ? 'inline-block' : 'none'};width:70px;font-size:11px;padding:1px 4px;margin:0;`;
          labelTextInput.addEventListener("input", e => {
            h.labelText = e.target.value;
            if (h.labelEntity) h.labelEntity.label.text = h.labelText;
          });

          const flyBtn = document.createElement("button");
          flyBtn.className = "hl-toggle";
          flyBtn.textContent = "✈";
          flyBtn.title = "Fly to region";
          flyBtn.addEventListener("click", () => {
            const polygons = regionLookup.get(h.name)?.polygons;
            if (!polygons?.length) return;
            // BoundingSphere handles antimeridian-crossing regions (e.g. Alaska) correctly.
            // offset pitch=-90 forces the camera directly overhead so large regions
            // (like the US spanning Alaska→Puerto Rico) don't appear shifted south.
            const sphere = Cesium.BoundingSphere.fromPoints(polygons.flat());
            viewer.camera.flyToBoundingSphere(sphere, {
              duration: 1.5,
              offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), sphere.radius * 2.5),
            });
          });

          const removeBtn = document.createElement("button");
          removeBtn.className = "hl-remove";
          removeBtn.textContent = "×";
          removeBtn.addEventListener("click", () => removeHighlight(h.key));

          header.appendChild(swatch);
          header.appendChild(nameEl);
          header.appendChild(flyBtn);
          header.appendChild(labelBtn);
          header.appendChild(labelTextInput);
          header.appendChild(removeBtn);

          // ── Body ────────────────────────────────────────────────────────────
          const body = document.createElement("div");
          body.className = "hl-card-body";

          body.appendChild(makeCtrlRow(
            "Outline", h.outlineOpacity, h.outlineWidth,
            (opacity) => { h.outlineOpacity = opacity; refreshOutlineEntities(h); },
            (width)   => { h.outlineWidth   = width;   if (h.outlineOpacity > 0) refreshOutlineEntities(h); }
          ));

          if (h.type === "country") {
            body.appendChild(makeCtrlRow(
              "Regions", h.subregionOpacity, h.subregionWidth,
              (opacity) => { h.subregionOpacity = opacity; refreshSubregionEntities(h); },
              (width)   => { h.subregionWidth   = width;   if (h.subregionOpacity > 0) refreshSubregionEntities(h); }
            ));
          }

          // Fill row
          const fillRow = document.createElement("div");
          fillRow.className = "hl-ctrl-row";

          const fillLabel = document.createElement("span");
          fillLabel.className = "hl-ctrl-label";
          fillLabel.textContent = "Fill";

          const fillSlider = document.createElement("input");
          fillSlider.type = "range";
          fillSlider.min = "0";
          fillSlider.max = "100";
          fillSlider.step = "5";
          fillSlider.value = String(Math.round(h.fillOpacity * 100));
          fillSlider.className = "hl-ctrl-slider";

          const fillPct = document.createElement("span");
          fillPct.className = "hl-ctrl-pct";
          fillPct.textContent = Math.round(h.fillOpacity * 100) + "%";

          fillSlider.addEventListener("input", (e) => {
            fillPct.textContent = e.target.value + "%";
            setFillOpacity(h.key, parseInt(e.target.value) / 100);
          });

          const invertBtn = document.createElement("button");
          invertBtn.className = "hl-toggle" + (h.invert ? " hl-toggle-active" : "");
          invertBtn.textContent = h.invert ? "mask" : "fill";
          invertBtn.title = "Toggle fill region / mask everything else";
          invertBtn.addEventListener("click", () => setFillInvert(h.key, !h.invert));

          fillRow.appendChild(fillLabel);
          fillRow.appendChild(fillSlider);
          fillRow.appendChild(fillPct);
          fillRow.appendChild(invertBtn);
          body.appendChild(fillRow);

          // ── Collapsible label style section ─────────────────────────────
          const labelStyleToggle = document.createElement("button");
          labelStyleToggle.style.cssText = "width:100%;text-align:left;background:#eef;border:none;border-top:1px solid #ddd;padding:3px 6px;font-size:11px;color:#669;cursor:pointer;margin-top:4px;";
          labelStyleToggle.textContent = "▸ Label Style";
          body.appendChild(labelStyleToggle);

          const labelStylePanel = document.createElement("div");
          labelStylePanel.style.cssText = "display:none;flex-direction:column;gap:4px;padding:4px 2px 2px;";
          body.appendChild(labelStylePanel);

          labelStyleToggle.addEventListener("click", () => {
            const open = labelStylePanel.style.display === "none";
            labelStylePanel.style.display = open ? "flex" : "none";
            labelStyleToggle.textContent = (open ? "▼" : "▸") + " Label Style";
          });

          // Label color row
          const lsColorRow = document.createElement("div");
          lsColorRow.className = "city-style-row";
          const lsColorLbl = document.createElement("span"); lsColorLbl.textContent = "Color"; lsColorLbl.style.cssText = "font-size:10px;color:#888;";
          const lsColorSwatch = document.createElement("span");
          lsColorSwatch.title = "Label text color";
          lsColorSwatch.style.cssText = `display:inline-block;width:20px;height:14px;border-radius:3px;border:1px solid #aaa;background:${h.labelColor ?? h.color};cursor:pointer;`;
          const lsColorInput = document.createElement("input");
          lsColorInput.type = "color";
          lsColorInput.value = h.labelColor ?? h.color;
          lsColorInput.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
          lsColorSwatch.appendChild(lsColorInput);
          lsColorSwatch.addEventListener("click", () => lsColorInput.click());
          lsColorInput.addEventListener("input", e => {
            h.labelColor = e.target.value;
            lsColorSwatch.style.background = h.labelColor;
            updateHighlightLabelStyle(h.key);
          });
          lsColorRow.append(lsColorLbl, lsColorSwatch);
          labelStylePanel.appendChild(lsColorRow);

          // Font row
          const lsFontRow = document.createElement("div");
          lsFontRow.className = "city-style-row";
          const lsSizeLbl = document.createElement("span"); lsSizeLbl.textContent = "Size"; lsSizeLbl.style.cssText = "font-size:10px;color:#888;";
          const lsSizeIn = document.createElement("input"); lsSizeIn.type="number"; lsSizeIn.min="8"; lsSizeIn.max="40"; lsSizeIn.step="1";
          lsSizeIn.value = String(h.labelFontSize??14); lsSizeIn.style.cssText = "width:38px;font-size:11px;padding:1px 3px;margin:0;text-align:center;";
          lsSizeIn.addEventListener("change", e => { h.labelFontSize = parseFloat(e.target.value)||14; updateHighlightLabelStyle(h.key); });
          const lsBoldBtn = document.createElement("button");
          lsBoldBtn.className = "hl-toggle" + (h.labelFontWeight==='bold' ? " hl-toggle-active" : "");
          lsBoldBtn.textContent = "B"; lsBoldBtn.title = "Bold"; lsBoldBtn.style.cssText = "font-weight:bold;min-width:24px;";
          lsBoldBtn.addEventListener("click", () => {
            h.labelFontWeight = h.labelFontWeight==='bold' ? 'normal' : 'bold';
            lsBoldBtn.className = "hl-toggle" + (h.labelFontWeight==='bold' ? " hl-toggle-active" : "");
            updateHighlightLabelStyle(h.key);
          });
          const lsFontSel = makeFontSelect(h.labelFontFamily||'Arial', "font-size:11px;padding:1px 3px;border-radius:3px;border:1px solid #bbb;background:#fff;margin:0;flex:1;", val => { h.labelFontFamily = val; updateHighlightLabelStyle(h.key); });
          lsFontRow.append(lsSizeLbl, lsSizeIn, lsBoldBtn, lsFontSel);
          labelStylePanel.appendChild(lsFontRow);

          // Offset row
          const lsOffRow = document.createElement("div"); lsOffRow.className = "city-style-row";
          const lsXLbl = document.createElement("span"); lsXLbl.textContent = "X"; lsXLbl.style.cssText = "font-size:10px;color:#888;";
          const lsXIn = document.createElement("input"); lsXIn.type="number"; lsXIn.min="-60"; lsXIn.max="60"; lsXIn.step="1";
          lsXIn.value = String(h.labelOffsetX??0); lsXIn.style.cssText = "width:38px;font-size:11px;padding:1px 3px;margin:0;text-align:center;";
          lsXIn.addEventListener("change", e => { h.labelOffsetX = parseInt(e.target.value)||0; updateHighlightLabelStyle(h.key); });
          const lsYLbl = document.createElement("span"); lsYLbl.textContent = "Y"; lsYLbl.style.cssText = "font-size:10px;color:#888;";
          const lsYIn = document.createElement("input"); lsYIn.type="number"; lsYIn.min="-60"; lsYIn.max="60"; lsYIn.step="1";
          lsYIn.value = String(h.labelOffsetY??0); lsYIn.style.cssText = "width:38px;font-size:11px;padding:1px 3px;margin:0;text-align:center;";
          lsYIn.addEventListener("change", e => { h.labelOffsetY = parseInt(e.target.value)||0; updateHighlightLabelStyle(h.key); });
          lsOffRow.append(lsXLbl, lsXIn, lsYLbl, lsYIn);
          labelStylePanel.appendChild(lsOffRow);

          // Opacity row
          const lsOpRow = document.createElement("div"); lsOpRow.className = "city-style-row";
          const lsOpLbl = document.createElement("span"); lsOpLbl.textContent = "Opacity"; lsOpLbl.style.cssText = "font-size:10px;color:#888;";
          const lsOpSlider = document.createElement("input"); lsOpSlider.type="range"; lsOpSlider.min="0"; lsOpSlider.max="100"; lsOpSlider.step="5";
          lsOpSlider.value = String(Math.round((h.labelOpacity??1)*100)); lsOpSlider.style.cssText = "flex:1;min-width:40px;";
          const lsOpPct = document.createElement("span"); lsOpPct.textContent = Math.round((h.labelOpacity??1)*100)+"%"; lsOpPct.style.cssText = "font-size:10px;color:#888;width:28px;text-align:right;";
          lsOpSlider.addEventListener("input", e => { h.labelOpacity = parseInt(e.target.value)/100; lsOpPct.textContent = e.target.value+"%"; updateHighlightLabelStyle(h.key); });
          lsOpRow.append(lsOpLbl, lsOpSlider, lsOpPct);
          labelStylePanel.appendChild(lsOpRow);

          card.appendChild(header);
          card.appendChild(body);
          container.appendChild(card);
        });
      }

      // ── Event Listeners ─────────────────────────────────────────────────────
      document.getElementById("basemapSelect").addEventListener("change", e => applyBasemap(e.target.value));
      document.getElementById("basemapDateInput").addEventListener("change", () => applyBasemap(currentBasemap));
      function updateLabelsButtons(on) {
        const onBtn  = document.getElementById('basemapLabelsOn');
        const offBtn = document.getElementById('basemapLabelsOff');
        onBtn.style.background  = on  ? '#4a9eff' : '';
        onBtn.style.color       = on  ? '#fff'    : '';
        onBtn.style.fontWeight  = on  ? 'bold'    : '';
        offBtn.style.background = !on ? '#4a9eff' : '';
        offBtn.style.color      = !on ? '#fff'    : '';
        offBtn.style.fontWeight = !on ? 'bold'    : '';
      }
      document.getElementById("basemapLabelsOn").addEventListener("click", () => {
        basemapShowLabels = true;
        document.getElementById('basemapLabelsCheck').checked = true;
        updateLabelsButtons(true);
        applyBasemap(currentBasemap);
      });
      document.getElementById("basemapLabelsOff").addEventListener("click", () => {
        basemapShowLabels = false;
        document.getElementById('basemapLabelsCheck').checked = false;
        updateLabelsButtons(false);
        applyBasemap(currentBasemap);
      });
      document.getElementById("basemapLabelsCheck").addEventListener("change", e => {
        basemapShowLabels = e.target.checked;
        updateLabelsButtons(basemapShowLabels);
        applyBasemap(currentBasemap);
      });

      document.getElementById("bordersLandOnlyCheck").addEventListener("change", e => {
        bordersLandOnly = e.target.checked;
        reloadBorders();
      });

      document.getElementById("basemapMaxLevelInput").addEventListener("change", e => {
        const v = parseInt(e.target.value);
        basemapMaxLevelOverride = (isNaN(v) || e.target.value === '') ? null : Math.max(1, Math.min(22, v));
        e.target.value = basemapMaxLevelOverride ?? '';
        applyBasemap(currentBasemap);
      });
      document.getElementById("basemapMaxLevelAuto").addEventListener("click", () => {
        basemapMaxLevelOverride = null;
        document.getElementById("basemapMaxLevelInput").value = '';
        applyBasemap(currentBasemap);
      });

      // ── Scene mode ───────────────────────────────────────────────────────────
      document.querySelectorAll(".scene-mode-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          if (!viewer) return;
          const mode = btn.dataset.mode;
          triggerSceneMode(mode, 1.5);
          lastPlaybackMode = mode; // prevent playback from re-triggering this transition
        });
      });

      // ── Looks event listeners ────────────────────────────────────────────────
      document.getElementById("looksSelect").addEventListener("change", (e) => {
        const look = getAllLooks().find(l => l.name === e.target.value);
        if (look) applyLook(look);
        document.getElementById("deleteLookBtn").disabled = isBuiltIn(e.target.value);
      });

      document.getElementById("deleteLookBtn").addEventListener("click", () => {
        const name = document.getElementById("looksSelect").value;
        if (isBuiltIn(name)) return;
        const updated = loadUserLooks().filter(l => l.name !== name);
        saveUserLooks(updated);
        renderLooksSelect();
      });

      document.getElementById("confirmSaveLookBtn").addEventListener("click", () => {
        const nameInput = document.getElementById("lookNameInput");
        const name = nameInput.value.trim();
        if (!name) return;
        const look = captureLook(name);
        const existing = loadUserLooks();
        const idx = existing.findIndex(l => l.name === name);
        if (idx >= 0) existing[idx] = look; else existing.push(look);
        saveUserLooks(existing);
        renderLooksSelect();
        document.getElementById("looksSelect").value = name;
        document.getElementById("deleteLookBtn").disabled = false;
        nameInput.value = "";
      });

      document.getElementById("lookNameInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("confirmSaveLookBtn").click();
      });

      document.getElementById("defaultRegionColorPicker").addEventListener("input", (e) => {
        defaultRegionColor = e.target.value;
      });

      document.getElementById("defaultCityColorPicker").addEventListener("input", (e) => {
        defaultCityColor = e.target.value;
      });

      // Basemap adjustment sliders
      [
        { id: "bm-brightness", key: "brightness", scale: v => v / 100,         fmt: v => v + "%"               },
        { id: "bm-contrast",   key: "contrast",   scale: v => v / 100,         fmt: v => v + "%"               },
        { id: "bm-saturation", key: "saturation", scale: v => v / 100,         fmt: v => v + "%"               },
        { id: "bm-hue",        key: "hue",        scale: v => v,               fmt: v => (v > 0 ? "+" : "") + v + "°" },
        { id: "bm-gamma",      key: "gamma",      scale: v => v / 100,         fmt: v => (v / 100).toFixed(2)  },
      ].forEach(({ id, key, scale, fmt }) => {
        document.getElementById(id).addEventListener("input", e => {
          const raw = parseInt(e.target.value);
          bmAdjust[key] = scale(raw);
          document.getElementById(id + "-val").textContent = fmt(raw);
          applyBmAdjust();
        });
      });

      document.getElementById("bm-reset").addEventListener("click", () => {
        const defaults = { brightness: 100, contrast: 100, saturation: 100, hue: 0, gamma: 100 };
        const fmts     = { brightness: "100%", contrast: "100%", saturation: "100%", hue: "0°", gamma: "1.00" };
        for (const [key, val] of Object.entries(defaults)) {
          document.getElementById("bm-" + key).value = val;
          document.getElementById("bm-" + key + "-val").textContent = fmts[key];
        }
        Object.assign(bmAdjust, { brightness: 1, contrast: 1, saturation: 1, hue: 0, gamma: 1 });
        applyBmAdjust();
      });

      // Per-layer border materials — update in-place to avoid per-entity re-assignment.
      let countryBorderMat   = null;
      let stateBorderMat     = null;
      let countryBorderAlpha = 0.7; // shared opacity read by the CallbackProperty every frame
      let stateBorderAlpha   = 0.5;

      const _isMobBorder = () => navigator.maxTouchPoints > 1 || /iPhone|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 1366;

      function setCountryBorderOpacity(ratio) {
        if (!countryDataSource) return;
        countryBorderAlpha = ratio;
        if (_isMobBorder()) return; // CallbackProperty reads countryBorderAlpha every frame
        if (!countryBorderMat) {
          countryBorderMat = new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(() => hexToCesiumColor(borderColor, countryBorderAlpha), false)
          );
          for (const entity of countryDataSource.entities.values)
            if (entity.polyline) entity.polyline.material = countryBorderMat;
        }
      }

      function setStateBorderOpacity(ratio) {
        if (!stateDataSource) return;
        stateBorderAlpha = ratio;
        if (_isMobBorder()) return; // CallbackProperty reads stateBorderAlpha every frame
        if (!stateBorderMat) {
          stateBorderMat = new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(() => hexToCesiumColor(borderColor, stateBorderAlpha), false)
          );
          for (const entity of stateDataSource.entities.values)
            if (entity.polyline) entity.polyline.material = stateBorderMat;
        }
      }

      function setBorderColor(hex) {
        borderColor = hex;
        document.getElementById('borderColorSwatch').style.background = hex;
        document.getElementById('borderColorInput').value = hex;
        // borderColor is read directly by the CallbackProperty closures above and by
        // countyMaterial updates below — no need to call set*BorderOpacity for color changes.
        // Update county color via material uniform (no rebuild needed for a color change)
        if (countyMaterial) {
          countyMaterial.uniforms.color = hexToCesiumColor(borderColor, countyCurrentOpacity);
        } else if (countyCurrentOpacity > 0) {
          rebuildCountyPrimitive();
        }
      }

      // County borders — drawn directly as GroundPolylinePrimitive (no entity overhead,
      // correct globe-limb depth handling, proper MultiPolygon/hole support).
      let countyPositions      = null; // Map<fips2, Cartesian3[][]>
      let countyLoading        = false;
      let countyPrimitive      = null; // active GroundPolylinePrimitive
      let countyMaterial       = null; // direct ref to the primitive's Color material
      let countyFilter         = '';   // '' = all, or 2-digit state FIPS
      let countyCurrentOpacity = 0;

      function rebuildCountyPrimitive() {
        if (countyPrimitive) {
          viewer.scene.primitives.remove(countyPrimitive);
          countyPrimitive = null;
          countyMaterial  = null;
        }
        if (!countyPositions) return;
        const rings = countyFilter
          ? (countyPositions.get(countyFilter) || [])
          : Array.from(countyPositions.values()).flat();
        if (!rings.length) return;
        const instances = rings.map(positions =>
          new Cesium.GeometryInstance({
            geometry: new Cesium.GroundPolylineGeometry({ positions, width: 1 }),
          })
        );
        // Keep a direct reference to the material so opacity/color updates never
        // need to go through the primitive's appearance chain (which may be
        // inaccessible before the first render) and never trigger a rebuild.
        countyMaterial = Cesium.Material.fromType('Color', {
          color: hexToCesiumColor(borderColor, countyCurrentOpacity),
        });
        countyPrimitive = viewer.scene.primitives.add(
          new Cesium.GroundPolylinePrimitive({
            geometryInstances: instances,
            appearance: new Cesium.PolylineMaterialAppearance({
              material:    countyMaterial,
              translucent: true,
            }),
          })
        );
      }

      async function loadCountyPositions() {
        if (countyLoading || countyPositions) return;
        countyLoading = true;
        setStatus("Loading county data…");
        try {
          const res    = await fetch("/api/counties");
          const geojson = await res.json();
          countyPositions = new Map();
          const newCountyKeys = [];
          for (const feature of geojson.features) {
            const fips5 = String(feature.id ?? '').padStart(5, '0');
            const fips2 = fips5.slice(0, 2);
            if (!fips2 || fips2 === '00') continue;
            const geom = feature.geometry;
            if (!geom) continue;
            const countyName = feature.properties?.NAME || '';
            const lsad       = feature.properties?.LSAD || 'County';
            const stateName  = STATE_FIPS[fips2] || '';
            const displayStr = stateName ? `${countyName} ${lsad}, ${stateName}` : countyName;
            // Handle Polygon (all rings) and MultiPolygon (all polygons, all rings)
            const rings = geom.type === 'Polygon'
              ? geom.coordinates
              : geom.type === 'MultiPolygon'
                ? geom.coordinates.flat()
                : [];
            for (const ring of rings) {
              const raw = Cesium.Cartesian3.fromDegreesArray(
                ring.flatMap(([lng, lat]) => [lng, lat])
              );
              if (raw.length < 2) continue;
              // Deduplicate consecutive identical vertices (same fix that resolved Alaska flicker)
              const deduped = [raw[0]];
              for (let i = 1; i < raw.length; i++) {
                const p = raw[i], q = deduped[deduped.length - 1];
                if (Math.abs(p.x - q.x) > 1 || Math.abs(p.y - q.y) > 1 || Math.abs(p.z - q.z) > 1)
                  deduped.push(p);
              }
              // Ensure ring is closed
              const f = deduped[0], l = deduped[deduped.length - 1];
              if (Math.abs(f.x - l.x) > 1 || Math.abs(f.y - l.y) > 1 || Math.abs(f.z - l.z) > 1)
                deduped.push(deduped[0]);
              if (deduped.length < 2) continue;
              // For border rendering: group by state FIPS
              if (!countyPositions.has(fips2)) countyPositions.set(fips2, []);
              countyPositions.get(fips2).push(deduped);
              // For region search/highlight: group by county display name
              if (!regionLookup.has(displayStr)) {
                regionLookup.set(displayStr, { key: `county||${fips5}`, name: displayStr, polygons: [] });
                newCountyKeys.push(displayStr);
              }
              regionLookup.get(displayStr).polygons.push(deduped);
            }
          }
          // Append county options to the datalist (sorted)
          if (newCountyKeys.length) {
            const dl = document.getElementById("regionDatalist");
            newCountyKeys.sort().forEach(str => {
              const opt = document.createElement("option");
              opt.value = str;
              dl.appendChild(opt);
            });
          }
          setStatus("");
        } catch (e) {
          console.error("[counties]", e);
          setStatus("Failed to load county data");
          countyLoading = false;
          return;
        }
        countyLoading = false;
        if (countyCurrentOpacity > 0) rebuildCountyPrimitive();
      }

      function setCountyBorderOpacity(ratio) {
        countyCurrentOpacity = ratio;
        document.getElementById("countyBorderOpacity").value = Math.round(ratio * 100);
        document.getElementById("countyBorderOpacityVal").textContent = Math.round(ratio * 100) + "%";
        document.getElementById("countyFilterRow").style.display = ratio > 0 ? "" : "none";

        if (!countyPositions) {
          if (ratio > 0) loadCountyPositions(); // async — will call rebuildCountyPrimitive() on completion
          return;
        }
        // Update via direct material reference — avoids expensive GPU retessellation.
        // Do NOT remove the primitive at ratio=0; keep it alive with alpha=0 so the next
        // opacity-up is instant rather than triggering a 5-second GroundPolylinePrimitive rebuild.
        if (countyMaterial) {
          countyMaterial.uniforms.color = hexToCesiumColor(borderColor, ratio);
        } else if (ratio > 0) {
          rebuildCountyPrimitive();
        }
      }

      function setCountyFilter(fips2) {
        if (fips2 === countyFilter) return;
        countyFilter = fips2;
        if (countyPositions && countyCurrentOpacity > 0) rebuildCountyPrimitive();
      }

      // Ratio lock — when enabled, moving any slider scales the others proportionally.
      let borderRatioLocked = false;

      function onBorderSliderInput(changedId, valId, setterFn) {
        return function(e) {
          const newVal = parseInt(e.target.value);
          document.getElementById(valId).textContent = newVal + "%";
          setterFn(newVal / 100);

          if (borderRatioLocked) {
            const oldVal = parseInt(e.target.dataset.prev ?? newVal);
            const factor = oldVal > 0 ? newVal / oldVal : 0;
            for (const [sid, vid, fn] of [
              ['countryBorderOpacity', 'countryBorderOpacityVal', setCountryBorderOpacity],
              ['stateBorderOpacity',   'stateBorderOpacityVal',   setStateBorderOpacity],
              ['countyBorderOpacity',  'countyBorderOpacityVal',  setCountyBorderOpacity],
            ]) {
              if (sid === changedId) continue;
              const el = document.getElementById(sid);
              const scaled = Math.min(100, Math.round(parseInt(el.value) * factor));
              el.value = scaled;
              document.getElementById(vid).textContent = scaled + "%";
              fn(scaled / 100);
              el.dataset.prev = scaled;
            }
          }
          e.target.dataset.prev = newVal;
        };
      }

      document.getElementById("countryBorderOpacity").addEventListener("input",
        onBorderSliderInput("countryBorderOpacity", "countryBorderOpacityVal", setCountryBorderOpacity));
      document.getElementById("stateBorderOpacity").addEventListener("input",
        onBorderSliderInput("stateBorderOpacity", "stateBorderOpacityVal", setStateBorderOpacity));
      document.getElementById("countyBorderOpacity").addEventListener("input",
        onBorderSliderInput("countyBorderOpacity", "countyBorderOpacityVal", setCountyBorderOpacity));

      document.getElementById("countyStateFilter").addEventListener("change", e => {
        setCountyFilter(e.target.value);
      });

      // Populate state filter dropdown from STATE_FIPS mapping
      (function() {
        const sel = document.getElementById("countyStateFilter");
        Object.entries(STATE_FIPS)
          .sort((a, b) => a[1].localeCompare(b[1]))
          .forEach(([fips, name]) => {
            const opt = document.createElement("option");
            opt.value = fips;
            opt.textContent = name;
            sel.appendChild(opt);
          });
      })();

      async function runRegionQuery() {
        const query = document.getElementById("regionQuery").value.trim();
        if (!query) return;
        const btn    = document.getElementById("regionQueryBtn");
        const status = document.getElementById("regionQueryStatus");
        btn.disabled = true;
        status.style.display = "";
        status.textContent = "Querying…";
        try {
          const res  = await fetch("/api/region-query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
          });
          const data = await res.json();
          if (!res.ok) { status.textContent = "Error: " + (data.error || res.statusText); return; }
          const { matches, level, count, filterSpec, sources } = data;
          if (!matches?.length) { status.textContent = "No regions matched."; return; }
          // Create a new group named after the query, add all matches as members
          const groupName = query.length > 40 ? query.slice(0, 37) + "…" : query;
          createGroup(groupName, { query, level, filterSpec, count, sources });
          const group = regionGroups[regionGroups.length - 1];
          let added = 0;
          for (const name of matches) {
            if (level === "state") {
              // Always use US-state-specific lookup — plain `name` key may match the country instead
              // (e.g. "Georgia" the country is stored as "Georgia"; the US state is "Georgia (United States of America)")
              const key = [...regionLookup.keys()].find(k =>
                k.startsWith(name + " (") && regionLookup.get(k).key.startsWith("state||United States of America||")
              );
              if (key) { addMemberToGroup(group.id, key); added++; }
            } else if (regionLookup.has(name)) {
              addMemberToGroup(group.id, name); added++;
            } else if (level === "country") {
              // AI may return "United States" but lookup has "United States of America" — fuzzy match
              const nameLower = name.toLowerCase();
              const candidates = [...regionLookup.keys()].filter(k =>
                regionLookup.get(k).key.startsWith("country||") &&
                (k.toLowerCase().startsWith(nameLower) || nameLower.startsWith(k.toLowerCase()))
              );
              // Pick shortest candidate — avoids "United States Minor Outlying Islands" over "United States of America"
              const key = candidates.sort((a, b) => a.length - b.length)[0];
              if (key) { addMemberToGroup(group.id, key); added++; }
            }
          }
          status.textContent = `Created group with ${added} ${level}s.`;
          document.getElementById("regionQuery").value = "";
        } catch (e) {
          status.textContent = "Request failed: " + e.message;
        } finally {
          btn.disabled = false;
        }
      }

      document.getElementById("regionQueryBtn").addEventListener("click", runRegionQuery);
      document.getElementById("regionQuery").addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runRegionQuery(); }
      });

      document.getElementById("borderRatioLockBtn").addEventListener("click", () => {
        borderRatioLocked = !borderRatioLocked;
        document.getElementById("borderRatioLockBtn").textContent = borderRatioLocked ? "🔒" : "🔓";
        document.getElementById("borderRatioLockBtn").style.color = borderRatioLocked ? "#4a9eff" : "#888";
      });

      document.getElementById("borderColorSwatch").addEventListener("click", () => {
        document.getElementById("borderColorInput").click();
      });
      document.getElementById("borderColorInput").addEventListener("input", e => {
        setBorderColor(e.target.value);
      });

      document.getElementById("addRegionBtn").addEventListener("click", () => {
        const val = document.getElementById("regionSearch").value.trim();
        if (!val) return;
        addHighlight(val);
        document.getElementById("regionSearch").value = "";
      });

      document.getElementById("regionSearch").addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const val = e.target.value.trim();
        if (!val) return;
        addHighlight(val);
        e.target.value = "";
      });

      // ── Region Groups ───────────────────────────────────────────────────────
      let regionGroups = [];
      let nextGroupId  = 1;
      const GROUP_COLORS = [
        '#3b82f6','#ef4444','#22c55e','#f59e0b','#a855f7',
        '#06b6d4','#f97316','#ec4899','#84cc16','#14b8a6',
      ];
      let nextGroupColorIdx = 0;

      function getGroupPolygons(group) {
        const all = [];
        for (const m of group.members) {
          const entry = regionLookup.get(m.name);
          if (entry) all.push(...entry.polygons);
        }
        return all;
      }

      function refreshGroupEntities(group) {
        const show = group.visible !== false;

        // Remove outline entities (shared, group-level)
        group.entities.forEach(e => viewer.entities.remove(e));
        group.entities = [];

        // Remove all fill entities — per-member in normal mode, group-level in invert mode
        group.members.forEach(m => { (m.fillEntities || []).forEach(removeFillItem); m.fillEntities = []; });
        group.fillEntities.forEach(removeFillItem);
        group.fillEntities = [];

        const allPolygons = getGroupPolygons(group);

        // Outlines: shared group-level ref (all members combined)
        if (!group.outlineRef) group.outlineRef = { color: group.color, opacity: group.outlineOpacity ?? 1 };
        group.outlineRef.color   = group.color;
        group.outlineRef.opacity = group.outlineOpacity ?? 1;
        group.entities = (group.outlineOpacity ?? 1) > 0
          ? makePolylineEntities(allPolygons, group.color, group.outlineWidth ?? 2, group.outlineOpacity ?? 1, group.outlineRef)
          : [];
        group.entities.forEach(e => { e.show = show; });

        if (group.invert) {
          // Invert (mask) mode: group-level fill over all polygons combined
          if (!group.fillRef) group.fillRef = { color: group.color, opacity: group.fillOpacity };
          group.fillRef.color   = group.color;
          group.fillRef.opacity = group.fillOpacity;
          group.fillEntities = group.fillOpacity > 0
            ? makeFillEntities(allPolygons, group.color, group.fillOpacity, true, null)
            : [];
          group.fillEntities.forEach(item => { item.show = show; });
        } else {
          // Normal mode: per-member fill with independent refs for independent animation
          group.fillRef = null;
          for (const member of group.members) {
            const entry = regionLookup.get(member.name);
            const polygons = entry?.polygons || [];
            const opacity = member.fillOpacity ?? group.fillOpacity;
            if (!member.fillRef) member.fillRef = { color: group.color, opacity };
            member.fillRef.color   = group.color;
            member.fillRef.opacity = opacity;
            member.fillEntities = polygons.length > 0 && opacity > 0
              ? makeFillEntities(polygons, group.color, opacity, false, member.fillRef)
              : [];
            member.fillEntities.forEach(item => { item.show = show; });
          }
        }

        updateGroupLabel(group);
      }

      function createGroup(name, aiMeta = null) {
        if (!name) return;
        regionGroups.push({
          id: nextGroupId++,
          name,
          color: GROUP_COLORS[nextGroupColorIdx++ % GROUP_COLORS.length],
          outlineOpacity: 1.0,
          outlineWidth: 2.0,
          outlineRef: null,
          fillOpacity: 0.3,
          fillRef: null,
          invert: false,
          members: [],
          entities: [],
          fillEntities: [],
          visible: true,
          showLabel: false,
          labelEntity: null,
          membersCollapsed: false,
          aiMeta, // { query, level, filterSpec, count } — set when created via AI query
        });
        const newGroup = regionGroups[regionGroups.length - 1];
        tracks['group_'+newGroup.id] = { id:'group_'+newGroup.id, label:'Group: '+name, category:'group',
          color:'#3388ff', h:22, keyframes:[], collapsed:true };
        selectedTrackIds.add('group_'+newGroup.id);
        tlBuildLabels();
        renderGroupList();
      }

      function deleteGroup(id) {
        const idx = regionGroups.findIndex(g => g.id === id);
        if (idx === -1) return;
        const g = regionGroups[idx];
        const gid = g.id;
        g.entities.forEach(e => viewer.entities.remove(e));
        g.fillEntities.forEach(removeFillItem);
        g.members.forEach(m => {
          (m.fillEntities || []).forEach(removeFillItem);
          const tid = `gmember_${gid}_${m.key}`;
          delete tracks[tid];
          selectedTrackIds.delete(tid);
        });
        if (g.labelEntity) viewer.entities.remove(g.labelEntity);
        regionGroups.splice(idx, 1);
        delete tracks['group_' + gid];
        selectedTrackIds.delete('group_' + gid);
        tlBuildLabels();
        renderGroupList();
      }

      function setGroupVisible(group, visible) {
        group.visible = visible;
        group.entities.forEach(e => { e.show = visible; });
        group.fillEntities.forEach(item => { item.show = visible; });
        group.members.forEach(m => (m.fillEntities || []).forEach(item => { item.show = visible; }));
        if (group.labelEntity) group.labelEntity.show = visible && group.showLabel;
      }

      function updateGroupLabel(group) {
        if (group.labelEntity) { viewer.entities.remove(group.labelEntity); group.labelEntity = null; }
        if (!group.showLabel || !group.members.length) return;
        // Compute centroid of all group polygons via bounding sphere
        const allPos = [];
        for (const m of group.members) {
          const entry = regionLookup.get(m.name);
          if (entry?.polygons) for (const poly of entry.polygons) allPos.push(...poly);
        }
        if (!allPos.length) return;
        const center = Cesium.BoundingSphere.fromPoints(allPos).center;
        group.labelEntity = viewer.entities.add({
          position: center,
          label: {
            text: group.name,
            font: 'bold 13px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: hexToCesiumColor(group.color, 1),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(0, -4),
            show: group.visible,
          },
        });
      }

      function addMemberToGroup(groupId, displayStr) {
        const group = regionGroups.find(g => g.id === groupId);
        if (!group) return;
        const entry = regionLookup.get(displayStr);
        if (!entry) return;
        if (group.members.some(m => m.key === entry.key)) return;
        group.members.push({ key: entry.key, name: entry.name, fillRef: null, fillEntities: [] });
        // Create a per-member animation track (hidden under group's expand triangle)
        const memberTrackId = `gmember_${group.id}_${entry.key}`;
        const shortLabel = entry.name.replace(/\s*\(.*\)$/, '');
        tracks[memberTrackId] = { id: memberTrackId, label: shortLabel, category: 'group_member',
          parentId: 'group_' + group.id, color: group.color, h: 18, keyframes: [],
          isSub: true, isRealTrack: true };
        refreshGroupEntities(group);
        renderGroupList();
      }

      function removeMemberFromGroup(groupId, memberKey) {
        const group = regionGroups.find(g => g.id === groupId);
        if (!group) return;
        const removing = group.members.find(m => m.key === memberKey);
        if (removing) {
          (removing.fillEntities || []).forEach(removeFillItem);
          const tid = `gmember_${group.id}_${memberKey}`;
          delete tracks[tid];
          selectedTrackIds.delete(tid);
        }
        group.members = group.members.filter(m => m.key !== memberKey);
        refreshGroupEntities(group);
        renderGroupList();
      }

      function renderGroupList() {
        const container = document.getElementById("groupList");
        container.innerHTML = "";

        for (const group of regionGroups) {
          const card = document.createElement("div");
          card.className = "group-card";

          // ── Header ──────────────────────────────────────────────────────────
          const header = document.createElement("div");
          header.className = "group-header";

          // Color picker
          const colorInput = document.createElement("input");
          colorInput.type = "color";
          colorInput.value = group.color;
          colorInput.className = "group-color-picker";
          colorInput.title = "Change color";
          colorInput.addEventListener("input", e => {
            group.color = e.target.value;
            refreshGroupEntities(group);
          });

          // Name
          const nameEl = document.createElement("span");
          nameEl.className = "group-name";
          nameEl.textContent = group.name;

          // Member count badge
          const countBadge = document.createElement("span");
          countBadge.className = "group-count-badge";
          countBadge.textContent = group.members.length;
          countBadge.title = `${group.members.length} region${group.members.length !== 1 ? "s" : ""}`;

          // Visibility toggle
          const visBtn = document.createElement("button");
          visBtn.className = "group-icon-btn" + (group.visible !== false ? "" : " group-icon-btn-off");
          visBtn.textContent = "👁";
          visBtn.title = group.visible !== false ? "Hide group" : "Show group";
          visBtn.addEventListener("click", () => {
            const nowVisible = group.visible === false;
            setGroupVisible(group, nowVisible);
            visBtn.classList.toggle("group-icon-btn-off", !nowVisible);
            visBtn.title = nowVisible ? "Hide group" : "Show group";
          });

          // Label toggle
          const labelBtn = document.createElement("button");
          labelBtn.className = "group-icon-btn" + (group.showLabel ? " group-icon-btn-on" : "");
          labelBtn.textContent = "🏷";
          labelBtn.title = group.showLabel ? "Hide label" : "Show label on map";
          labelBtn.addEventListener("click", () => {
            group.showLabel = !group.showLabel;
            labelBtn.classList.toggle("group-icon-btn-on", group.showLabel);
            labelBtn.title = group.showLabel ? "Hide label" : "Show label on map";
            updateGroupLabel(group);
          });

          // Delete group
          const delBtn = document.createElement("button");
          delBtn.className = "hl-remove";
          delBtn.textContent = "×";
          delBtn.addEventListener("click", () => deleteGroup(group.id));

          header.append(colorInput, nameEl, countBadge, visBtn, labelBtn, delBtn);
          card.appendChild(header);

          // ── Body ────────────────────────────────────────────────────────────
          const body = document.createElement("div");
          body.className = "group-body";

          // Outline row
          body.appendChild(makeCtrlRow(
            "Outline", group.outlineOpacity ?? 1, group.outlineWidth ?? 2,
            (opacity) => {
              group.outlineOpacity = opacity;
              if (group.outlineRef) { group.outlineRef.color = group.color; group.outlineRef.opacity = opacity; }
              else refreshGroupEntities(group);
            },
            (width) => { group.outlineWidth = width; refreshGroupEntities(group); }
          ));

          // Fill row
          const fillRow = document.createElement("div");
          fillRow.className = "hl-ctrl-row";
          const fillLabel = document.createElement("span");
          fillLabel.className = "hl-ctrl-label";
          fillLabel.textContent = "Fill";
          const fillSlider = document.createElement("input");
          fillSlider.type = "range";
          fillSlider.min = "0"; fillSlider.max = "100"; fillSlider.step = "5";
          fillSlider.value = String(Math.round(group.fillOpacity * 100));
          fillSlider.className = "hl-ctrl-slider";
          const fillPct = document.createElement("span");
          fillPct.className = "hl-ctrl-pct";
          fillPct.textContent = Math.round(group.fillOpacity * 100) + "%";
          fillSlider.addEventListener("input", e => {
            fillPct.textContent = e.target.value + "%";
            const prev = group.fillOpacity;
            group.fillOpacity = parseInt(e.target.value) / 100;
            if (!group.invert && prev > 0 && group.fillOpacity > 0 &&
                group.members.every(m => (m.fillEntities?.length ?? 0) > 0)) {
              // Fast path: all members have live entities — just update their refs
              group.members.forEach(m => {
                if (m.fillRef) { m.fillRef.color = group.color; m.fillRef.opacity = group.fillOpacity; }
              });
            } else if (group.invert && group.fillRef && group.fillEntities.length > 0 && prev > 0 && group.fillOpacity > 0) {
              group.fillRef.color   = group.color;
              group.fillRef.opacity = group.fillOpacity;
            } else {
              refreshGroupEntities(group);
            }
          });
          const invertBtn = document.createElement("button");
          invertBtn.className = "hl-toggle" + (group.invert ? " hl-toggle-active" : "");
          invertBtn.textContent = group.invert ? "mask" : "fill";
          invertBtn.addEventListener("click", () => {
            group.invert = !group.invert;
            if (group.invert && group.fillOpacity === 0) { group.fillOpacity = 0.5; fillSlider.value = "50"; fillPct.textContent = "50%"; }
            invertBtn.className = "hl-toggle" + (group.invert ? " hl-toggle-active" : "");
            invertBtn.textContent = group.invert ? "mask" : "fill";
            refreshGroupEntities(group);
          });
          fillRow.append(fillLabel, fillSlider, fillPct, invertBtn);
          body.appendChild(fillRow);

          // AI sourcing row (only shown for AI-generated groups)
          if (group.aiMeta) {
            const aiRow = document.createElement("div");
            aiRow.className = "group-ai-row";
            const aiToggle = document.createElement("button");
            aiToggle.className = "group-ai-toggle";
            aiToggle.textContent = "✦ AI query";
            const aiDetail = document.createElement("div");
            aiDetail.className = "group-ai-detail";
            aiDetail.style.display = "none";
            const { query: aq, level: al, filterSpec: afs, count: ac, sources: asrc } = group.aiMeta;
            let detailHtml = `<div class="group-ai-query">"${aq}"</div>`;
            detailHtml += `<div class="group-ai-meta">Level: ${al} · ${ac} matched</div>`;
            if (afs?.filters?.length) {
              const fStr = afs.filters.map(f => `${f.field} ${f.op} ${JSON.stringify(f.value)}`).join(` ${afs.logic ?? 'and'} `);
              detailHtml += `<div class="group-ai-filters">${fStr}</div>`;
            } else if (afs?.names?.length) {
              detailHtml += `<div class="group-ai-filters">world knowledge · ${afs.names.length} names</div>`;
            }
            if (afs?.sort_by) detailHtml += `<div class="group-ai-filters">sorted by ${afs.sort_by} ${afs.sort_dir ?? ''}${afs.limit ? ` · top ${afs.limit}` : ''}</div>`;
            if (asrc?.length) {
              const srcHtml = asrc.map(s => s.url
                ? `<a href="${s.url}" target="_blank" rel="noopener" class="group-ai-src-link">${s.name}</a>`
                : `<span>${s.name}</span>`
              ).join(" · ");
              detailHtml += `<div class="group-ai-source">Data: ${srcHtml}</div>`;
            }
            aiDetail.innerHTML = detailHtml;
            aiToggle.addEventListener("click", () => {
              const open = aiDetail.style.display === "";
              aiDetail.style.display = open ? "none" : "";
              aiToggle.classList.toggle("group-ai-toggle-open", !open);
            });
            aiRow.append(aiToggle, aiDetail);
            body.appendChild(aiRow);
          }

          // ── Sequential appearance ────────────────────────────────────────
          const seqSection = document.createElement("div");
          seqSection.className = "group-seq-section";

          const seqHeader = document.createElement("div");
          seqHeader.className = "group-seq-header";
          const hasSeqKfs = group.members.some(m => {
            const t = tracks[`gmember_${group.id}_${m.key}`];
            return t && t.keyframes.length > 0;
          });
          seqHeader.innerHTML = `<span class="group-seq-arrow">${group.seqCollapsed !== false ? '▶' : '▼'}</span> Sequential appearance${hasSeqKfs ? ' <span class="group-seq-active">●</span>' : ''}`;

          const seqBody = document.createElement("div");
          seqBody.className = "group-seq-body";
          seqBody.style.display = group.seqCollapsed !== false ? 'none' : '';

          seqHeader.addEventListener('click', () => {
            group.seqCollapsed = group.seqCollapsed === false;
            seqBody.style.display = group.seqCollapsed !== false ? 'none' : '';
            seqHeader.querySelector('.group-seq-arrow').textContent = group.seqCollapsed !== false ? '▶' : '▼';
          });

          // Start / Interval inputs
          const seqInputRow = document.createElement("div");
          seqInputRow.className = "group-seq-inputs";

          const mkSeqField = (label, defaultVal, min, step) => {
            const wrap = document.createElement("label");
            wrap.className = "group-seq-field";
            const lbl = document.createElement("span");
            lbl.textContent = label;
            const inp = document.createElement("input");
            inp.type = "number"; inp.min = min; inp.step = step;
            inp.value = defaultVal;
            inp.style.cssText = "width:46px;font-size:11px;padding:2px 4px;";
            wrap.append(lbl, inp);
            return { wrap, inp };
          };

          const { wrap: startWrap, inp: startInp } = mkSeqField("Start (s)", group._seqStart ?? 2, 0, 0.5);
          const { wrap: intervalWrap, inp: intervalInp } = mkSeqField("Interval (s)", group._seqInterval ?? 0.5, 0.1, 0.1);
          seqInputRow.append(startWrap, intervalWrap);
          seqBody.appendChild(seqInputRow);

          // Apply / Clear buttons
          const seqBtnRow = document.createElement("div");
          seqBtnRow.className = "group-seq-btns";

          const applyBtn = document.createElement("button");
          applyBtn.textContent = "Apply";
          applyBtn.style.cssText = "flex:1;font-size:11px;padding:3px 6px;";
          applyBtn.addEventListener("click", () => {
            const startTime = parseFloat(startInp.value) || 0;
            const interval = Math.max(0.05, parseFloat(intervalInp.value) || 0.5);
            group._seqStart = startTime;
            group._seqInterval = interval;
            // Expand group track in timeline
            if (tracks['group_' + group.id]) tracks['group_' + group.id].collapsed = false;
            // Generate keyframes for each member
            group.members.forEach((member, idx) => {
              const tid = `gmember_${group.id}_${member.key}`;
              const track = tracks[tid];
              if (!track) return;
              const appearTime = startTime + idx * interval;
              track.keyframes = [
                { id: nextKfId++, time: 0, opacity: 0 },
                { id: nextKfId++, time: appearTime, opacity: 1 },
              ];
            });
            tlBuildLabels();
            tlDraw();
            renderGroupList();
          });

          const clearBtn = document.createElement("button");
          clearBtn.textContent = "Clear";
          clearBtn.style.cssText = "flex:1;font-size:11px;padding:3px 6px;color:#888;background:#f5f5f5;border-color:#ddd;";
          clearBtn.addEventListener("click", () => {
            group.members.forEach(member => {
              const t = tracks[`gmember_${group.id}_${member.key}`];
              if (t) t.keyframes = [];
            });
            tlBuildLabels();
            tlDraw();
            renderGroupList();
          });

          seqBtnRow.append(applyBtn, clearBtn);
          seqBody.appendChild(seqBtnRow);
          seqSection.append(seqHeader, seqBody);
          body.appendChild(seqSection);

          // Member add row (reuses the shared regionDatalist)
          const addRow = document.createElement("div");
          addRow.className = "group-add-row";
          const searchInput = document.createElement("input");
          searchInput.type = "text";
          searchInput.className = "group-region-search";
          searchInput.setAttribute("list", "regionDatalist");
          searchInput.placeholder = "Add country or state…";
          searchInput.autocomplete = "off";
          const addBtn = document.createElement("button");
          addBtn.className = "group-add-btn";
          addBtn.textContent = "+";
          const doAdd = () => {
            const val = searchInput.value.trim();
            if (!val) return;
            addMemberToGroup(group.id, val);
            searchInput.value = "";
          };
          addBtn.addEventListener("click", doAdd);
          searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doAdd(); });
          addRow.append(searchInput, addBtn);
          body.appendChild(addRow);

          // Collapsible member list
          const membersToggle = document.createElement("div");
          membersToggle.className = "group-members-toggle";
          membersToggle.innerHTML = `<span class="group-members-arrow">${group.membersCollapsed ? "▶" : "▼"}</span> <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${group.color};vertical-align:middle;margin-right:3px;"></span>Members`;
          body.appendChild(membersToggle);

          const ul = document.createElement("ul");
          ul.className = "group-members";
          ul.style.display = group.membersCollapsed ? "none" : "";
          membersToggle.addEventListener("click", () => {
            group.membersCollapsed = !group.membersCollapsed;
            ul.style.display = group.membersCollapsed ? "none" : "";
            membersToggle.querySelector(".group-members-arrow").textContent = group.membersCollapsed ? "▶" : "▼";
          });
          for (const m of group.members) {
            const memberTrackId = `gmember_${group.id}_${m.key}`;
            const isSelected = selectedTrackIds.has(memberTrackId);
            const shortName = m.name.replace(/\s*\(.*\)$/, '');
            const curOpacity = m.fillOpacity ?? group.fillOpacity;

            const li = document.createElement("li");
            li.className = 'group-member-item' + (isSelected ? ' group-member-selected' : '');
            li.dataset.groupId = group.id;
            li.dataset.memberKey = m.key;

            // ── Header row ──────────────────────────────────────────────────
            const row = document.createElement("div");
            row.className = "group-member-row";

            const label = document.createElement("span");
            label.className = "group-member-name";
            label.textContent = shortName;
            label.title = m.name;

            const badge = document.createElement("span");
            badge.className = "group-member-badge";
            badge.textContent = Math.round(curOpacity * 100) + '%';

            const rmBtn = document.createElement("button");
            rmBtn.className = "hl-remove";
            rmBtn.textContent = "×";
            rmBtn.addEventListener("click", (e) => { e.stopPropagation(); removeMemberFromGroup(group.id, m.key); });

            row.append(label, badge, rmBtn);

            // Toggle selection on click
            row.addEventListener("click", () => {
              if (selectedTrackIds.has(memberTrackId)) selectedTrackIds.delete(memberTrackId);
              else selectedTrackIds.add(memberTrackId);
              tlBuildLabels();
              renderGroupList();
            });

            li.appendChild(row);

            // ── Expanded controls (shown when selected) ──────────────────
            if (isSelected) {
              const ctrl = document.createElement("div");
              ctrl.className = "group-member-ctrl";

              const opacityLabel = document.createElement("span");
              opacityLabel.className = "hl-ctrl-label";
              opacityLabel.textContent = "Fill";

              const slider = document.createElement("input");
              slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.step = "5";
              slider.value = String(Math.round(curOpacity * 100));
              slider.className = "hl-ctrl-slider";

              const pct = document.createElement("span");
              pct.className = "hl-ctrl-pct";
              pct.textContent = Math.round(curOpacity * 100) + "%";

              slider.addEventListener("input", (e) => {
                const opacity = parseInt(e.target.value) / 100;
                pct.textContent = e.target.value + "%";
                badge.textContent = e.target.value + "%";
                m.fillOpacity = opacity;
                if (!group.invert && m.fillRef && (m.fillEntities?.length ?? 0) > 0) {
                  m.fillRef.color   = group.color;
                  m.fillRef.opacity = opacity;
                } else {
                  // Entities don't exist yet (was 0) — create just this member's
                  (m.fillEntities || []).forEach(removeFillItem);
                  m.fillEntities = [];
                  if (!group.invert && opacity > 0) {
                    const entry = regionLookup.get(m.name);
                    const polygons = entry?.polygons || [];
                    if (!m.fillRef) m.fillRef = { color: group.color, opacity };
                    m.fillRef.color   = group.color;
                    m.fillRef.opacity = opacity;
                    if (polygons.length > 0) {
                      m.fillEntities = makeFillEntities(polygons, group.color, opacity, false, m.fillRef);
                      m.fillEntities.forEach(item => { item.show = group.visible !== false; });
                    }
                  }
                }
              });

              const inheritBtn = document.createElement("button");
              inheritBtn.className = "hl-toggle" + (m.fillOpacity == null ? " hl-toggle-active" : "");
              inheritBtn.textContent = "inherit";
              inheritBtn.title = "Reset to group fill opacity";
              inheritBtn.addEventListener("click", () => {
                m.fillOpacity = null;
                if (m.fillRef) { m.fillRef.color = group.color; m.fillRef.opacity = group.fillOpacity; }
                renderGroupList();
              });

              ctrl.append(opacityLabel, slider, pct, inheritBtn);
              li.appendChild(ctrl);
            }

            ul.appendChild(li);
          }
          body.appendChild(ul);

          card.appendChild(body);
          container.appendChild(card);
        }
      }

      document.getElementById("addGroupBtn").addEventListener("click", () => {
        const input = document.getElementById("groupNameInput");
        const name = input.value.trim();
        if (!name) return;
        createGroup(name);
        input.value = "";
      });

      document.getElementById("groupNameInput").addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        const name = e.target.value.trim();
        if (!name) return;
        createGroup(name);
        e.target.value = "";
      });

      // ── Cities ──────────────────────────────────────────────────────────────
      let cityData    = [];  // [{name, country, lat, lon}]
      let cityMarkers = [];  // [{id, name, country, lat, lon, color, dotSize, showLabel, entity}]
      let nextCityId  = 1;

      let kmlOverlays = []; // { id, name, fileBase64, mimeType, dataSource, visible }
      let nextKmlId   = 1;

      // ── Annotations ─────────────────────────────────────────────────────────
      let annotations      = [];
      let nextAnnotationId = 1;

      const ANCHOR_POSITIONS = [
        'top-left','top-center','top-right',
        'center-left','center','center-right',
        'bottom-left','bottom-center','bottom-right',
      ];
      const ANCHOR_LABELS = ['↖','↑','↗','←','·','→','↙','↓','↘'];

      const ANN_PRESETS = {
        'lower-third': {
          text: 'Lower Third Title', type: 'screen', anchor: 'bottom-left',
          offsetX: 40, offsetY: -70, fontSize: 24, fontWeight: 'bold',
          color: '#ffffff', bgColor: '#000000', bgOpacity: 0.72, padding: 12, borderRadius: 4,
        },
        'title': {
          text: 'Title', type: 'screen', anchor: 'center',
          offsetX: 0, offsetY: -80, fontSize: 54, fontWeight: 'bold',
          color: '#ffffff', bgColor: '#000000', bgOpacity: 0, padding: 0, borderRadius: 0,
        },
        'callout': {
          text: 'Location', type: 'globe', lat: 48.85, lon: 2.35,
          floatDir: 'NE', floatKm: 400, lineEnd: 'arrow', lineStyle: 'solid', showDot: true, dotSize: 8,
          fontSize: 15, fontWeight: 'bold',
          color: '#ffffff', bgColor: '#000000', bgOpacity: 0.75, padding: 8, borderRadius: 10,
        },
        'caption': {
          text: 'Source: …', type: 'screen', anchor: 'bottom-center',
          offsetX: 0, offsetY: -12, fontSize: 13, fontWeight: 'normal',
          color: '#bbbbbb', bgColor: '#000000', bgOpacity: 0, padding: 0, borderRadius: 0,
        },
        'chapter': {
          text: 'Chapter', type: 'screen', anchor: 'top-center',
          offsetX: 0, offsetY: 18, fontSize: 34, fontWeight: 'bold',
          color: '#ffffff', bgColor: '#0d1b2a', bgOpacity: 0.88, padding: 16, borderRadius: 6,
        },
      };

      function annAnchorStyle(anchor, ox, oy) {
        const M = 20, s = {};
        const parts = anchor.split('-');
        if (parts.includes('top'))    s.top    = (M + oy) + 'px';
        if (parts.includes('bottom')) s.bottom = (M - oy) + 'px';
        if (parts.includes('left'))   s.left   = (M + ox) + 'px';
        if (parts.includes('right'))  s.right  = (M - ox) + 'px';
        if (anchor === 'top-center' || anchor === 'bottom-center') {
          s.left = '50%'; s.transform = `translateX(calc(-50% + ${ox}px))`;
        }
        if (anchor === 'center-left' || anchor === 'center-right') {
          s.top = '50%'; s.transform = `translateY(calc(-50% + ${oy}px))`;
        }
        if (anchor === 'center') {
          s.left = '50%'; s.top = '50%';
          s.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`;
        }
        return s;
      }

      function hexToRgb01(hex) {
        const h = (hex||'#000000').replace('#','');
        return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
      }

      function buildAnnotationEl(ann) {
        if (ann.el) ann.el.remove();
        const el = document.createElement('div');
        el.className = 'ann-overlay';
        el.dataset.annId = ann.id;
        const pos = annAnchorStyle(ann.anchor||'bottom-left', ann.offsetX||0, ann.offsetY||0);
        Object.assign(el.style, pos);
        el.style.fontSize   = (ann.fontSize||24) + 'px';
        el.style.fontWeight = ann.fontWeight || 'bold';
        el.style.fontFamily = ann.fontFamily || 'Arial, sans-serif';
        el.style.color      = ann.color || '#ffffff';
        const bgOp = ann.bgOpacity ?? 0;
        if (bgOp > 0) {
          const [r,g,b] = hexToRgb01(ann.bgColor || '#000000');
          el.style.background   = `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${bgOp})`;
          el.style.padding      = (ann.padding||10) + 'px';
          el.style.borderRadius = (ann.borderRadius||4) + 'px';
        } else {
          el.style.textShadow = '0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)';
        }
        el.style.opacity  = ann.opacity ?? 1;
        el.textContent    = ann.text || '';
        document.getElementById('annOverlayRoot').appendChild(el);
        ann.el = el;
      }

      const FLOAT_DIR_ANGLES = { N:0, NE:45, E:90, SE:135, S:180, SW:225, W:270, NW:315 };
      const FLOAT_DIR_HORIZ  = { N:'CENTER', NE:'LEFT',  E:'LEFT',  SE:'LEFT',  S:'CENTER', SW:'RIGHT', W:'RIGHT', NW:'RIGHT' };
      const FLOAT_DIR_VERT   = { N:'BOTTOM', NE:'BOTTOM',E:'CENTER',SE:'TOP',   S:'TOP',    SW:'TOP',   W:'CENTER',NW:'BOTTOM' };

      function computeCalloutOffset(lat, lon, dirStr, floatKm) {
        const dirRad = Cesium.Math.toRadians(FLOAT_DIR_ANGLES[dirStr] ?? 45);
        const dist   = (floatKm ?? 300) / 6371;
        const latRad = Cesium.Math.toRadians(lat);
        return {
          lat: lat + Cesium.Math.toDegrees(dist * Math.cos(dirRad)),
          lon: lon + Cesium.Math.toDegrees(dist * Math.sin(dirRad) / Math.cos(latRad)),
        };
      }

      function buildAnnotationGlobeEntity(ann) {
        if (ann.entity) {
          (Array.isArray(ann.entity) ? ann.entity : [ann.entity]).forEach(e => viewer.entities.remove(e));
          ann.entity = null;
        }
        if (ann.lat == null || ann.lon == null) return;

        const [cr,cg,cb]   = hexToRgb01(ann.color   || '#ffffff');
        const [br,bg_b,bb] = hexToRgb01(ann.bgColor || '#000000');
        const bgOp      = ann.bgOpacity ?? 0.7;
        const op        = ann.opacity   ?? 1;
        const lineEnd   = ann.lineEnd   ?? 'arrow';
        const lineStyle = ann.lineStyle ?? 'solid';
        const floatDir  = ann.floatDir  ?? 'NE';
        const showDot   = ann.showDot   ?? true;
        const ALT       = 5000; // m — above most terrain, keeps line visible

        const offset    = computeCalloutOffset(ann.lat, ann.lon, floatDir, ann.floatKm ?? 300);
        const anchorPos = Cesium.Cartesian3.fromDegrees(ann.lon,    ann.lat,    ALT);
        const labelPos  = Cesium.Cartesian3.fromDegrees(offset.lon, offset.lat, ALT);

        const entities = [];

        // ① Label at offset position
        entities.push(viewer.entities.add({
          position: labelPos,
          label: {
            text:             ann.text || '',
            font:             `${ann.fontWeight||'bold'} ${ann.fontSize||15}px ${ann.fontFamily||'Arial'}`,
            fillColor:        new Cesium.Color(cr, cg, cb, op),
            showBackground:   bgOp > 0,
            backgroundColor:  new Cesium.Color(br, bg_b, bb, bgOp * op),
            backgroundPadding:new Cesium.Cartesian2(ann.padding||6, Math.ceil((ann.padding||6)*0.6)),
            horizontalOrigin: Cesium.HorizontalOrigin[FLOAT_DIR_HORIZ[floatDir] || 'CENTER'],
            verticalOrigin:   Cesium.VerticalOrigin[FLOAT_DIR_VERT[floatDir]   || 'BOTTOM'],
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            style: Cesium.LabelStyle.FILL,
          },
        }));

        // ② Leader line / arrow
        if (lineEnd !== 'none') {
          const lineWidth = lineEnd === 'arrow' ? 14 : (ann.lineWidth ?? 2);
          let material;
          if (lineEnd === 'arrow') {
            material = new Cesium.PolylineArrowMaterialProperty(
              new Cesium.CallbackProperty(() => new Cesium.Color(cr, cg, cb, (ann.opacity??1) * 0.9), false)
            );
          } else if (lineStyle === 'dashed') {
            material = new Cesium.PolylineDashMaterialProperty({
              color: new Cesium.CallbackProperty(() => new Cesium.Color(cr, cg, cb, (ann.opacity??1) * 0.85), false),
              dashLength: 16,
            });
          } else {
            material = new Cesium.ColorMaterialProperty(
              new Cesium.CallbackProperty(() => new Cesium.Color(cr, cg, cb, (ann.opacity??1) * 0.85), false)
            );
          }
          const arrowDir = ann.arrowDir ?? 'out'; // 'out' = anchor→label, 'in' = label→anchor
          entities.push(viewer.entities.add({
            polyline: {
              positions: arrowDir === 'in' ? [labelPos, anchorPos] : [anchorPos, labelPos],
              width: lineWidth,
              material,
              arcType: Cesium.ArcType.NONE,
              clampToGround: false,
            },
          }));
        }

        // ③ Anchor dot at precise point
        if (showDot) {
          entities.push(viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(ann.lon, ann.lat, ALT),
            point: {
              pixelSize: ann.dotSize ?? 8,
              color: new Cesium.CallbackProperty(() => new Cesium.Color(cr, cg, cb, ann.opacity ?? 1), false),
              outlineColor: new Cesium.Color(0, 0, 0, 0.7),
              outlineWidth: 1.5,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }));
        }

        ann.entity = entities;
      }

      function applyAnnotationOpacity(ann) {
        const op = ann.opacity ?? 1;
        if (ann.type === 'screen' && ann.el) {
          ann.el.style.opacity = op;
          return;
        }
        if (ann.type === 'globe' && ann.entity?.length) {
          // Label (entity[0]) uses static Cesium.Color — must be updated explicitly
          const [cr,cg,cb]   = hexToRgb01(ann.color   || '#ffffff');
          const [br,bg_b,bb] = hexToRgb01(ann.bgColor || '#000000');
          const bgOp = ann.bgOpacity ?? 0.7;
          const lbl = ann.entity[0];
          if (lbl?.label) {
            lbl.label.fillColor       = new Cesium.Color(cr, cg, cb, op);
            lbl.label.backgroundColor = new Cesium.Color(br, bg_b, bb, bgOp * op);
          }
          // Polyline and dot use CallbackProperty reading ann.opacity — update automatically
        }
      }

      function rebuildAnnotation(ann) {
        if (ann.type === 'screen') {
          if (ann.entity) {
            (Array.isArray(ann.entity) ? ann.entity : [ann.entity]).forEach(e => viewer.entities.remove(e));
            ann.entity = null;
          }
          buildAnnotationEl(ann);
        } else {
          if (ann.el) { ann.el.remove(); ann.el = null; }
          buildAnnotationGlobeEntity(ann);
        }
        if (tracks['ann_'+ann.id]) {
          const t = ann.text || '';
          tracks['ann_'+ann.id].label = t.length > 20 ? t.slice(0,20)+'…' : t;
        }
      }

      function createAnnotation(fields) {
        const ann = Object.assign({
          id: nextAnnotationId++, text: 'Annotation', type: 'screen',
          anchor: 'bottom-left', offsetX: 40, offsetY: -70,
          lat: null, lon: null, fontFamily: 'Arial',
          floatDir: 'NE', floatKm: 300, lineEnd: 'arrow', lineStyle: 'solid',
          lineWidth: 2, showDot: true, dotSize: 8,
          fontSize: 24, fontWeight: 'bold', color: '#ffffff',
          bgColor: '#000000', bgOpacity: 0.72, padding: 12, borderRadius: 4,
          opacity: 1, el: null, entity: null,
        }, fields);
        annotations.push(ann);
        const lbl = ann.text.length > 20 ? ann.text.slice(0,20)+'…' : ann.text;
        tracks['ann_'+ann.id] = { id:'ann_'+ann.id, label:lbl, category:'annotation', color:'#f0a050', h:22, keyframes:[] };
        if (ann.type === 'screen') buildAnnotationEl(ann);
        else buildAnnotationGlobeEntity(ann);
        renderAnnotationList();
        tlBuildLabels();
        return ann;
      }

      function deleteAnnotation(id) {
        const idx = annotations.findIndex(a => a.id === id);
        if (idx === -1) return;
        const ann = annotations[idx];
        if (ann.el) ann.el.remove();
        if (ann.entity) (Array.isArray(ann.entity)?ann.entity:[ann.entity]).forEach(e=>viewer.entities.remove(e));
        delete tracks['ann_'+id];
        annotations.splice(idx, 1);
        renderAnnotationList();
        tlBuildLabels();
      }

      // ── Shared font list ───────────────────────────────────────────────────
      const FONT_LIST = [
        // System
        { label: 'Arial',           value: 'Arial' },
        { label: 'Helvetica',       value: 'Helvetica' },
        { label: 'Verdana',         value: 'Verdana' },
        { label: 'Georgia',         value: 'Georgia' },
        { label: 'Times New Roman', value: 'Times New Roman' },
        { label: 'Courier',         value: 'Courier' },
        // Google – clean / modern
        { label: 'Roboto',          value: 'Roboto' },
        { label: 'Montserrat',      value: 'Montserrat' },
        { label: 'Oswald',          value: 'Oswald' },
        { label: 'Raleway',         value: 'Raleway' },
        { label: 'Nunito',          value: 'Nunito' },
        { label: 'Ubuntu',          value: 'Ubuntu' },
        { label: 'Exo 2',           value: 'Exo 2' },
        // Google – editorial / serif
        { label: 'Playfair Display',value: 'Playfair Display' },
        { label: 'Merriweather',    value: 'Merriweather' },
        { label: 'Lora',            value: 'Lora' },
        { label: 'Cinzel',          value: 'Cinzel' },
        // Google – bold / display
        { label: 'Bebas Neue',      value: 'Bebas Neue' },
        { label: 'Anton',           value: 'Anton' },
        { label: 'Teko',            value: 'Teko' },
        { label: 'Black Han Sans',  value: 'Black Han Sans' },
        // Google – mono
        { label: 'Roboto Mono',     value: 'Roboto Mono' },
        { label: 'Space Mono',      value: 'Space Mono' },
      ];

      // Close all open font picker panels
      document.addEventListener('click', () => {
        document.querySelectorAll('.font-picker-panel.open').forEach(p => p.classList.remove('open'));
      });

      function makeFontSelect(currentValue, cssText, onChange) {
        return makeFontPicker(currentValue, onChange);
      }

      function makeFontPicker(currentValue, onChange) {
        const cur = FONT_LIST.find(f => f.value === currentValue) || FONT_LIST[0];

        const container = document.createElement('div');
        container.className = 'font-picker';

        const btn = document.createElement('button');
        btn.className = 'font-picker-btn';
        btn.type = 'button';
        btn.textContent = cur.label;
        btn.style.fontFamily = cur.value;

        const panel = document.createElement('div');
        panel.className = 'font-picker-panel';

        FONT_LIST.forEach(({ label, value }) => {
          const opt = document.createElement('div');
          opt.className = 'font-picker-option' + (value === cur.value ? ' fp-active' : '');
          opt.style.fontFamily = value;
          opt.textContent = label;
          opt.addEventListener('click', e => {
            e.stopPropagation();
            panel.querySelectorAll('.font-picker-option').forEach(o => o.classList.toggle('fp-active', o === opt));
            btn.textContent = label;
            btn.style.fontFamily = value;
            panel.classList.remove('open');
            onChange(value);
          });
          panel.appendChild(opt);
        });

        btn.addEventListener('click', e => {
          e.stopPropagation();
          const isOpen = panel.classList.contains('open');
          // Close all others
          document.querySelectorAll('.font-picker-panel.open').forEach(p => p.classList.remove('open'));
          if (!isOpen) {
            const rect = btn.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            const panelH = Math.min(700, FONT_LIST.length * 28);
            if (spaceBelow < panelH && rect.top > panelH) {
              panel.style.top  = (rect.top - panelH) + 'px';
            } else {
              panel.style.top  = rect.bottom + 'px';
            }
            panel.style.left  = rect.left + 'px';
            panel.style.width = Math.max(rect.width, 160) + 'px';
            panel.classList.add('open');
            // Scroll active option into view
            const active = panel.querySelector('.fp-active');
            if (active) active.scrollIntoView({ block: 'nearest' });
          }
        });

        container.appendChild(btn);
        document.body.appendChild(panel); // fixed-position, not clipped by overflow:hidden

        // Clean up panel when container is removed from DOM
        const observer = new MutationObserver(() => {
          if (!document.body.contains(container)) {
            panel.remove();
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        return container;
      }

      function renderAnnotationList() {
        const list = document.getElementById('annotationList');
        if (!list) return;
        if (!annotations.length) {
          list.innerHTML = '<div style="font-size:11px;color:#aaa;text-align:center;padding:8px 0;">Use a preset above or + Add to create an annotation.</div>';
          return;
        }
        list.innerHTML = '';
        annotations.forEach(ann => {
          const hasKf = (tracks['ann_'+ann.id]?.keyframes.length ?? 0) > 0;
          const card = document.createElement('div');
          card.className = 'ann-card';
          card.innerHTML = `
            <div class="ann-card-header">
              <span class="ann-card-title" title="${ann.text}">${ann.text||'(no text)'}</span>
              <button class="ann-icon-btn" data-vis="${ann.id}" title="${ann.opacity>0?'Hide':'Show'}">${ann.opacity>0?'👁':'🙈'}</button>
              <button class="ann-icon-btn" data-del="${ann.id}" style="color:#b00;" title="Delete">×</button>
            </div>
            <div class="ann-card-body">
              <textarea class="ann-textarea" data-text="${ann.id}" rows="2">${ann.text||''}</textarea>
              <div class="ann-row">
                <span class="ann-label">Type</span>
                <button class="ann-type-btn ${ann.type==='screen'?'active':''}" data-type-screen="${ann.id}">Screen</button>
                <button class="ann-type-btn ${ann.type==='globe'?'active':''}" data-type-globe="${ann.id}">Globe</button>
              </div>
              ${ann.type==='screen' ? `
              <div class="ann-row" style="align-items:flex-start;">
                <span class="ann-label" style="padding-top:3px;">Position</span>
                <div class="ann-anchor-grid" style="flex:1;">
                  ${ANCHOR_POSITIONS.map((p,i)=>`<button class="ann-anchor-cell${ann.anchor===p?' active':''}" data-anchor="${ann.id}:${p}" title="${p}">${ANCHOR_LABELS[i]}</button>`).join('')}
                </div>
                <div style="display:flex;flex-direction:column;gap:3px;margin-left:5px;">
                  <input type="number" value="${ann.offsetX||0}" data-ox="${ann.id}" placeholder="X" style="width:36px;font-size:10px;padding:1px 3px;border:1px solid #ccc;border-radius:3px;margin:0;text-align:center;" />
                  <input type="number" value="${ann.offsetY||0}" data-oy="${ann.id}" placeholder="Y" style="width:36px;font-size:10px;padding:1px 3px;border:1px solid #ccc;border-radius:3px;margin:0;text-align:center;" />
                </div>
              </div>` : `
              <div class="ann-row">
                <span class="ann-label">Lat / Lon</span>
                <input type="number" value="${ann.lat??0}" data-lat="${ann.id}" step="0.1" style="width:58px;font-size:10px;padding:1px 3px;border:1px solid #ccc;border-radius:3px;margin:0;" />
                <input type="number" value="${ann.lon??0}" data-lon="${ann.id}" step="0.1" style="width:58px;font-size:10px;padding:1px 3px;border:1px solid #ccc;border-radius:3px;margin:0;" />
              </div>
              <div class="ann-row" style="align-items:flex-start;">
                <span class="ann-label" style="padding-top:3px;">Direction</span>
                <div class="ann-anchor-grid" style="flex:1;">
                  ${['NW','N','NE','W',null,'E','SW','S','SE'].map((d,i) =>
                    d === null
                      ? `<div style="display:flex;align-items:center;justify-content:center;font-size:11px;color:#bbb;pointer-events:none;">●</div>`
                      : `<button class="ann-anchor-cell${(ann.floatDir??'NE')===d?' active':''}" data-floatdir="${ann.id}:${d}">${d}</button>`
                  ).join('')}
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;margin-left:5px;align-items:center;">
                  <span style="font-size:9px;color:#888;line-height:1;">km</span>
                  <input type="number" value="${ann.floatKm??300}" data-floatkm="${ann.id}" min="10" max="5000" step="50"
                    style="width:42px;font-size:10px;padding:1px 3px;border:1px solid #ccc;border-radius:3px;margin:0;text-align:center;" />
                </div>
              </div>
              <div class="ann-row">
                <span class="ann-label">Line</span>
                <button class="ann-type-btn${(ann.lineEnd??'arrow')==='arrow'?' active':''}" data-lineend="${ann.id}:arrow">→ Arrow</button>
                <button class="ann-type-btn${(ann.lineEnd??'arrow')==='line'?' active':''}" data-lineend="${ann.id}:line">— Line</button>
                <button class="ann-type-btn${(ann.lineEnd??'arrow')==='none'?' active':''}" data-lineend="${ann.id}:none">None</button>
              </div>
              ${(ann.lineEnd??'arrow')==='arrow' ? `
              <div class="ann-row">
                <span class="ann-label">Points</span>
                <button class="ann-type-btn${(ann.arrowDir??'out')==='out'?' active':''}" data-arrowdir="${ann.id}:out">→ To label</button>
                <button class="ann-type-btn${(ann.arrowDir??'out')==='in'?' active':''}" data-arrowdir="${ann.id}:in">← To map</button>
              </div>` : ''}
              ${(ann.lineEnd??'arrow')==='line' ? `
              <div class="ann-row">
                <span class="ann-label">Style</span>
                <button class="ann-type-btn${(ann.lineStyle??'solid')==='solid'?' active':''}" data-linestyle="${ann.id}:solid">Solid</button>
                <button class="ann-type-btn${(ann.lineStyle??'solid')==='dashed'?' active':''}" data-linestyle="${ann.id}:dashed">Dashed</button>
              </div>` : ''}
              <div class="ann-row">
                <span class="ann-label">Dot</span>
                <label style="margin:0;font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;">
                  <input type="checkbox" ${(ann.showDot??true)?'checked':''} data-showdot="${ann.id}" style="margin:0;"/>
                  Anchor dot
                </label>
                ${(ann.showDot??true) ? `<input type="number" value="${ann.dotSize??8}" data-dotsize="${ann.id}" min="3" max="24"
                  style="width:34px;font-size:10px;padding:1px 3px;border:1px solid #ccc;border-radius:3px;margin:0;text-align:center;" title="Dot size (px)" />` : ''}
              </div>`}
              <div class="ann-row">
                <span class="ann-label">Font</span>
                <input type="number" value="${ann.fontSize||24}" data-fontsize="${ann.id}" min="8" max="120"
                  style="width:38px;font-size:10px;padding:1px 3px;border:1px solid #ccc;border-radius:3px;margin:0;text-align:center;" />
                <select data-fontweight="${ann.id}" style="font-size:10px;padding:1px 2px;border:1px solid #ccc;border-radius:3px;height:auto;margin:0;">
                  <option value="normal" ${ann.fontWeight==='normal'?'selected':''}>Regular</option>
                  <option value="bold" ${ann.fontWeight==='bold'?'selected':''}>Bold</option>
                </select>
              </div>
              <div class="ann-row">
                <span class="ann-label">Typeface</span>
                <span data-fontfamily-ann="${ann.id}" style="flex:1;"></span>
              </div>
              <div class="ann-row">
                <span class="ann-label">Color</span>
                <input type="color" value="${ann.color||'#ffffff'}" data-color="${ann.id}"
                  style="width:28px;height:20px;padding:1px;border:1px solid #ccc;border-radius:3px;cursor:pointer;margin:0;" />
                <span style="font-size:10px;color:#888;margin-left:4px;">Bg</span>
                <input type="color" value="${ann.bgColor||'#000000'}" data-bgcolor="${ann.id}"
                  style="width:28px;height:20px;padding:1px;border:1px solid #ccc;border-radius:3px;cursor:pointer;margin:0;" />
                <input type="range" min="0" max="100" value="${Math.round((ann.bgOpacity??0)*100)}" data-bgop="${ann.id}"
                  style="flex:1;margin:0;height:3px;" />
                <span data-bgop-val="${ann.id}" style="font-size:10px;color:#888;width:24px;text-align:right;">${Math.round((ann.bgOpacity??0)*100)}%</span>
              </div>
              <div class="ann-row">
                <span class="ann-label">Opacity</span>
                <input type="range" min="0" max="100" value="${Math.round((ann.opacity??1)*100)}" data-annop="${ann.id}"
                  style="flex:1;margin:0;height:3px;" ${hasKf?'title="Controlled by keyframes" style="flex:1;margin:0;height:3px;opacity:0.4;"':''} />
                <span data-annop-val="${ann.id}" style="font-size:10px;color:#888;width:24px;text-align:right;">${Math.round((ann.opacity??1)*100)}%</span>
              </div>
            </div>`;
          list.appendChild(card);
        });

        // Wire events (delegated pattern)
        list.querySelectorAll('[data-text]').forEach(el => el.addEventListener('input', () => {
          const ann = annotations.find(a=>a.id===+el.dataset.text); if(!ann) return;
          ann.text = el.value;
          el.closest('.ann-card').querySelector('.ann-card-title').textContent = ann.text||'(no text)';
          if(tracks['ann_'+ann.id]) tracks['ann_'+ann.id].label = (ann.text||'').slice(0,20)+(ann.text.length>20?'…':'');
          if(ann.type==='screen'&&ann.el) ann.el.textContent=ann.text;
          else if(ann.entity?.[0]?.label) ann.entity[0].label.text=ann.text;
          tlBuildLabels();
        }));
        list.querySelectorAll('[data-vis]').forEach(btn => btn.addEventListener('click', () => {
          const ann = annotations.find(a=>a.id===+btn.dataset.vis); if(!ann) return;
          ann.opacity = ann.opacity>0 ? 0 : 1;
          applyAnnotationOpacity(ann); renderAnnotationList();
        }));
        list.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => deleteAnnotation(+btn.dataset.del)));
        list.querySelectorAll('[data-type-screen]').forEach(btn => btn.addEventListener('click', () => {
          const ann = annotations.find(a=>a.id===+btn.dataset.typeScreen); if(!ann||ann.type==='screen') return;
          ann.type='screen'; ann.anchor=ann.anchor||'bottom-left'; rebuildAnnotation(ann); renderAnnotationList();
        }));
        list.querySelectorAll('[data-type-globe]').forEach(btn => btn.addEventListener('click', () => {
          const ann = annotations.find(a=>a.id===+btn.dataset.typeGlobe); if(!ann||ann.type==='globe') return;
          ann.type='globe'; ann.lat=ann.lat??0; ann.lon=ann.lon??0; rebuildAnnotation(ann); renderAnnotationList();
        }));
        list.querySelectorAll('[data-anchor]').forEach(btn => btn.addEventListener('click', () => {
          const [idStr,pos] = btn.dataset.anchor.split(':');
          const ann = annotations.find(a=>a.id===+idStr); if(!ann) return;
          ann.anchor=pos; rebuildAnnotation(ann); renderAnnotationList();
        }));
        const numField = (attr, prop, rebuild=true) => list.querySelectorAll(`[data-${attr}]`).forEach(el => el.addEventListener('change', () => {
          const ann = annotations.find(a=>a.id===+el.dataset[attr.replace(/-./g,m=>m[1].toUpperCase())]); if(!ann) return;
          ann[prop]=+el.value; if(rebuild) rebuildAnnotation(ann);
        }));
        numField('ox',      'offsetX');
        numField('oy',      'offsetY');
        numField('lat',     'lat');
        numField('lon',     'lon');
        numField('fontsize','fontSize');
        list.querySelectorAll('[data-leader]').forEach(el => el.addEventListener('change', () => {
          const ann = annotations.find(a=>a.id===+el.dataset.leader); if(!ann) return;
          ann.leaderLine=el.checked; rebuildAnnotation(ann);
        }));
        list.querySelectorAll('[data-floatdir]').forEach(btn => btn.addEventListener('click', () => {
          const [idStr,dir] = btn.dataset.floatdir.split(':');
          const ann = annotations.find(a=>a.id===+idStr); if(!ann) return;
          ann.floatDir=dir; rebuildAnnotation(ann); renderAnnotationList();
        }));
        list.querySelectorAll('[data-floatkm]').forEach(el => el.addEventListener('change', () => {
          const ann = annotations.find(a=>a.id===+el.dataset.floatkm); if(!ann) return;
          ann.floatKm=+el.value; rebuildAnnotation(ann);
        }));
        list.querySelectorAll('[data-lineend]').forEach(btn => btn.addEventListener('click', () => {
          const [idStr,val] = btn.dataset.lineend.split(':');
          const ann = annotations.find(a=>a.id===+idStr); if(!ann) return;
          ann.lineEnd=val; rebuildAnnotation(ann); renderAnnotationList();
        }));
        list.querySelectorAll('[data-arrowdir]').forEach(btn => btn.addEventListener('click', () => {
          const [idStr,val] = btn.dataset.arrowdir.split(':');
          const ann = annotations.find(a=>a.id===+idStr); if(!ann) return;
          ann.arrowDir=val; rebuildAnnotation(ann); renderAnnotationList();
        }));
        list.querySelectorAll('[data-linestyle]').forEach(btn => btn.addEventListener('click', () => {
          const [idStr,val] = btn.dataset.linestyle.split(':');
          const ann = annotations.find(a=>a.id===+idStr); if(!ann) return;
          ann.lineStyle=val; rebuildAnnotation(ann); renderAnnotationList();
        }));
        list.querySelectorAll('[data-showdot]').forEach(el => el.addEventListener('change', () => {
          const ann = annotations.find(a=>a.id===+el.dataset.showdot); if(!ann) return;
          ann.showDot=el.checked; rebuildAnnotation(ann); renderAnnotationList();
        }));
        list.querySelectorAll('[data-dotsize]').forEach(el => el.addEventListener('change', () => {
          const ann = annotations.find(a=>a.id===+el.dataset.dotsize); if(!ann) return;
          ann.dotSize=+el.value; rebuildAnnotation(ann);
        }));
        list.querySelectorAll('[data-fontweight]').forEach(el => el.addEventListener('change', () => {
          const ann = annotations.find(a=>a.id===+el.dataset.fontweight); if(!ann) return;
          ann.fontWeight=el.value; rebuildAnnotation(ann);
        }));
        list.querySelectorAll('[data-color]').forEach(el => el.addEventListener('input', () => {
          const ann = annotations.find(a=>a.id===+el.dataset.color); if(!ann) return;
          ann.color=el.value; rebuildAnnotation(ann);
        }));
        list.querySelectorAll('[data-bgcolor]').forEach(el => el.addEventListener('input', () => {
          const ann = annotations.find(a=>a.id===+el.dataset.bgcolor); if(!ann) return;
          ann.bgColor=el.value; rebuildAnnotation(ann);
        }));
        list.querySelectorAll('[data-bgop]').forEach(el => el.addEventListener('input', () => {
          const ann = annotations.find(a=>a.id===+el.dataset.bgop); if(!ann) return;
          ann.bgOpacity=+el.value/100;
          el.closest('.ann-card').querySelector(`[data-bgop-val="${ann.id}"]`).textContent=el.value+'%';
          rebuildAnnotation(ann);
        }));
        list.querySelectorAll('[data-annop]').forEach(el => el.addEventListener('input', () => {
          const ann = annotations.find(a=>a.id===+el.dataset.annop); if(!ann) return;
          ann.opacity=+el.value/100;
          el.closest('.ann-card').querySelector(`[data-annop-val="${ann.id}"]`).textContent=el.value+'%';
          applyAnnotationOpacity(ann);
        }));
        list.querySelectorAll('[data-fontfamily-ann]').forEach(span => {
          const ann = annotations.find(a=>a.id===+span.dataset.fontfamilyAnn); if(!ann) return;
          const sel = makeFontSelect(ann.fontFamily||'Arial', 'flex:1;font-size:10px;', val => {
            ann.fontFamily = val; rebuildAnnotation(ann);
          });
          span.appendChild(sel);
        });
      }

      let cityStyleClipboard = null;
      const CITY_STYLE_FIELDS = [
        'color','labelColor','dotSize','showLabel','fontSize','fontWeight','fontStyle','fontFamily',
        'offsetX','offsetY','outlineWidth','showBackground','backgroundColor','backgroundOpacity',
        'bgPadX','bgPadY','dotOpacity','labelOpacity',
      ];

      function copyCityStyle(marker) {
        cityStyleClipboard = {};
        CITY_STYLE_FIELDS.forEach(k => { cityStyleClipboard[k] = marker[k]; });
        document.getElementById('cityClipboardBar').style.display = 'flex';
        renderCityList();
      }

      function applyCityStyleFrom(src, marker) {
        const needRebuild = src.color !== marker.color || Math.round(src.dotSize) !== marker.dotSize;
        CITY_STYLE_FIELDS.forEach(k => { if (src[k] !== undefined) marker[k] = src[k]; });
        if (needRebuild) updateCityEntity(marker);
        else updateCityLabelStyle(marker);
      }

      function pasteCityStyle(marker) {
        if (!cityStyleClipboard) return;
        applyCityStyleFrom(cityStyleClipboard, marker);
        renderCityList();
      }

      function applyStyleToAll() {
        if (!cityStyleClipboard) return;
        cityMarkers.forEach(m => applyCityStyleFrom(cityStyleClipboard, m));
        renderCityList();
      }

      function clearStyleClipboard() {
        cityStyleClipboard = null;
        document.getElementById('cityClipboardBar').style.display = 'none';
        renderCityList();
      }

      async function loadCityData() {
        try {
          const res = await fetch("/data/cities.json");
          cityData = await res.json();
          const dl = document.getElementById("cityDatalist");
          cityData.forEach(c => {
            const opt = document.createElement("option");
            opt.value = `${c.name} (${c.country})`;
            dl.appendChild(opt);
          });
        } catch (e) { console.warn("Could not load cities.json", e); }
      }
      loadCityData();

      function makeCityEntity(c) {
        const pos = Cesium.Cartesian3.fromDegrees(c.lon, c.lat);
        const col = Cesium.Color.fromCssColorString(c.color);
        return viewer.entities.add({
          position: pos,
          point: new Cesium.PointGraphics({
            pixelSize: c.dotSize,
            color: col.withAlpha(c.dotOpacity ?? 1.0),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
          }),
          label: new Cesium.LabelGraphics({
            text: c.name,
            font: `${c.fontStyle === 'italic' ? 'italic ' : ''}${c.fontWeight === 'bold' ? 'bold ' : ''}${c.fontSize ?? 13}px ${c.fontFamily ?? 'Arial'}`,
            fillColor: Cesium.Color.fromCssColorString(c.labelColor ?? c.color).withAlpha(c.labelOpacity ?? 1.0),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: c.outlineWidth ?? 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground:    c.showBackground ?? false,
            backgroundColor:   Cesium.Color.fromCssColorString(c.backgroundColor ?? '#000000').withAlpha(c.backgroundOpacity ?? 0.5),
            backgroundPadding: new Cesium.Cartesian2(c.bgPadX ?? 5, c.bgPadY ?? 3),
            pixelOffset: new Cesium.Cartesian2(c.dotSize / 2 + 4 + (c.offsetX ?? 0), c.offsetY ?? 0),
            horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            show: c.showLabel,
          }),
        });
      }

      function addCityFromData(found) {
        if (cityMarkers.some(m => m.name === found.name && m.country === found.country)) return;
        const marker = {
          id: nextCityId++,
          name: found.name,
          country: found.country,
          lat: found.lat,
          lon: found.lon,
          color: defaultCityColor,
          labelColor: defaultCityColor,
          dotSize: defaultCityDotSize,
          showLabel: true,
          fontSize: 13, fontWeight: 'normal', fontStyle: 'normal', fontFamily: 'Arial',
          offsetX: 0, offsetY: 0, outlineWidth: 2,
          dotOpacity: 1.0, labelOpacity: 1.0,
          showBackground: false, backgroundColor: '#000000', backgroundOpacity: 0.5,
          bgPadX: 5, bgPadY: 3,
        };
        marker.entity = makeCityEntity(marker);
        cityMarkers.push(marker);
        tracks['city_'+marker.id] = { id:'city_'+marker.id, label:marker.name, category:'city',
          color: defaultCityColor, h:22, keyframes:[], collapsed:true };
        selectedTrackIds.add('city_'+marker.id);
        tlBuildLabels();
        renderCityList();
      }

      function addCity(displayStr) {
        // displayStr is "Name (Country)"
        const match = displayStr.match(/^(.+)\s\((.+)\)$/);
        if (match) {
          const [, name, country] = match;
          const found = cityData.find(c => c.name === name && c.country === country);
          if (found) { addCityFromData(found); return true; }
        }
        return false;
      }

      // ── Geocoding fallback (MapTiler) ────────────────────────────────────────
      const geocodePanel = document.getElementById("geocodeResults");

      function hideGeocodeResults() {
        geocodePanel.style.display = "none";
        geocodePanel.innerHTML = "";
      }

      async function geocodeAndShow(query) {
        const url = `/api/geocode?q=${encodeURIComponent(query)}`;
        let features;
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          features = (await res.json()).features || [];
        } catch (e) { return; }

        if (!features.length) {
          geocodePanel.innerHTML = '<div class="geocode-result"><span class="geocode-result-detail">No results found</span></div>';
          geocodePanel.style.display = "block";
          return;
        }

        geocodePanel.innerHTML = "";
        features.forEach(f => {
          const [lon, lat] = f.center || f.geometry?.coordinates || [];
          if (lon == null || lat == null) return;
          // Extract a short name and context string from place_name
          const parts = (f.place_name || f.text || query).split(",");
          const shortName = parts[0].trim();
          const detail = parts.slice(1).join(",").trim();

          const row = document.createElement("div");
          row.className = "geocode-result";
          row.innerHTML = `<div class="geocode-result-name">${shortName}</div>` +
                          (detail ? `<div class="geocode-result-detail">${detail}</div>` : "");
          row.addEventListener("click", () => {
            addCityFromData({ name: shortName, country: detail || "Unknown", lat, lon });
            document.getElementById("citySearch").value = "";
            hideGeocodeResults();
          });
          geocodePanel.appendChild(row);
        });
        geocodePanel.style.display = "block";
      }

      // Close results when clicking outside
      document.addEventListener("click", e => {
        if (!document.getElementById("citySearchRow").contains(e.target)) hideGeocodeResults();
      });

      function removeCity(id) {
        const idx = cityMarkers.findIndex(m => m.id === id);
        if (idx === -1) return;
        viewer.entities.remove(cityMarkers[idx].entity);
        delete tracks['city_' + id];
        selectedTrackIds.delete('city_' + id);
        cityMarkers.splice(idx, 1);
        tlBuildLabels();
        renderCityList();
      }

      function updateCityEntity(marker) {
        viewer.entities.remove(marker.entity);
        marker.entity = makeCityEntity(marker);
      }

      function updateCityLabelStyle(marker) {
        if (!marker.entity) return;
        const dotCol   = Cesium.Color.fromCssColorString(marker.color);
        const labelCol = Cesium.Color.fromCssColorString(marker.labelColor ?? marker.color);
        const dotOpacity   = marker.dotOpacity   ?? 1.0;
        const labelOpacity = marker.labelOpacity ?? 1.0;

        if (marker.entity.point) {
          marker.entity.point.show         = dotOpacity > 0;
          marker.entity.point.color        = dotCol.withAlpha(dotOpacity);
          marker.entity.point.outlineColor = Cesium.Color.BLACK.withAlpha(dotOpacity);
        }
        if (marker.entity.label) {
          const fontStr = `${marker.fontStyle === 'italic' ? 'italic ' : ''}${marker.fontWeight === 'bold' ? 'bold ' : ''}${marker.fontSize}px ${marker.fontFamily}`;
          marker.entity.label.font             = fontStr;
          marker.entity.label.fillColor        = labelCol.withAlpha(labelOpacity);
          marker.entity.label.outlineColor     = Cesium.Color.BLACK.withAlpha(labelOpacity);
          marker.entity.label.outlineWidth     = marker.outlineWidth ?? 2;
          marker.entity.label.showBackground    = marker.showBackground ?? false;
          marker.entity.label.backgroundColor  = Cesium.Color.fromCssColorString(marker.backgroundColor ?? '#000000').withAlpha((marker.backgroundOpacity ?? 0.5) * labelOpacity);
          marker.entity.label.backgroundPadding = new Cesium.Cartesian2(marker.bgPadX ?? 5, marker.bgPadY ?? 3);
          marker.entity.label.pixelOffset      = new Cesium.Cartesian2(marker.dotSize / 2 + 4 + (marker.offsetX ?? 0), marker.offsetY ?? 0);
          // Only control show via opacity when the label is toggled on
          if (marker.showLabel) marker.entity.label.show = labelOpacity > 0;
        }
      }

      function renderCityList() {
        const ul = document.getElementById("cityList");
        ul.innerHTML = "";
        cityMarkers.forEach(marker => {
          const li = document.createElement("li");

          // ── Main row ──────────────────────────────────────────────────────
          const mainRow = document.createElement("div");
          mainRow.className = "city-main-row";

          // Color swatch
          const swatch = document.createElement("div");
          swatch.className = "hl-swatch";
          swatch.style.background = marker.color;
          const colorInput = document.createElement("input");
          colorInput.type = "color";
          colorInput.value = marker.color;
          colorInput.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
          swatch.appendChild(colorInput);
          swatch.addEventListener("click", () => colorInput.click());
          colorInput.addEventListener("input", e => {
            marker.color = e.target.value;
            swatch.style.background = marker.color;
            updateCityLabelStyle(marker);
          });
          mainRow.appendChild(swatch);

          // Dot size input
          const sizeInput = document.createElement("input");
          sizeInput.type = "number";
          sizeInput.min = "2"; sizeInput.max = "30"; sizeInput.step = "1";
          sizeInput.value = String(marker.dotSize);
          sizeInput.title = "Dot size (px)";
          sizeInput.addEventListener("change", e => {
            marker.dotSize = Math.max(2, Math.min(30, parseInt(e.target.value) || 8));
            updateCityEntity(marker);
          });
          mainRow.appendChild(sizeInput);

          // Name
          const nameSpan = document.createElement("span");
          nameSpan.className = "hl-name";
          nameSpan.title = `${marker.name}, ${marker.country}`;
          nameSpan.textContent = marker.name;
          mainRow.appendChild(nameSpan);

          // Label toggle
          const labelBtn = document.createElement("button");
          labelBtn.className = "hl-toggle" + (marker.showLabel ? "" : " hl-toggle-active");
          labelBtn.textContent = marker.showLabel ? "label" : "dot";
          labelBtn.title = "Toggle label visibility";
          labelBtn.addEventListener("click", () => {
            marker.showLabel = !marker.showLabel;
            marker.entity.label.show = marker.showLabel && (marker.labelOpacity ?? 1) > 0;
            labelBtn.className = "hl-toggle" + (marker.showLabel ? "" : " hl-toggle-active");
            labelBtn.textContent = marker.showLabel ? "label" : "dot";
          });
          mainRow.appendChild(labelBtn);

          // Style expand toggle
          const styleToggle = document.createElement("button");
          styleToggle.className = "hl-toggle";
          styleToggle.textContent = "▸";
          styleToggle.title = "Label styling";
          styleToggle.style.cssText = "min-width:20px;padding:1px 4px;font-size:10px;";
          mainRow.appendChild(styleToggle);

          // Paste style (visible only when clipboard is populated)
          if (cityStyleClipboard) {
            const pasteBtn = document.createElement("button");
            pasteBtn.className = "hl-toggle";
            pasteBtn.textContent = "⎘";
            pasteBtn.title = "Paste style from clipboard";
            pasteBtn.style.cssText = "min-width:20px;padding:1px 4px;font-size:11px;color:#4a9eff;";
            pasteBtn.addEventListener("click", () => pasteCityStyle(marker));
            mainRow.appendChild(pasteBtn);
          }

          // Remove
          const rmBtn = document.createElement("button");
          rmBtn.className = "hl-remove";
          rmBtn.textContent = "×";
          rmBtn.addEventListener("click", () => removeCity(marker.id));
          mainRow.appendChild(rmBtn);

          li.appendChild(mainRow);

          // Helper to make a small labeled number input
          const makeNumInput = (min, max, step, val, titleStr, width, onChange) => {
            const el = document.createElement("input");
            el.type = "number";
            el.min = String(min); el.max = String(max); el.step = String(step);
            el.value = String(val);
            el.title = titleStr;
            el.style.cssText = `width:${width}px;font-size:11px;padding:1px 3px;margin:0;text-align:center;`;
            el.addEventListener("change", e => { onChange(e); updateCityLabelStyle(marker); });
            return el;
          };
          const makeLbl = (text, extra) => {
            const s = document.createElement("span");
            s.textContent = text;
            s.style.cssText = `font-size:10px;color:#888;${extra ?? ''}`;
            return s;
          };
          const makeColorSwatch = (getColor, setColor, title) => {
            const swatch = document.createElement("span");
            swatch.title = title;
            swatch.style.cssText = `display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid #666;background:${getColor()};cursor:pointer;flex-shrink:0;`;
            const inp = document.createElement("input");
            inp.type = "color"; inp.value = getColor();
            inp.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
            swatch.appendChild(inp);
            swatch.addEventListener("click", () => inp.click());
            inp.addEventListener("input", e => { setColor(e.target.value); swatch.style.background = e.target.value; updateCityLabelStyle(marker); });
            return swatch;
          };
          const makeToggleBtn = (label, title, isActive, onClick) => {
            const btn = document.createElement("button");
            btn.textContent = label; btn.title = title;
            btn.className = "hl-toggle" + (isActive ? " hl-toggle-active" : "");
            btn.addEventListener("click", () => onClick(btn));
            return btn;
          };

          // ── Row 1: Font ───────────────────────────────────────────────────
          const fontRow = document.createElement("div");
          fontRow.className = "city-style-row";

          fontRow.appendChild(makeColorSwatch(
            () => marker.labelColor ?? marker.color,
            v  => { marker.labelColor = v; },
            "Label text color"
          ));
          fontRow.appendChild(makeLbl("Size"));
          fontRow.appendChild(makeNumInput(8, 100, 1, marker.fontSize, "Font size (px)", 40,
            e => { marker.fontSize = Math.max(8, Math.min(100, parseInt(e.target.value) || 13)); e.target.value = String(marker.fontSize); }
          ));
          const boldBtn = makeToggleBtn("B", "Bold", marker.fontWeight === 'bold', btn => {
            marker.fontWeight = marker.fontWeight === 'bold' ? 'normal' : 'bold';
            btn.className = "hl-toggle" + (marker.fontWeight === 'bold' ? " hl-toggle-active" : "");
            updateCityLabelStyle(marker);
          });
          boldBtn.style.cssText = "font-weight:bold;min-width:24px;";
          fontRow.appendChild(boldBtn);
          const italicBtn = makeToggleBtn("I", "Italic", marker.fontStyle === 'italic', btn => {
            marker.fontStyle = marker.fontStyle === 'italic' ? 'normal' : 'italic';
            btn.className = "hl-toggle" + (marker.fontStyle === 'italic' ? " hl-toggle-active" : "");
            updateCityLabelStyle(marker);
          });
          italicBtn.style.cssText = "font-style:italic;min-width:24px;";
          fontRow.appendChild(italicBtn);
          const fontSelect = makeFontSelect(marker.fontFamily||'Arial', "flex:1;font-size:11px;", val => { marker.fontFamily = val; updateCityLabelStyle(marker); });
          fontRow.appendChild(fontSelect);

          // ── Row 2: Position + halo ────────────────────────────────────────
          const posRow = document.createElement("div");
          posRow.className = "city-style-row";

          posRow.appendChild(makeLbl("X"));
          posRow.appendChild(makeNumInput(-200, 200, 1, marker.offsetX ?? 0, "Label X offset (px)", 42,
            e => { marker.offsetX = parseInt(e.target.value) || 0; }
          ));
          posRow.appendChild(makeLbl("Y", "margin-left:4px;"));
          posRow.appendChild(makeNumInput(-200, 200, 1, marker.offsetY ?? 0, "Label Y offset (px, negative = up)", 42,
            e => { marker.offsetY = parseInt(e.target.value) || 0; }
          ));
          posRow.appendChild(makeLbl("Halo", "margin-left:6px;"));
          const haloSlider = document.createElement("input");
          haloSlider.type = "range"; haloSlider.min = "0"; haloSlider.max = "8"; haloSlider.step = "0.5";
          haloSlider.value = String(marker.outlineWidth ?? 2);
          haloSlider.title = "Halo/outline width (0 = none)";
          haloSlider.style.cssText = "flex:1;min-width:30px;";
          const haloVal = document.createElement("span");
          haloVal.textContent = String(marker.outlineWidth ?? 2);
          haloVal.style.cssText = "font-size:10px;color:#888;width:18px;text-align:right;";
          haloSlider.addEventListener("input", e => {
            marker.outlineWidth = parseFloat(e.target.value);
            haloVal.textContent = e.target.value;
            updateCityLabelStyle(marker);
          });
          posRow.appendChild(haloSlider);
          posRow.appendChild(haloVal);

          // ── Row 3: Background ─────────────────────────────────────────────
          const bgRow = document.createElement("div");
          bgRow.className = "city-style-row";

          const bgColorSwatch = makeColorSwatch(
            () => marker.backgroundColor ?? '#000000',
            v  => { marker.backgroundColor = v; },
            "Background color"
          );
          bgColorSwatch.style.display = marker.showBackground ? "inline-block" : "none";

          const bgToggleBtn = makeToggleBtn("Bg", "Label background fill", marker.showBackground, btn => {
            marker.showBackground = !marker.showBackground;
            btn.className = "hl-toggle" + (marker.showBackground ? " hl-toggle-active" : "");
            bgColorSwatch.style.display = marker.showBackground ? "inline-block" : "none";
            updateCityLabelStyle(marker);
          });
          bgRow.appendChild(bgToggleBtn);
          bgRow.appendChild(bgColorSwatch);
          bgRow.appendChild(makeLbl("Pad X", "margin-left:6px;"));
          bgRow.appendChild(makeNumInput(0, 40, 1, marker.bgPadX ?? 5, "Background horizontal padding (px)", 38,
            e => { marker.bgPadX = Math.max(0, parseInt(e.target.value) || 0); }
          ));
          bgRow.appendChild(makeLbl("Y", "margin-left:4px;"));
          bgRow.appendChild(makeNumInput(0, 40, 1, marker.bgPadY ?? 3, "Background vertical padding (px)", 38,
            e => { marker.bgPadY = Math.max(0, parseInt(e.target.value) || 0); }
          ));

          // ── Row 4: Opacity ────────────────────────────────────────────────
          const opacityRow = document.createElement("div");
          opacityRow.className = "city-style-row";

          const makeOpacityControl = (labelText, getValue, setValue) => {
            const lbl = makeLbl(labelText);
            const slider = document.createElement("input");
            slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.step = "5";
            slider.value = String(Math.round(getValue() * 100));
            slider.style.cssText = "flex:1;min-width:30px;";
            const pct = document.createElement("span");
            pct.textContent = Math.round(getValue() * 100) + "%";
            pct.style.cssText = "font-size:10px;color:#888;width:26px;text-align:right;";
            slider.addEventListener("input", e => {
              setValue(parseInt(e.target.value) / 100);
              pct.textContent = e.target.value + "%";
              updateCityLabelStyle(marker);
            });
            opacityRow.appendChild(lbl);
            opacityRow.appendChild(slider);
            opacityRow.appendChild(pct);
          };
          makeOpacityControl("Dot",   () => marker.dotOpacity        ?? 1.0, v => { marker.dotOpacity        = v; });
          makeOpacityControl("Label", () => marker.labelOpacity      ?? 1.0, v => { marker.labelOpacity      = v; });
          makeOpacityControl("Bg",    () => marker.backgroundOpacity ?? 0.5, v => { marker.backgroundOpacity = v; });

          const copyStyleBtn = document.createElement("button");
          copyStyleBtn.className = "hl-toggle";
          copyStyleBtn.textContent = "⎘ Copy style";
          copyStyleBtn.title = "Copy this city's style to clipboard";
          copyStyleBtn.style.cssText = "font-size:10px;margin-top:2px;width:100%;";

          copyStyleBtn.addEventListener("click", () => copyCityStyle(marker));

          [fontRow, posRow, bgRow, opacityRow, copyStyleBtn].forEach(r => r.style.display = "none");
          styleToggle.addEventListener("click", () => {
            const open = fontRow.style.display === "none";
            [fontRow, posRow, bgRow, opacityRow].forEach(r => r.style.display = open ? "flex" : "none");
            copyStyleBtn.style.display = open ? "block" : "none";
            styleToggle.textContent = open ? "▼" : "▸";
          });

          li.appendChild(fontRow);
          li.appendChild(posRow);
          li.appendChild(bgRow);
          li.appendChild(opacityRow);
          li.appendChild(copyStyleBtn);
          ul.appendChild(li);
        });
      }

      document.getElementById("applyStyleToAllBtn").addEventListener("click", applyStyleToAll);
      document.getElementById("clearClipboardBtn").addEventListener("click", clearStyleClipboard);

      document.getElementById("addCityBtn").addEventListener("click", () => {
        const val = document.getElementById("citySearch").value.trim();
        if (!val) return;
        if (!addCity(val)) geocodeAndShow(val);
        else document.getElementById("citySearch").value = "";
      });

      document.getElementById("citySearch").addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        const val = e.target.value.trim();
        if (!val) return;
        if (!addCity(val)) geocodeAndShow(val);
        else e.target.value = "";
      });

      document.getElementById("citySearch").addEventListener("input", () => {
        hideGeocodeResults();
      });

      // ── City Route Groups ────────────────────────────────────────────────────

      const COUNTRY_ABBREV = {
        'United States of America': 'USA', 'United States': 'USA',
        'United Kingdom': 'UK', 'Russia': 'RUS', 'China': 'CHN',
        'Germany': 'GER', 'France': 'FRA', 'Italy': 'ITA', 'Spain': 'ESP',
        'Canada': 'CAN', 'Australia': 'AUS', 'Brazil': 'BRA', 'India': 'IND',
        'Japan': 'JPN', 'South Korea': 'KOR', 'Mexico': 'MEX',
        'Argentina': 'ARG', 'South Africa': 'ZAF', 'Nigeria': 'NGA',
        'Egypt': 'EGY', 'Saudi Arabia': 'SAU', 'Turkey': 'TUR',
        'Netherlands': 'NLD', 'Belgium': 'BEL', 'Sweden': 'SWE',
        'Norway': 'NOR', 'Denmark': 'DNK', 'Finland': 'FIN',
        'Poland': 'POL', 'Ukraine': 'UKR', 'Switzerland': 'CHE',
        'Austria': 'AUT', 'Portugal': 'PRT', 'Greece': 'GRC',
        'New Zealand': 'NZL', 'Indonesia': 'IDN', 'Pakistan': 'PAK',
        'Bangladesh': 'BGD', 'Vietnam': 'VNM', 'Thailand': 'THA',
        'Philippines': 'PHL', 'Malaysia': 'MYS', 'Singapore': 'SGP',
        'Israel': 'ISR', 'Iran': 'IRN', 'Iraq': 'IRQ',
        'Colombia': 'COL', 'Chile': 'CHL', 'Peru': 'PER',
        'Venezuela': 'VEN', 'Czech Republic': 'CZE', 'Romania': 'ROU',
        'Hungary': 'HUN', 'Morocco': 'MAR', 'Kenya': 'KEN',
        'Ethiopia': 'ETH', 'Ghana': 'GHA', 'Tanzania': 'TZA',
      };

      function routeCityDisplayName(city) {
        const country = COUNTRY_ABBREV[city.country] || city.country;
        if (city.state) return `${city.name}, ${city.state} (${country})`;
        return `${city.name} (${country})`;
      }

      let cityRouteGroups   = [];
      let nextRouteGroupId  = 1;
      let nextRouteColorIdx = 0;

      function arcPositions(cityA, cityB, numPts) {
        const gd = new Cesium.EllipsoidGeodesic(
          Cesium.Cartographic.fromDegrees(cityA.lon, cityA.lat),
          Cesium.Cartographic.fromDegrees(cityB.lon, cityB.lat)
        );
        const dist = gd.surfaceDistance;
        const maxH = dist * 0.30; // 30% of surface distance as peak height
        const pts = [];
        for (let i = 0; i <= numPts; i++) {
          const t = i / numPts;
          const pt = gd.interpolateUsingSurfaceDistance(t * dist);
          const h  = Math.sin(Math.PI * t) * maxH;
          pts.push(Cesium.Cartesian3.fromRadians(pt.longitude, pt.latitude, h));
        }
        return pts;
      }

      function buildRouteEntities(group) {
        group.entities.forEach(e => viewer.entities.remove(e));
        group.entities = [];
        if ((group.lineStyle ?? 'line') === 'none') return;
        const cities = group.cities;
        if (cities.length < 2) return;

        const color   = Cesium.Color.fromCssColorString(group.color);
        const w       = group.width ?? 2;
        const n       = cities.length - 1;
        const isArrow = (group.lineShape ?? 'straight') === 'arrow';
        const isArc   = (group.lineShape ?? 'straight') === 'arc';

        let lineMat;
        if (group.lineStyle === 'dashed') lineMat = new Cesium.PolylineDashMaterialProperty({ color, dashLength: 20, gapColor: Cesium.Color.TRANSPARENT });
        else if (group.lineStyle === 'dotted') lineMat = new Cesium.PolylineDashMaterialProperty({ color, dashLength: 6, gapColor: Cesium.Color.TRANSPARENT });
        else lineMat = color;

        for (let i = 0; i < n; i++) {
          const seg = i; // capture
          const a = cities[i], b = cities[i + 1];

          // show: CallbackProperty so visibility updates without entity rebuild
          const showCb = new Cesium.CallbackProperty(() => {
            if (group.visible === false) return false;
            const sf = (group.routeStart ?? 0) / 100;
            const ef = (group.routeEnd   ?? 100) / 100;
            if (isArrow) return (seg + 0.5) / n >= sf && (seg + 0.5) / n <= ef;
            return Math.max(0, sf * n - seg) < Math.min(1, ef * n - seg);
          }, false);

          let positions, material, lineWidth;

          if (isArrow) {
            positions = Cesium.Cartesian3.fromDegreesArray([a.lon, a.lat, b.lon, b.lat]);
            material  = new Cesium.PolylineArrowMaterialProperty(color);
            lineWidth = Math.max(w * 4, 12);
          } else if (isArc) {
            const arcPts = arcPositions(a, b, 48); // precomputed once per segment
            positions = new Cesium.CallbackProperty(() => {
              const sf = (group.routeStart ?? 0) / 100;
              const ef = (group.routeEnd   ?? 100) / 100;
              const t0 = Math.max(0, sf * n - seg);
              const t1 = Math.min(1, ef * n - seg);
              if (t0 >= t1) return arcPts.slice(0, 2);
              const si = Math.floor(t0 * 48), ei = Math.ceil(t1 * 48);
              const pts = arcPts.slice(si, Math.min(ei + 1, arcPts.length));
              return pts.length >= 2 ? pts : arcPts.slice(0, 2);
            }, false);
            material  = lineMat;
            lineWidth = w;
          } else {
            const posA = Cesium.Cartesian3.fromDegrees(a.lon, a.lat);
            const posB = Cesium.Cartesian3.fromDegrees(b.lon, b.lat);
            positions = new Cesium.CallbackProperty(() => {
              const sf = (group.routeStart ?? 0) / 100;
              const ef = (group.routeEnd   ?? 100) / 100;
              const t0 = Math.max(0, sf * n - seg);
              const t1 = Math.min(1, ef * n - seg);
              return [
                Cesium.Cartesian3.lerp(posA, posB, t0, new Cesium.Cartesian3()),
                Cesium.Cartesian3.lerp(posA, posB, t1, new Cesium.Cartesian3()),
              ];
            }, false);
            material  = lineMat;
            lineWidth = w;
          }

          group.entities.push(viewer.entities.add({
            polyline: { positions, show: showCb, width: lineWidth, material, clampToGround: false }
          }));
        }
      }

      function _routeLabelProps(group, text, cx, cy, prefix = 'label') {
        const p = prefix;
        const lo       = group[`${p}Opacity`]        ?? 1.0;
        const defSize  = p === 'gl' ? 28 : 14;
        const defBold  = p === 'gl' ? 'bold' : 'normal';
        const labelCol = Cesium.Color.fromCssColorString(group[`${p}Color`] ?? group.color);
        const fs = group[`${p}FontStyle`]  ?? 'normal';
        const fw = group[`${p}FontWeight`] ?? defBold;
        const fz = group[`${p}FontSize`]   ?? defSize;
        const ff = group[`${p}FontFamily`] ?? 'Arial';
        const fontStr = `${fs === 'italic' ? 'italic ' : ''}${fw === 'bold' ? 'bold ' : ''}${fz}px ${ff}`;
        return {
          text,
          font: fontStr,
          fillColor: labelCol.withAlpha(lo),
          outlineColor: Cesium.Color.BLACK.withAlpha(lo),
          outlineWidth: group[`${p}OutlineWidth`] ?? 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: group[`${p}ShowBackground`] ?? false,
          backgroundColor: Cesium.Color.fromCssColorString(group[`${p}BgColor`] ?? '#000000')
            .withAlpha((group[`${p}BgOpacity`] ?? 0.5) * lo),
          backgroundPadding: new Cesium.Cartesian2(group[`${p}BgPadX`] ?? 5, group[`${p}BgPadY`] ?? 3),
          pixelOffset: new Cesium.Cartesian2(cx, cy),
          show: group.visible !== false,
        };
      }

      function buildRouteCityMarkers(group) {
        group.cityEntities.forEach(e => viewer.entities.remove(e));
        group.cityEntities = [];
        if (!group.showCityLabels || !group.cities.length) return;
        const dotCol = Cesium.Color.fromCssColorString(group.color);
        const show = group.visible !== false;
        for (const city of group.cities) {
          const e = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(city.lon, city.lat),
            point: new Cesium.PointGraphics({
              pixelSize: 6,
              color: dotCol,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 1,
              show,
            }),
            label: new Cesium.LabelGraphics({
              ..._routeLabelProps(group, city.name, group.labelOffsetX ?? 4, group.labelOffsetY ?? 0),
              show,
              horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
            }),
          });
          group.cityEntities.push(e);
        }
      }

      function buildRouteGroupLabel(group) {
        if (group.labelEntity) { viewer.entities.remove(group.labelEntity); group.labelEntity = null; }
        if (!group.showLabel || !group.cities.length) return;
        const lat = group.cities.reduce((s, c) => s + c.lat, 0) / group.cities.length;
        const lon = group.cities.reduce((s, c) => s + c.lon, 0) / group.cities.length;
        group.labelEntity = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          label: {
            ..._routeLabelProps(group, group.name, group.glOffsetX ?? 0, group.glOffsetY ?? 0, 'gl'),
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
          }
        });
      }

      function buildRouteLabels(group) {
        buildRouteCityMarkers(group);
        buildRouteGroupLabel(group);
      }

      function createCityRouteGroup(name, cities = [], aiMeta = null) {
        if (!name) return;
        const group = {
          id: nextRouteGroupId++,
          name,
          color: GROUP_COLORS[nextRouteColorIdx++ % GROUP_COLORS.length],
          lineStyle: 'line',
          lineShape: 'straight',
          routeStart: 0,
          routeEnd: 100,
          width: 2,
          visible: true,
          citiesCollapsed: false,
          cityLabelStyleCollapsed: true,
          glStyleCollapsed: true,
          cities: cities.map(c => ({ name: c.name, country: c.country, state: c.state || undefined, lat: c.lat, lon: c.lon })),
          entities: [],
          cityEntities: [],
          aiMeta,
          // City marker label style
          showCityLabels: false,
          labelColor: null,
          labelFontSize: 14,
          labelFontWeight: 'normal',
          labelFontStyle: 'normal',
          labelFontFamily: 'Arial',
          labelOffsetX: 4,
          labelOffsetY: 0,
          labelOutlineWidth: 2,
          labelOpacity: 1.0,
          labelShowBackground: false,
          labelBgColor: '#000000',
          labelBgOpacity: 0.5,
          labelBgPadX: 5,
          labelBgPadY: 3,
          // Group label style (larger by default)
          showLabel: false,
          labelEntity: null,
          glColor: null,
          glFontSize: 28,
          glFontWeight: 'bold',
          glFontStyle: 'normal',
          glFontFamily: 'Arial',
          glOffsetX: 0,
          glOffsetY: 0,
          glOutlineWidth: 2,
          glOpacity: 1.0,
          glShowBackground: false,
          glBgColor: '#000000',
          glBgOpacity: 0.5,
          glBgPadX: 5,
          glBgPadY: 3,
        };
        cityRouteGroups.push(group);
        tracks['route_' + group.id] = { id: 'route_' + group.id, label: 'Route: ' + name, category: 'route',
          color: group.color, h: 22, keyframes: [], collapsed: true };
        selectedTrackIds.add('route_' + group.id);
        buildRouteEntities(group);
        tlBuildLabels();
        renderRouteGroupList();
        return group;
      }

      function deleteCityRouteGroup(id) {
        const idx = cityRouteGroups.findIndex(g => g.id === id);
        if (idx === -1) return;
        const g = cityRouteGroups[idx];
        g.entities.forEach(e => viewer.entities.remove(e));
        g.cityEntities.forEach(e => viewer.entities.remove(e));
        if (g.labelEntity) viewer.entities.remove(g.labelEntity);
        cityRouteGroups.splice(idx, 1);
        delete tracks['route_' + id];
        selectedTrackIds.delete('route_' + id);
        tlBuildLabels();
        renderRouteGroupList();
      }

      function setRouteGroupVisible(group, visible) {
        group.visible = visible;
        // polyline entities: showCb reads group.visible — no explicit update needed
        group.cityEntities.forEach(e => { e.show = visible; });
        if (group.labelEntity) group.labelEntity.show = visible && group.showLabel;
      }

      function lookupRouteCity(displayStr) {
        // Match "Name (Country)" format from datalist
        const m = displayStr.match(/^(.+)\s+\((.+)\)$/);
        if (m) {
          const [, name, country] = m;
          return cityData.find(c => c.name === name && c.country === country) || null;
        }
        // Plain name: first match
        return cityData.find(c => c.name === displayStr) || null;
      }

      function makeRouteLabelStyleSection(group, prefix, collapsedKey, title, rebuildFn) {
        const toggle = document.createElement("div");
        toggle.className = "route-cities-toggle";
        toggle.style.marginBottom = "3px";
        const arrow = document.createElement("span");
        arrow.textContent = group[collapsedKey] ? "▶" : "▼";
        const titleSpan = document.createElement("span");
        titleSpan.textContent = title;
        toggle.append(arrow, titleSpan);

        const panel = document.createElement("div");
        panel.style.display = group[collapsedKey] ? "none" : "";
        toggle.addEventListener("click", () => {
          group[collapsedKey] = !group[collapsedKey];
          arrow.textContent = group[collapsedKey] ? "▶" : "▼";
          panel.style.display = group[collapsedKey] ? "none" : "";
        });

        const p = prefix;
        const defSize = p === 'gl' ? 28 : 14;
        const defBold = p === 'gl' ? 'bold' : 'normal';
        const defOX   = p === 'label' ? 4 : 0;

        const mkLbl = (text, extra) => { const s = document.createElement("span"); s.textContent = text; s.style.cssText = `font-size:10px;color:#888;${extra??''}`; return s; };
        const mkNum = (min, max, step, val, title, w, onChange) => {
          const el = document.createElement("input");
          el.type = "number"; el.min = min; el.max = max; el.step = step; el.value = val; el.title = title;
          el.style.cssText = `width:${w}px;font-size:11px;padding:1px 3px;margin:0;text-align:center;`;
          el.addEventListener("change", e => { onChange(e); rebuildFn(); });
          return el;
        };
        const mkSwatch = (getColor, setColor, title) => {
          const sw = document.createElement("span");
          sw.title = title;
          sw.style.cssText = `display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid #666;background:${getColor()};cursor:pointer;flex-shrink:0;`;
          const inp = document.createElement("input"); inp.type = "color"; inp.value = getColor();
          inp.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
          sw.appendChild(inp);
          sw.addEventListener("click", () => inp.click());
          inp.addEventListener("input", e => { setColor(e.target.value); sw.style.background = e.target.value; rebuildFn(); });
          return sw;
        };
        const mkToggle = (label, title, isActive, onClick) => {
          const btn = document.createElement("button");
          btn.textContent = label; btn.title = title;
          btn.className = "hl-toggle" + (isActive ? " hl-toggle-active" : "");
          btn.addEventListener("click", () => onClick(btn));
          return btn;
        };

        // Row 1: color + font
        const fontRow = document.createElement("div");
        fontRow.className = "city-style-row";
        fontRow.appendChild(mkSwatch(
          () => group[`${p}Color`] ?? group.color,
          v  => { group[`${p}Color`] = v; }, "Label color"
        ));
        fontRow.appendChild(mkLbl("Size"));
        fontRow.appendChild(mkNum(8, 100, 1, group[`${p}FontSize`] ?? defSize, "Font size (px)", 40,
          e => { group[`${p}FontSize`] = Math.max(8, parseInt(e.target.value) || defSize); e.target.value = group[`${p}FontSize`]; }
        ));
        const boldBtn = mkToggle("B", "Bold", (group[`${p}FontWeight`] ?? defBold) === 'bold', btn => {
          group[`${p}FontWeight`] = group[`${p}FontWeight`] === 'bold' ? 'normal' : 'bold';
          btn.className = "hl-toggle" + (group[`${p}FontWeight`] === 'bold' ? " hl-toggle-active" : "");
          rebuildFn();
        });
        boldBtn.style.cssText = "font-weight:bold;min-width:24px;";
        fontRow.appendChild(boldBtn);
        const italicBtn = mkToggle("I", "Italic", group[`${p}FontStyle`] === 'italic', btn => {
          group[`${p}FontStyle`] = group[`${p}FontStyle`] === 'italic' ? 'normal' : 'italic';
          btn.className = "hl-toggle" + (group[`${p}FontStyle`] === 'italic' ? " hl-toggle-active" : "");
          rebuildFn();
        });
        italicBtn.style.cssText = "font-style:italic;min-width:24px;";
        fontRow.appendChild(italicBtn);
        const fontSel = makeFontSelect(group[`${p}FontFamily`]||'Arial', "flex:1;font-size:11px;margin:0;", val => { group[`${p}FontFamily`] = val; rebuildFn(); });
        fontRow.appendChild(fontSel);

        // Row 2: offset + halo
        const posRow = document.createElement("div");
        posRow.className = "city-style-row";
        posRow.appendChild(mkLbl("X"));
        posRow.appendChild(mkNum(-200, 200, 1, group[`${p}OffsetX`] ?? defOX, "X offset (px)", 42, e => { group[`${p}OffsetX`] = parseInt(e.target.value) || 0; }));
        posRow.appendChild(mkLbl("Y", "margin-left:4px;"));
        posRow.appendChild(mkNum(-200, 200, 1, group[`${p}OffsetY`] ?? 0, "Y offset (px)", 42, e => { group[`${p}OffsetY`] = parseInt(e.target.value) || 0; }));
        posRow.appendChild(mkLbl("Halo", "margin-left:6px;"));
        const haloSlider = document.createElement("input");
        haloSlider.type = "range"; haloSlider.min = "0"; haloSlider.max = "8"; haloSlider.step = "0.5";
        haloSlider.value = String(group[`${p}OutlineWidth`] ?? 2);
        haloSlider.style.cssText = "flex:1;min-width:30px;";
        const haloVal = document.createElement("span");
        haloVal.textContent = haloSlider.value;
        haloVal.style.cssText = "font-size:10px;color:#888;width:18px;text-align:right;";
        haloSlider.addEventListener("input", e => { group[`${p}OutlineWidth`] = parseFloat(e.target.value); haloVal.textContent = e.target.value; rebuildFn(); });
        posRow.append(haloSlider, haloVal);

        // Row 3: background
        const bgRow = document.createElement("div");
        bgRow.className = "city-style-row";
        const bgSwatch = mkSwatch(
          () => group[`${p}BgColor`] ?? '#000000',
          v  => { group[`${p}BgColor`] = v; }, "Background color"
        );
        bgSwatch.style.display = group[`${p}ShowBackground`] ? "inline-block" : "none";
        const bgToggle = mkToggle("Bg", "Background fill", group[`${p}ShowBackground`] ?? false, btn => {
          group[`${p}ShowBackground`] = !group[`${p}ShowBackground`];
          btn.className = "hl-toggle" + (group[`${p}ShowBackground`] ? " hl-toggle-active" : "");
          bgSwatch.style.display = group[`${p}ShowBackground`] ? "inline-block" : "none";
          rebuildFn();
        });
        bgRow.append(bgToggle, bgSwatch);
        bgRow.appendChild(mkLbl("Pad X", "margin-left:6px;"));
        bgRow.appendChild(mkNum(0, 40, 1, group[`${p}BgPadX`] ?? 5, "BG pad X", 38, e => { group[`${p}BgPadX`] = Math.max(0, parseInt(e.target.value) || 0); }));
        bgRow.appendChild(mkLbl("Y", "margin-left:4px;"));
        bgRow.appendChild(mkNum(0, 40, 1, group[`${p}BgPadY`] ?? 3, "BG pad Y", 38, e => { group[`${p}BgPadY`] = Math.max(0, parseInt(e.target.value) || 0); }));

        // Row 4: opacity
        const opRow = document.createElement("div");
        opRow.className = "city-style-row";
        opRow.appendChild(mkLbl("Opacity"));
        const opSlider = document.createElement("input");
        opSlider.type = "range"; opSlider.min = "0"; opSlider.max = "100"; opSlider.step = "5";
        opSlider.value = String(Math.round((group[`${p}Opacity`] ?? 1.0) * 100));
        opSlider.style.cssText = "flex:1;min-width:30px;";
        const opVal = document.createElement("span");
        opVal.textContent = opSlider.value + "%";
        opVal.style.cssText = "font-size:10px;color:#888;width:28px;text-align:right;";
        opSlider.addEventListener("input", e => { group[`${p}Opacity`] = parseInt(e.target.value) / 100; opVal.textContent = e.target.value + "%"; rebuildFn(); });
        opRow.append(opSlider, opVal);

        panel.append(fontRow, posRow, bgRow, opRow);
        return { toggle, panel };
      }

      function renderRouteGroupList() {
        const container = document.getElementById("routeGroupList");
        if (!container) return;
        container.innerHTML = "";

        for (const group of cityRouteGroups) {
          const card = document.createElement("div");
          card.className = "route-group-card";

          // ── Header ──
          const header = document.createElement("div");
          header.className = "route-group-header";

          const colorInput = document.createElement("input");
          colorInput.type = "color";
          colorInput.value = group.color;
          colorInput.className = "route-group-color";
          colorInput.title = "Change route color";
          colorInput.addEventListener("input", e => {
            group.color = e.target.value;
            buildRouteEntities(group);
            buildRouteLabels(group);
          });

          const nameEl = document.createElement("span");
          nameEl.className = "route-group-name";
          nameEl.textContent = group.name;
          nameEl.title = group.name;

          const countBadge = document.createElement("span");
          countBadge.className = "route-group-count";
          countBadge.textContent = group.cities.length;

          const visBtn = document.createElement("button");
          visBtn.className = "route-group-icon-btn" + (group.visible !== false ? "" : " route-group-icon-btn-off");
          visBtn.textContent = "👁";
          visBtn.title = group.visible !== false ? "Hide" : "Show";
          visBtn.addEventListener("click", () => {
            const nv = group.visible === false;
            setRouteGroupVisible(group, nv);
            visBtn.classList.toggle("route-group-icon-btn-off", !nv);
            visBtn.title = nv ? "Hide" : "Show";
          });

          const cityLabelBtn = document.createElement("button");
          cityLabelBtn.className = "route-group-icon-btn";
          cityLabelBtn.textContent = "🏙";
          cityLabelBtn.title = group.showCityLabels ? "Hide city labels" : "Show city labels";
          cityLabelBtn.style.opacity = group.showCityLabels ? "1" : "0.4";
          cityLabelBtn.addEventListener("click", () => {
            group.showCityLabels = !group.showCityLabels;
            cityLabelBtn.style.opacity = group.showCityLabels ? "1" : "0.4";
            cityLabelBtn.title = group.showCityLabels ? "Hide city labels" : "Show city labels";
            buildRouteCityMarkers(group);
          });

          const labelBtn = document.createElement("button");
          labelBtn.className = "route-group-icon-btn";
          labelBtn.textContent = "🏷";
          labelBtn.title = group.showLabel ? "Hide group label" : "Show group label";
          labelBtn.style.opacity = group.showLabel ? "1" : "0.4";
          labelBtn.addEventListener("click", () => {
            group.showLabel = !group.showLabel;
            labelBtn.style.opacity = group.showLabel ? "1" : "0.4";
            labelBtn.title = group.showLabel ? "Hide group label" : "Show group label";
            buildRouteGroupLabel(group);
          });

          const delBtn = document.createElement("button");
          delBtn.className = "route-group-icon-btn";
          delBtn.textContent = "🗑";
          delBtn.title = "Delete route";
          delBtn.addEventListener("click", () => deleteCityRouteGroup(group.id));

          header.append(colorInput, nameEl, countBadge, visBtn, cityLabelBtn, labelBtn, delBtn);

          // ── Style row (line appearance) ──
          const styleRow = document.createElement("div");
          styleRow.className = "route-style-row";
          styleRow.appendChild(Object.assign(document.createElement("label"), { textContent: "Style:" }));
          for (const s of ['none','line','dashed','dotted']) {
            const btn = document.createElement("button");
            btn.className = "route-style-btn" + ((group.lineStyle ?? 'line') === s ? " active" : "");
            btn.textContent = s.charAt(0).toUpperCase() + s.slice(1);
            btn.addEventListener("click", () => {
              group.lineStyle = s;
              buildRouteEntities(group);
              styleRow.querySelectorAll(".route-style-btn").forEach(b => b.classList.toggle("active", b === btn));
            });
            styleRow.appendChild(btn);
          }

          // ── Shape row (line geometry) ──
          const shapeRow = document.createElement("div");
          shapeRow.className = "route-style-row";
          shapeRow.appendChild(Object.assign(document.createElement("label"), { textContent: "Shape:" }));
          for (const s of ['straight','arc','arrow']) {
            const btn = document.createElement("button");
            btn.className = "route-style-btn" + ((group.lineShape ?? 'straight') === s ? " active" : "");
            btn.textContent = s.charAt(0).toUpperCase() + s.slice(1);
            btn.addEventListener("click", () => {
              group.lineShape = s;
              buildRouteEntities(group);
              shapeRow.querySelectorAll(".route-style-btn").forEach(b => b.classList.toggle("active", b === btn));
            });
            shapeRow.appendChild(btn);
          }

          // ── Width ──
          const widthRow = document.createElement("div");
          widthRow.className = "route-width-row";
          const widthLabel = document.createElement("label");
          widthLabel.textContent = "Width:";
          const widthSlider = document.createElement("input");
          widthSlider.type = "range"; widthSlider.min = 1; widthSlider.max = 12; widthSlider.step = 1;
          widthSlider.value = group.width ?? 2;
          const widthVal = document.createElement("span");
          widthVal.className = "route-width-val";
          widthVal.textContent = widthSlider.value;
          widthSlider.addEventListener("input", () => {
            group.width = parseInt(widthSlider.value);
            widthVal.textContent = widthSlider.value;
            buildRouteEntities(group);
          });
          widthRow.append(widthLabel, widthSlider, widthVal);

          // ── Route range (start % / end %) ──
          const makeRangeRow = (labelText, field, defaultVal) => {
            const row = document.createElement("div");
            row.className = "route-width-row";
            row.appendChild(Object.assign(document.createElement("label"), { textContent: labelText, style: "min-width:36px;" }));
            const slider = document.createElement("input");
            slider.type = "range"; slider.min = 0; slider.max = 100; slider.step = 1;
            slider.value = group[field] ?? defaultVal;
            const valSpan = document.createElement("span");
            valSpan.className = "route-width-val";
            valSpan.style.width = "28px";
            valSpan.textContent = slider.value + "%";
            slider.addEventListener("input", () => {
              group[field] = parseInt(slider.value);
              valSpan.textContent = slider.value + "%";
              // Clamp: start <= end (CallbackProperty picks up new values automatically)
              if (field === 'routeStart' && group.routeStart > group.routeEnd) { group.routeEnd = group.routeStart; endSlider.value = group.routeEnd; endVal.textContent = group.routeEnd + "%"; }
              if (field === 'routeEnd'   && group.routeEnd < group.routeStart) { group.routeStart = group.routeEnd; startSlider.value = group.routeStart; startVal.textContent = group.routeStart + "%"; }
            });
            row.append(slider, valSpan);
            return { row, slider, valSpan };
          };
          const { row: startRow, slider: startSlider, valSpan: startVal } = makeRangeRow("Start:", "routeStart", 0);
          const { row: endRow,   slider: endSlider,   valSpan: endVal   } = makeRangeRow("End:",   "routeEnd",   100);

          // ── Label styling panels ──
          const { toggle: cityLsToggle, panel: cityLsPanel } = makeRouteLabelStyleSection(
            group, 'label', 'cityLabelStyleCollapsed', "City label style", () => buildRouteCityMarkers(group)
          );
          const { toggle: glToggle, panel: glPanel } = makeRouteLabelStyleSection(
            group, 'gl', 'glStyleCollapsed', "Group label style", () => buildRouteGroupLabel(group)
          );

          // ── City search ──
          const cityAddRow = document.createElement("div");
          cityAddRow.className = "route-city-add-row";
          const cityInput = document.createElement("input");
          cityInput.type = "text";
          cityInput.setAttribute("list", "cityDatalist");
          cityInput.placeholder = "Add city…";
          cityInput.autocomplete = "off";
          const cityAddBtn = document.createElement("button");
          cityAddBtn.textContent = "+";
          cityAddBtn.addEventListener("click", () => {
            const found = lookupRouteCity(cityInput.value.trim());
            if (!found) return;
            group.cities.push({ name: found.name, country: found.country, lat: found.lat, lon: found.lon });
            cityInput.value = "";
            buildRouteEntities(group); buildRouteLabels(group);
            renderRouteGroupList();
          });
          cityInput.addEventListener("keydown", e => {
            if (e.key !== "Enter") return;
            const found = lookupRouteCity(cityInput.value.trim());
            if (!found) return;
            group.cities.push({ name: found.name, country: found.country, lat: found.lat, lon: found.lon });
            cityInput.value = "";
            buildRouteEntities(group); buildRouteLabels(group);
            renderRouteGroupList();
          });
          cityAddRow.append(cityInput, cityAddBtn);

          // ── City list toggle ──
          const citiesToggle = document.createElement("div");
          citiesToggle.className = "route-cities-toggle";
          const arrow = document.createElement("span");
          arrow.textContent = group.citiesCollapsed ? "▶" : "▼";
          const toggleLabel = document.createElement("span");
          toggleLabel.textContent = `Cities (${group.cities.length})`;
          citiesToggle.append(arrow, toggleLabel);

          const cityUl = document.createElement("ul");
          cityUl.className = "route-city-list";
          cityUl.style.display = group.citiesCollapsed ? "none" : "";

          citiesToggle.addEventListener("click", () => {
            group.citiesCollapsed = !group.citiesCollapsed;
            arrow.textContent = group.citiesCollapsed ? "▶" : "▼";
            cityUl.style.display = group.citiesCollapsed ? "none" : "";
          });

          group.cities.forEach((city, idx) => {
            const li = document.createElement("li");
            li.className = "route-city-item";

            const numSpan = document.createElement("span");
            numSpan.style.cssText = "flex:0;color:#aaa;font-size:10px;min-width:14px;";
            numSpan.textContent = idx + 1;

            const nameSpan = document.createElement("span");
            nameSpan.textContent = routeCityDisplayName(city);

            const upBtn = document.createElement("button");
            upBtn.className = "route-city-reorder"; upBtn.textContent = "↑"; upBtn.title = "Move up";
            upBtn.disabled = idx === 0;
            upBtn.addEventListener("click", () => {
              if (idx === 0) return;
              [group.cities[idx - 1], group.cities[idx]] = [group.cities[idx], group.cities[idx - 1]];
              buildRouteEntities(group); buildRouteLabels(group);
              renderRouteGroupList();
            });

            const downBtn = document.createElement("button");
            downBtn.className = "route-city-reorder"; downBtn.textContent = "↓"; downBtn.title = "Move down";
            downBtn.disabled = idx === group.cities.length - 1;
            downBtn.addEventListener("click", () => {
              if (idx >= group.cities.length - 1) return;
              [group.cities[idx], group.cities[idx + 1]] = [group.cities[idx + 1], group.cities[idx]];
              buildRouteEntities(group); buildRouteLabels(group);
              renderRouteGroupList();
            });

            const removeBtn = document.createElement("button");
            removeBtn.className = "route-city-remove"; removeBtn.textContent = "×"; removeBtn.title = "Remove";
            removeBtn.addEventListener("click", () => {
              group.cities.splice(idx, 1);
              buildRouteEntities(group); buildRouteLabels(group);
              renderRouteGroupList();
            });

            li.append(numSpan, nameSpan, upBtn, downBtn, removeBtn);
            cityUl.appendChild(li);
          });

          card.append(header, styleRow, shapeRow, widthRow, startRow, endRow, cityLsToggle, cityLsPanel, glToggle, glPanel, cityAddRow, citiesToggle, cityUl);
          container.appendChild(card);
        }
      }

      // ── City Route AI Query ──────────────────────────────────────────────────

      document.getElementById("addRouteGroupBtn").addEventListener("click", () => {
        const name = document.getElementById("routeGroupNameInput").value.trim();
        if (!name) return;
        createCityRouteGroup(name);
        document.getElementById("routeGroupNameInput").value = "";
      });

      document.getElementById("routeGroupNameInput").addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        const name = e.target.value.trim();
        if (!name) return;
        createCityRouteGroup(name);
        e.target.value = "";
      });

      document.getElementById("cityRouteQueryBtn").addEventListener("click", async () => {
        const query = document.getElementById("cityRouteQuery").value.trim();
        if (!query) return;
        const statusEl = document.getElementById("cityRouteQueryStatus");
        statusEl.style.display = "block";
        statusEl.textContent = "Asking AI…";
        document.getElementById("cityRouteQueryBtn").disabled = true;
        try {
          const res = await fetch("/api/city-query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
          });
          const data = await res.json();
          if (!res.ok) { statusEl.textContent = data.error || "Query failed"; return; }
          if (!data.cities?.length) { statusEl.textContent = "No cities found"; return; }

          // Merge AI coordinates with local cities.json where available
          const cities = data.cities.map(c => {
            const local = cityData.find(d =>
              d.name.toLowerCase() === c.name.toLowerCase() &&
              d.country.toLowerCase() === c.country.toLowerCase()
            ) || cityData.find(d => d.name.toLowerCase() === c.name.toLowerCase());
            return local ? { name: local.name, country: local.country, state: c.state || undefined, lat: local.lat, lon: local.lon }
                         : { name: c.name, country: c.country, state: c.state || undefined, lat: c.lat, lon: c.lon };
          });

          const groupName = data.label || query.slice(0, 40);
          createCityRouteGroup(groupName, cities, { query, count: cities.length });
          statusEl.textContent = `Created "${groupName}" with ${cities.length} cities.`;
          document.getElementById("cityRouteQuery").value = "";
        } catch (e) {
          statusEl.textContent = "Request failed";
          console.error("[city-query]", e);
        } finally {
          document.getElementById("cityRouteQueryBtn").disabled = false;
        }
      });

      // ── KML Overlays ─────────────────────────────────────────────────────────

      // Returns true if a Cesium entity has renderable geometry.
      function hasKmlGeometry(e) {
        return !!(e.polygon || e.polyline || e.billboard || e.label || e.point ||
                  e.model || e.ellipse || e.rectangle || e.corridor ||
                  e.ellipsoid || e.box || e.cylinder || e.wall);
      }

      // Returns true if entity is a descendant of ancestor via the parent chain.
      function kmlIsDescendant(entity, ancestor) {
        let cur = entity.parent;
        while (cur) { if (cur === ancestor) return true; cur = cur.parent; }
        return false;
      }

      // Captures original Cesium.Color values for each entity so opacity can be
      // applied as a multiplier without losing the authored color.
      function kmlStoreColors(entities) {
        const t = Cesium.JulianDate.now();
        const map = new Map();
        for (const e of entities) {
          const c = {};
          try { if (e.polygon?.material?.color)  c.polyFill    = e.polygon.material.color.getValue(t)?.clone(); }    catch(_) {}
          try { if (e.polygon?.outlineColor)      c.polyOutline = e.polygon.outlineColor.getValue(t)?.clone(); }      catch(_) {}
          try { if (e.polyline?.material?.color)  c.line        = e.polyline.material.color.getValue(t)?.clone(); }   catch(_) {}
          try { c.billboard   = e.billboard  ? (e.billboard.color?.getValue(t)  ?? Cesium.Color.WHITE).clone()  : undefined; } catch(_) {}
          try { c.point       = e.point      ? (e.point.color?.getValue(t)      ?? Cesium.Color.WHITE).clone()  : undefined; } catch(_) {}
          try { c.labelFill   = e.label      ? (e.label.fillColor?.getValue(t)  ?? Cesium.Color.WHITE).clone()  : undefined; } catch(_) {}
          try { c.labelOutline= e.label      ? (e.label.outlineColor?.getValue(t)?? Cesium.Color.BLACK).clone() : undefined; } catch(_) {}
          map.set(e.id, c);
        }
        return map;
      }

      // Installs CallbackProperty on each entity in a layer so Cesium evaluates
      // the color during its own render phase — no pipeline lag, smooth opacity.
      // Called once after layer creation; applyKmlLayerOpacity then only needs
      // to update layer.opacity and Cesium picks it up on the next render.
      function setupKmlLayerCallbacks(layer) {
        for (const e of layer.entities) {
          const c = layer.origColors.get(e.id);
          if (!c) continue;
          const cb = (origColor, fallback) => {
            if (!origColor && !fallback) return undefined;
            const base = origColor ?? fallback;
            // Use layer.opacity directly as alpha (ignoring the KML-authored alpha,
            // which is often baked-in semi-transparency like 0x80 = 50%).
            // This gives intuitive 0–100% control where 100% = fully opaque.
            return new Cesium.CallbackProperty(
              () => new Cesium.Color(base.red, base.green, base.blue, layer.opacity),
              false // isConstant = false → re-evaluated every frame
            );
          };
          if (c.polyFill    && e.polygon?.material?.color)  e.polygon.material.color  = cb(c.polyFill);
          if (c.polyOutline && e.polygon?.outlineColor)     e.polygon.outlineColor    = cb(c.polyOutline);
          if (c.line        && e.polyline?.material?.color) e.polyline.material.color = cb(c.line);
          if (c.billboard   !== undefined && e.billboard)   e.billboard.color         = cb(c.billboard,  Cesium.Color.WHITE);
          if (c.point       !== undefined && e.point)       e.point.color             = cb(c.point,      Cesium.Color.WHITE);
          if (c.labelFill   !== undefined && e.label)       e.label.fillColor         = cb(c.labelFill,  Cesium.Color.WHITE);
          if (c.labelOutline!== undefined && e.label)       e.label.outlineColor      = cb(c.labelOutline, Cesium.Color.BLACK);
        }
      }

      // Updates layer.opacity — the CallbackProperties installed by setupKmlLayerCallbacks
      // read this value on every render, so no per-entity iteration is needed here.
      function applyKmlLayerOpacity(layer, opacity) {
        layer.opacity = opacity;
      }

      // Discovers KML folder structure from a loaded KmlDataSource and returns
      // an array of layer objects, each with a name, entity list, and opacity.
      //
      // Strategy:
      //   - If there are multiple top-level folders → use those as layers.
      //   - If there is exactly one top-level folder (a wrapper) → use its direct
      //     child folders as layers (one level deeper), so a structure like
      //     "Temporary Places > cumulative_100.kml, cumulative_075.kml …" exposes
      //     the named documents rather than the invisible wrapper.
      function extractKmlLayers(dataSource) {
        const all = dataSource.entities.values;
        // Folder-like entities: no renderable geometry, but parent to at least one child
        const folderSet = new Set(all.filter(e => !hasKmlGeometry(e) && all.some(c => c.parent === e)));

        if (folderSet.size === 0) {
          const entities = all.filter(hasKmlGeometry);
          return [{ name: null, entities, opacity: 1.0, origColors: kmlStoreColors(entities) }];
        }

        // Top-level folders: their parent is not also a folder-like entity
        const topFolders = [...folderSet].filter(f => !folderSet.has(f.parent));

        // If a single wrapper folder, step into its direct child folders
        let targetFolders;
        if (topFolders.length === 1) {
          const children = [...folderSet].filter(f => f.parent === topFolders[0]);
          targetFolders = children.length > 0 ? children : topFolders;
        } else {
          targetFolders = topFolders;
        }

        const layers = targetFolders.map(folder => {
          const entities = all.filter(e => hasKmlGeometry(e) && kmlIsDescendant(e, folder));
          return { name: folder.name || 'Layer', entities, opacity: 1.0, origColors: kmlStoreColors(entities) };
        });

        // Any geometry not under a target folder
        const orphans = all.filter(e => hasKmlGeometry(e) && !targetFolders.some(f => kmlIsDescendant(e, f)));
        if (orphans.length > 0) {
          layers.push({ name: 'Other', entities: orphans, opacity: 1.0, origColors: kmlStoreColors(orphans) });
        }

        // Assign zIndex so layer order matches visual stacking: index 0 renders on
        // top, last index renders on the bottom. Cesium otherwise renders in
        // parse order (last-parsed = topmost), which is the opposite of intuitive.
        layers.forEach((layer, i) => {
          const z = layers.length - 1 - i;
          layer.entities.forEach(e => { if (e.polygon) e.polygon.zIndex = z; });
        });

        return layers;
      }

      async function loadKmlFromBlob(blob) {
        const url = URL.createObjectURL(blob);
        try {
          return await Cesium.KmlDataSource.load(url, {
            camera: viewer.scene.camera,
            canvas: viewer.scene.canvas,
            clampToGround: true,
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      }

      async function addKmlOverlay(file) {
        const name = file.name.replace(/\.(kml|kmz)$/i, '');
        const mimeType = file.name.toLowerCase().endsWith('.kmz')
          ? 'application/vnd.google-earth.kmz'
          : 'application/vnd.google-earth.kml+xml';
        let dataSource;
        try {
          dataSource = await loadKmlFromBlob(file);
        } catch (err) {
          setStatus('Failed to load KML: ' + (err.message || err));
          console.error('[KML]', err);
          return;
        }
        viewer.dataSources.add(dataSource);
        const fileBase64 = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result.split(',')[1]);
          reader.readAsDataURL(file);
        });
        const id = nextKmlId++;
        const layers = extractKmlLayers(dataSource);
        layers.forEach(setupKmlLayerCallbacks);
        kmlOverlays.push({ id, name, fileBase64, mimeType, dataSource, visible: true, layers });
        tracks['kml_' + id] = { id: 'kml_' + id, label: name, category: 'kml', color: '#ffaa00', h: 22, keyframes: [] };
        selectedTrackIds.add('kml_' + id);
        tlBuildLabels();
        tlDraw();
        renderKmlList();
        viewer.flyTo(dataSource).catch(() => {});
      }

      function removeKmlOverlay(id) {
        const idx = kmlOverlays.findIndex(k => k.id === id);
        if (idx === -1) return;
        viewer.dataSources.remove(kmlOverlays[idx].dataSource, true);
        kmlOverlays.splice(idx, 1);
        delete tracks['kml_' + id];
        selectedTrackIds.delete('kml_' + id);
        tlBuildLabels();
        tlDraw();
        renderKmlList();
      }

      function setKmlVisible(id, visible) {
        const kml = kmlOverlays.find(k => k.id === id);
        if (!kml) return;
        kml.visible = visible;
        kml.dataSource.show = visible;
      }

      function renderKmlList() {
        const list = document.getElementById('kmlList');
        list.innerHTML = '';
        kmlOverlays.forEach(kml => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'border-bottom:1px solid #eee;padding:3px 0;';

          // Header row: visibility, name, fly-to, delete
          const header = document.createElement('div');
          header.style.cssText = 'display:flex;align-items:center;gap:4px;';
          header.innerHTML = `
            <input type="checkbox" ${kml.visible ? 'checked' : ''} data-id="${kml.id}" class="kml-vis" style="margin:0;flex-shrink:0;">
            <span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;" title="${kml.name}">${kml.name}</span>
            <button data-id="${kml.id}" class="kml-zoom" title="Fly to" style="font-size:10px;padding:1px 5px;width:auto;">⊕</button>
            <button data-id="${kml.id}" class="kml-del" title="Remove" style="font-size:10px;padding:1px 5px;width:auto;color:#c00;border-color:#c00;">✕</button>
          `;
          wrap.appendChild(header);

          // Per-layer opacity rows (shown when file has named layers)
          const showLayers = kml.layers.length > 1 || (kml.layers.length === 1 && kml.layers[0].name !== null);
          if (showLayers) {
            kml.layers.forEach((layer, li) => {
              const layerRow = document.createElement('div');
              layerRow.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 0 2px 14px;';
              layerRow.innerHTML = `
                <span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px;color:#555;"
                      title="${layer.name || ''}">${layer.name || 'Layer'}</span>
                <input type="range" min="0" max="1" step="0.01" value="${layer.opacity.toFixed(2)}"
                       data-kid="${kml.id}" data-li="${li}" class="kml-layer-opacity"
                       style="width:60px;height:14px;margin:0;">
                <span class="kml-layer-pct" style="font-size:10px;width:26px;text-align:right;">${Math.round(layer.opacity * 100)}%</span>
              `;
              wrap.appendChild(layerRow);
            });
          }

          list.appendChild(wrap);
        });

        list.querySelectorAll('.kml-vis').forEach(cb =>
          cb.addEventListener('change', e => setKmlVisible(+e.target.dataset.id, e.target.checked)));
        list.querySelectorAll('.kml-zoom').forEach(btn =>
          btn.addEventListener('click', e => {
            const kml = kmlOverlays.find(k => k.id === +e.target.dataset.id);
            if (kml) viewer.flyTo(kml.dataSource).catch(() => {});
          }));
        list.querySelectorAll('.kml-del').forEach(btn =>
          btn.addEventListener('click', e => removeKmlOverlay(+e.target.dataset.id)));
        list.querySelectorAll('.kml-layer-opacity').forEach(slider =>
          slider.addEventListener('input', e => {
            const kml = kmlOverlays.find(k => k.id === +e.target.dataset.kid);
            const layer = kml?.layers[+e.target.dataset.li];
            if (!layer) return;
            applyKmlLayerOpacity(layer, +e.target.value);
            const pct = e.target.closest('div').querySelector('.kml-layer-pct');
            if (pct) pct.textContent = Math.round(+e.target.value * 100) + '%';
          }));
      }

      // ── Image Overlays ───────────────────────────────────────────────────────
      let imageOverlays = []; // { id, name, url, west, south, east, north, layer, opacity, visible }
      let nextImageOverlayId = 1;

      function addImageOverlay({ url, name, west, south, east, north, opacity = 1.0 }) {
        const rect = Cesium.Rectangle.fromDegrees(west, south, east, north);
        const provider = new Cesium.SingleTileImageryProvider({ url, rectangle: rect });
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = opacity;
        const overlay = {
          id: nextImageOverlayId++,
          name: name || url.split('/').pop().split('?')[0] || 'Image overlay',
          url, west, south, east, north, layer, opacity, visible: true,
        };
        imageOverlays.push(overlay);
        renderImageOverlayList();
        return overlay;
      }

      function removeImageOverlay(id) {
        const idx = imageOverlays.findIndex(o => o.id === id);
        if (idx < 0) return;
        viewer.imageryLayers.remove(imageOverlays[idx].layer, true);
        imageOverlays.splice(idx, 1);
        renderImageOverlayList();
      }

      function renderImageOverlayList() {
        const list = document.getElementById('imageOverlayList');
        list.innerHTML = '';
        for (const o of imageOverlays) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;font-size:11px;';

          const vis = document.createElement('input');
          vis.type = 'checkbox'; vis.checked = o.visible; vis.title = 'Toggle visibility';
          vis.addEventListener('change', () => {
            o.visible = vis.checked;
            o.layer.show = o.visible;
          });

          const label = document.createElement('span');
          label.textContent = o.name;
          label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          label.title = o.url;

          const opSlider = document.createElement('input');
          opSlider.type = 'range'; opSlider.min = 0; opSlider.max = 100;
          opSlider.value = Math.round(o.opacity * 100);
          opSlider.style.cssText = 'width:60px;';
          opSlider.title = 'Opacity';
          opSlider.addEventListener('input', () => {
            o.opacity = opSlider.value / 100;
            o.layer.alpha = o.opacity;
          });

          const zoomBtn = document.createElement('button');
          zoomBtn.textContent = '⊙'; zoomBtn.title = 'Zoom to overlay';
          zoomBtn.style.cssText = 'padding:1px 4px;font-size:12px;';
          zoomBtn.addEventListener('click', () => {
            viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(o.west, o.south, o.east, o.north) });
          });

          const delBtn = document.createElement('button');
          delBtn.textContent = '✕'; delBtn.title = 'Remove overlay';
          delBtn.style.cssText = 'padding:1px 4px;color:#c00;';
          delBtn.addEventListener('click', () => removeImageOverlay(o.id));

          row.append(vis, label, opSlider, zoomBtn, delBtn);
          list.appendChild(row);
        }
      }

      // Form wiring
      document.getElementById('addImageOverlayBtn').addEventListener('click', () => {
        document.getElementById('imageOverlayForm').style.display = '';
        document.getElementById('addImageOverlayBtn').style.display = 'none';
      });
      document.getElementById('ioAddCancelBtn').addEventListener('click', () => {
        document.getElementById('imageOverlayForm').style.display = 'none';
        document.getElementById('addImageOverlayBtn').style.display = '';
      });
      document.getElementById('ioAddConfirmBtn').addEventListener('click', () => {
        const url   = document.getElementById('ioUrlInput').value.trim();
        if (!url) return;
        const north = parseFloat(document.getElementById('ioNorth').value) || 90;
        const south = parseFloat(document.getElementById('ioSouth').value) || -90;
        const west  = parseFloat(document.getElementById('ioWest').value)  || -180;
        const east  = parseFloat(document.getElementById('ioEast').value)  || 180;
        const name  = document.getElementById('ioNameInput').value.trim();
        addImageOverlay({ url, name, west, south, east, north });
        // Reset form
        ['ioUrlInput','ioNorth','ioSouth','ioWest','ioEast','ioNameInput'].forEach(id => {
          document.getElementById(id).value = '';
        });
        document.getElementById('imageOverlayForm').style.display = 'none';
        document.getElementById('addImageOverlayBtn').style.display = '';
      });

      document.getElementById('addKmlBtn').addEventListener('click', () => document.getElementById('kmlFileInput').click());
      document.getElementById('kmlFileInput').addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        e.target.value = '';
        await addKmlOverlay(file);
      });

      // ── Time of day ─────────────────────────────────────────────────────────
      document.getElementById("todSlider").addEventListener("input", (e) => {
        const minutes = parseInt(e.target.value);
        document.getElementById("todDisplay").textContent = todMinutesToDisplay(minutes);
        setTimeOfDay(minutes);
      });

      document.getElementById("nightDarknessOn").addEventListener("click",  () => setNightDarkness(true));
      document.getElementById("nightDarknessOff").addEventListener("click", () => setNightDarkness(false));

      document.getElementById("addKeyframeBtn").addEventListener("click", addKeyframe);
      document.getElementById("tlAddKfBtn").addEventListener("click", addKeyframe);

      document.getElementById("totalDuration").addEventListener("change", () => {
        updateProgressUI(playbackT);
      });

      document.getElementById("playBtn").addEventListener("click", () => {
        if (isPlaying && playbackDirection > 0) pausePlayback(); else startPlayback();
      });
      document.getElementById("stopBtn").addEventListener("click", stopPlayback);

      document.getElementById("tlRevBtn").addEventListener("click", () => {
        if (isPlaying && playbackDirection < 0) pausePlayback(); else startReverse();
      });
      document.getElementById("tlPlayBtn").addEventListener("click", () => {
        if (isPlaying && playbackDirection > 0) pausePlayback(); else startPlayback();
      });
      document.getElementById("tlStopBtn").addEventListener("click", stopPlayback);

      document.getElementById("progressBar").addEventListener("click", (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        playbackT = ratio * totalDuration();
        playStartT  = playbackT;
        playStartMs = performance.now();
        syncSceneModeToTime(playbackT);
        const state = buildStateAtTime(playbackT);
        setCameraState(state);
        updateProgressUI(playbackT);
      });

      document.getElementById("exportBtn").addEventListener("click", exportFrames);
      document.getElementById("exportAeNullsBtn").addEventListener("click", exportAENulls);

      // WYSIWYG preview: resize the viewport immediately when resolution changes
      document.getElementById("resolutionSelect").addEventListener("change", (e) => {
        if (!viewer) return;
        const [w, h] = e.target.value.split("x").map(Number);
        setViewerResolution(w, h);
      });

      // ── Timeline ─────────────────────────────────────────────────────────────

      const TL_RULER_H = 24;

      function tlGetSubRows(track) {
        if (track.category === 'highlight') return [
          { id:track.id+'/fill',    parentId:track.id, label:'Fill',    prop:'fillOpacity',    h:14, isSub:true, color:track.color,
            getValue: t => interpolateTrack(track.id, t)?.fillOpacity    ?? 0 },
          { id:track.id+'/outline', parentId:track.id, label:'Outline', prop:'outlineOpacity', h:14, isSub:true, color:track.color,
            getValue: t => interpolateTrack(track.id, t)?.outlineOpacity ?? 0 },
        ];
        if (track.category === 'group') {
          const subs = [
            { id:track.id+'/fill', parentId:track.id, label:'Fill', prop:'fillOpacity', h:14, isSub:true, color:track.color,
              getValue: t => interpolateTrack(track.id, t)?.fillOpacity ?? 0 },
          ];
          const g = regionGroups.find(g => 'group_'+g.id === track.id);
          if (g) {
            for (const member of g.members) {
              const tid = `gmember_${g.id}_${member.key}`;
              if (tracks[tid]) subs.push(tracks[tid]);
            }
          }
          return subs;
        }
        if (track.category === 'route') return [
          { id:track.id+'/start', parentId:track.id, label:'Start%', prop:'routeStart', h:14, isSub:true, color:track.color,
            getValue: t => (interpolateTrack(track.id, t)?.routeStart ?? 0) / 100 },
          { id:track.id+'/end',   parentId:track.id, label:'End%',   prop:'routeEnd',   h:14, isSub:true, color:track.color,
            getValue: t => (interpolateTrack(track.id, t)?.routeEnd ?? 100) / 100 },
        ];
        if (track.category === 'city') return [
          { id:track.id+'/dot',          parentId:track.id, label:'Dot Size',    prop:'dotSize',      h:14, isSub:true, color:track.color,
            getValue: t => { const s = interpolateTrack(track.id, t); return s ? Math.min(1, s.dotSize / 16) : 0; } },
          { id:track.id+'/dotOpacity',   parentId:track.id, label:'Dot Opacity', prop:'dotOpacity',   h:14, isSub:true, color:track.color,
            getValue: t => interpolateTrack(track.id, t)?.dotOpacity   ?? 1 },
          { id:track.id+'/labelOpacity', parentId:track.id, label:'Lbl Opacity', prop:'labelOpacity', h:14, isSub:true, color:track.color,
            getValue: t => interpolateTrack(track.id, t)?.labelOpacity ?? 1 },
          { id:track.id+'/fontSize',     parentId:track.id, label:'Font Size',   prop:'fontSize',     h:14, isSub:true, color:track.color,
            getValue: t => { const s = interpolateTrack(track.id, t); return s ? Math.min(1, s.fontSize / 30) : 0; } },
        ];
        return [];
      }

      function tlGetRows() {
        const rows = [];
        for (const id of ['camera', 'tod', 'borders']) {
          if (tracks[id]) rows.push(tracks[id]);
        }
        const addEntity = (track) => {
          if (!track) return;
          rows.push(track);
          if (!track.collapsed) for (const sub of tlGetSubRows(track)) rows.push(sub);
        };
        for (const h of highlights)      addEntity(tracks['hl_'+h.key]);
        for (const g of regionGroups)   addEntity(tracks['group_'+g.id]);
        for (const m of cityMarkers)    addEntity(tracks['city_'+m.id]);
        for (const g of cityRouteGroups) addEntity(tracks['route_'+g.id]);
        for (const k of kmlOverlays)    addEntity(tracks['kml_'+k.id]);
        for (const a of annotations)    addEntity(tracks['ann_'+a.id]);
        return rows;
      }
      function tlTotalH() { return tlGetRows().reduce((s, r) => s + r.h, 0); }

      const SCENE_SEG_COLORS = { '3d': '#1a3a5c', 'columbus': '#3a1a5c', '2d': '#1a5c3a' };

      let tlOpen        = true;
      let tlZoom        = 80;   // px/sec
      let tlScroll      = 0;    // px from timeline start
      let tlDrag        = null; // { type, trackId?, kfId?, startX, startT, startScroll }
      let tlSelectedKf  = null; // { trackId, kfId } — keyframe selected in timeline

      function tlTimeToX(t)  { return t * tlZoom - tlScroll; }
      function tlXToTime(x)  { return (x + tlScroll) / tlZoom; }

      function tlTickInterval(visSecs) {
        const targets = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
        const ideal = visSecs / 7;
        return targets.find(c => c >= ideal) || 600;
      }

      function tlFormatTime(s) {
        if (s < 60)  return s % 1 === 0 ? s + 's' : s.toFixed(1) + 's';
        const m = Math.floor(s / 60), sec = Math.round(s % 60);
        return `${m}:${String(sec).padStart(2, '0')}`;
      }

      function tlDrawRuler() {
        const canvas = document.getElementById('tlRulerCanvas');
        if (!canvas) return;
        const wrap = document.getElementById('tlCanvasWrap');
        const W = wrap ? wrap.clientWidth : 200;
        if (canvas.width !== W || canvas.height !== TL_RULER_H) {
          canvas.width  = W;
          canvas.height = TL_RULER_H;
        }
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#252527';
        ctx.fillRect(0, 0, W, TL_RULER_H);

        const visSecs  = W / tlZoom;
        const interval = tlTickInterval(visSecs);
        const startT   = Math.floor(tlXToTime(0) / interval) * interval;
        ctx.font = '10px Arial';
        for (let t = startT; t < startT + visSecs + interval * 2; t += interval) {
          const x = Math.round(tlTimeToX(t));
          if (x < -60 || x > W + 4) continue;
          ctx.strokeStyle = '#4a4a4e';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x + 0.5, TL_RULER_H - 5); ctx.lineTo(x + 0.5, TL_RULER_H); ctx.stroke();
          if (x > 0) {
            ctx.fillStyle = '#999';
            ctx.textAlign = 'left';
            ctx.fillText(tlFormatTime(Math.max(0, t)), x + 3, TL_RULER_H - 6);
          }
          const half = interval / 2;
          const hx = Math.round(tlTimeToX(t + half));
          if (hx > 0 && hx < W) {
            ctx.strokeStyle = '#333';
            ctx.beginPath(); ctx.moveTo(hx + 0.5, TL_RULER_H - 3); ctx.lineTo(hx + 0.5, TL_RULER_H); ctx.stroke();
          }
        }
        // Playhead triangle
        const px = Math.round(tlTimeToX(playbackT));
        if (px >= -1 && px <= W + 1) {
          ctx.fillStyle = '#ff3b30';
          ctx.beginPath();
          ctx.moveTo(px - 5, 0);
          ctx.lineTo(px + 5, 0);
          ctx.lineTo(px,     9);
          ctx.closePath();
          ctx.fill();
        }
      }

      function tlBuildLabels() {
        const panel = document.getElementById('tlLabels');
        [...panel.querySelectorAll('.tl-lbl')].forEach(el => el.remove());
        for (const row of tlGetRows()) {
          const d = document.createElement('div');
          d.style.height = row.h + 'px';
          if (row.isSub && row.isRealTrack) {
            d.className = 'tl-lbl tl-lbl-sub tl-lbl-member' + (selectedTrackIds.has(row.id) ? ' tl-lbl-sel' : '');
            d.dataset.trackId = row.id;
            const dot = document.createElement('span');
            dot.className = 'tl-sel-dot';
            dot.style.background = row.color;
            const lbl = document.createElement('span');
            lbl.textContent = row.label;
            d.append(dot, lbl);
            d.title = 'Click to toggle keyframe capture for this member';
            d.addEventListener('click', () => {
              if (selectedTrackIds.has(row.id)) selectedTrackIds.delete(row.id);
              else selectedTrackIds.add(row.id);
              tlBuildLabels();
              renderGroupList();
            });
          } else if (row.isSub) {
            d.className = 'tl-lbl tl-lbl-sub';
            const lbl = document.createElement('span');
            lbl.textContent = row.label;
            d.appendChild(lbl);
          } else {
            d.className = 'tl-lbl' + (selectedTrackIds.has(row.id) ? ' tl-lbl-sel' : '');
            d.dataset.trackId = row.id;
            const subs = tlGetSubRows(row);
            if (subs.length > 0) {
              const toggle = document.createElement('span');
              toggle.className = 'tl-collapse-btn';
              toggle.textContent = row.collapsed ? '▶' : '▼';
              toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                row.collapsed = !row.collapsed;
                tlBuildLabels();
              });
              d.appendChild(toggle);
            }
            const dot = document.createElement('span');
            dot.className = 'tl-sel-dot';
            dot.style.background = row.color;
            d.appendChild(dot);
            const lbl = document.createElement('span');
            lbl.textContent = row.label;
            d.appendChild(lbl);
            d.title = 'Click to toggle keyframe capture; ▶/▼ to expand sub-tracks';
            d.addEventListener('click', () => {
              if (selectedTrackIds.has(row.id)) selectedTrackIds.delete(row.id);
              else selectedTrackIds.add(row.id);
              tlBuildLabels();
            });
          }
          panel.appendChild(d);
        }
      }

      function tlDraw() {
        const canvas = document.getElementById('tlCanvas');
        if (!canvas) return;
        const wrap = document.getElementById('tlCanvasWrap');
        const W = wrap ? wrap.clientWidth : canvas.width;
        const H = tlTotalH();
        if (canvas.width !== W || canvas.height !== H) {
          canvas.width  = W;
          canvas.height = H;
        }
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#1c1c1e';
        ctx.fillRect(0, 0, W, H);

        // Duration end-marker
        const dur = totalDuration();
        if (dur > 0) {
          const ex = Math.round(tlTimeToX(dur));
          if (ex >= 0 && ex <= W) {
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(ex + 0.5, 0); ctx.lineTo(ex + 0.5, H); ctx.stroke();
            ctx.setLineDash([]);
          }
        }

        // ── Tracks ─────────────────────────────────────────────────────────
        let y = 0;
        for (const row of tlGetRows()) {
          ctx.fillStyle = '#252527';
          ctx.fillRect(0, y, W, row.h);
          ctx.fillStyle = '#2e2e30';
          ctx.fillRect(0, y + row.h - 1, W, 1);
          if (selectedTrackIds.has(row.id)) {
            ctx.fillStyle = 'rgba(74,158,255,0.07)';
            ctx.fillRect(0, y, W, row.h - 1);
          }
          if (row.isSub && !row.isRealTrack) tlDrawSubRow(ctx, row, y, row.h, W);
          else if (row.isSub && row.isRealTrack) tlDrawGenericTrack(ctx, row, y, row.h, W);
          else if (row.id === 'camera')  tlDrawCameraTrack(ctx, y, row.h, W);
          else if (row.id === 'tod') tlDrawTodTrack(ctx, y, row.h, W);
          else                       tlDrawGenericTrack(ctx, row, y, row.h, W);
          y += row.h;
        }

        // ── Playhead line ──────────────────────────────────────────────────
        const px = Math.round(tlTimeToX(playbackT));
        if (px >= -1 && px <= W + 1) {
          ctx.strokeStyle = 'rgba(255,59,48,0.9)';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(px + 0.5, 0); ctx.lineTo(px + 0.5, H); ctx.stroke();
        }

        tlDrawRuler();

        // Update time display
        const tlTime = document.getElementById('tlCurrentTime');
        if (tlTime) tlTime.textContent = tlFormatTime(playbackT);
      }

      function tlDrawSubRow(ctx, row, y, h, W) {
        const parent = tracks[row.parentId];
        ctx.fillStyle = '#1e1e20';
        ctx.fillRect(0, y, W, h);
        if (!parent || parent.keyframes.length === 0) return;

        const kfs = parent.keyframes;
        const x1 = Math.max(0, tlTimeToX(kfs[0].time));
        const x2 = Math.min(W, tlTimeToX(kfs[kfs.length - 1].time));
        if (x2 <= x1) return;

        // Sample property value and draw vertical bars forming a waveform
        const steps = Math.max(2, Math.min(Math.round(x2 - x1), 180));
        const barW  = Math.ceil((x2 - x1) / steps) + 1;
        const usableH = h - 4;
        for (let i = 0; i <= steps; i++) {
          const px = x1 + (x2 - x1) * i / steps;
          const val = Math.max(0, Math.min(1, row.getValue(tlXToTime(px))));
          const barH = Math.max(1, Math.round(usableH * val));
          ctx.fillStyle = row.color + (val > 0.01 ? '88' : '22');
          ctx.fillRect(Math.floor(px), y + h - 2 - barH, barW, barH);
        }

        // Thin tick at each parent keyframe time
        for (const kf of kfs) {
          const x = Math.round(tlTimeToX(kf.time));
          if (x < 0 || x > W) continue;
          ctx.fillStyle = '#ffffff44';
          ctx.fillRect(x, y + 1, 1, h - 2);
        }
      }

      function tlDrawCameraTrack(ctx, y, h, W) {
        const camKfs = tracks['camera']?.keyframes || [];
        if (camKfs.length === 0) return;
        const cy = y + h / 2;

        // Bar connecting first and last keyframe
        if (camKfs.length > 1) {
          const x1 = Math.max(0, tlTimeToX(camKfs[0].time));
          const x2 = Math.min(W, tlTimeToX(camKfs[camKfs.length - 1].time));
          ctx.fillStyle = '#2a4a6a';
          ctx.fillRect(x1, cy - 2, x2 - x1, 4);
        }

        // Scene mode band — thin 4px bar at the bottom of the camera row
        const dur = Math.max(totalDuration(), tlXToTime(W) + 1);
        for (let i = 0; i < camKfs.length; i++) {
          const kf     = camKfs[i];
          const mode   = kf.sceneMode || '3d';
          const startT = kf.time;
          const endT   = i < camKfs.length - 1 ? camKfs[i + 1].time : dur;
          const x1 = Math.max(0, tlTimeToX(startT));
          const x2 = Math.min(W, tlTimeToX(endT));
          if (x2 <= x1) continue;
          ctx.fillStyle = SCENE_SEG_COLORS[mode] || SCENE_SEG_COLORS['3d'];
          ctx.fillRect(x1, y + h - 5, x2 - x1, 4);
          if (x2 - x1 > 22) {
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.font = '9px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(SCENE_MODE_LABELS[mode] || '3D', x1 + 4, y + h - 7);
          }
        }

        // Keyframe diamonds
        for (const kf of camKfs) {
          const x = tlTimeToX(kf.time);
          if (x < -12 || x > W + 12) continue;
          const tlSel = tlSelectedKf?.trackId === 'camera' && tlSelectedKf?.kfId === kf.id;
          const sel   = kf.id === selectedKfId || tlSel;
          const size  = sel ? 9 : 7;
          ctx.save();
          ctx.translate(x, cy);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle   = sel ? '#ffffff' : '#4a9eff';
          ctx.strokeStyle = sel ? '#4a9eff' : '#1a5a9f';
          ctx.lineWidth   = 1.5;
          ctx.beginPath(); ctx.rect(-size / 2, -size / 2, size, size);
          ctx.fill(); ctx.stroke();
          ctx.restore();
          if (kf.ease && kf.ease !== 'linear') {
            ctx.fillStyle = '#ffdd44';
            ctx.beginPath(); ctx.arc(x, cy + size / 2 + 3, 2, 0, Math.PI * 2); ctx.fill();
          }
        }
      }

      function tlDrawTodTrack(ctx, y, h, W) {
        const todKfs = tracks['tod']?.keyframes || [];
        if (todKfs.length < 2) return;
        const dur = totalDuration();
        if (dur <= 0) return;
        const steps = Math.min(W, 200);
        for (let i = 0; i < steps; i++) {
          const t = tlXToTime(i * W / steps);
          if (t < 0 || t > dur) continue;
          const todState = interpolateTrack('tod', t);
          if (!todState) continue;
          const tod = (todState.todMinutes ?? 720) / 1440;
          const b = 0.1 + 0.75 * Math.sin(Math.PI * tod);
          ctx.fillStyle = `rgb(${Math.round(b*60+10)},${Math.round(b*110+15)},${Math.round(b*190+35)})`;
          ctx.fillRect(Math.floor(i * W / steps), y + 3, Math.ceil(W / steps) + 1, h - 6);
        }
        for (const kf of todKfs) {
          const x = tlTimeToX(kf.time);
          if (x < -10 || x > W + 10) continue;
          const cy = y + h / 2;
          const sel = tlSelectedKf?.trackId === 'tod' && tlSelectedKf?.kfId === kf.id;
          ctx.save(); ctx.translate(x, cy); ctx.rotate(Math.PI / 4);
          ctx.fillStyle = sel ? '#ffffff' : '#ffaa44';
          ctx.strokeStyle = sel ? '#ffaa44' : '#885500';
          ctx.lineWidth = sel ? 2 : 1.5;
          ctx.beginPath(); ctx.rect(sel ? -5 : -4, sel ? -5 : -4, sel ? 10 : 8, sel ? 10 : 8);
          ctx.fill(); ctx.stroke();
          ctx.restore();
        }
      }

      function tlDrawGenericTrack(ctx, row, y, h, W) {
        const kfs = row.keyframes;
        if (kfs.length === 0) return;
        const cy = y + h / 2;
        if (kfs.length > 1) {
          const x1 = Math.max(0, tlTimeToX(kfs[0].time));
          const x2 = Math.min(W, tlTimeToX(kfs[kfs.length-1].time));
          ctx.fillStyle = row.color + '44';
          ctx.fillRect(x1, cy - 2, x2 - x1, 4);
        }
        for (const kf of kfs) {
          const x = tlTimeToX(kf.time);
          if (x < -10 || x > W + 10) continue;
          const sel  = tlSelectedKf?.trackId === row.id && tlSelectedKf?.kfId === kf.id;
          const size = sel ? 8 : 6;
          ctx.save(); ctx.translate(x, cy); ctx.rotate(Math.PI / 4);
          ctx.fillStyle   = sel ? '#ffffff' : row.color;
          ctx.strokeStyle = sel ? row.color  : '#00000088';
          ctx.lineWidth   = sel ? 1.5 : 1;
          ctx.beginPath(); ctx.rect(-size/2, -size/2, size, size);
          ctx.fill(); ctx.stroke();
          ctx.restore();
          if (kf.ease && kf.ease !== 'linear') {
            ctx.fillStyle = '#ffdd44';
            ctx.beginPath(); ctx.arc(x, cy + size / 2 + 3, 2, 0, Math.PI * 2); ctx.fill();
          }
        }
      }

      // ── Timeline mouse / wheel ──────────────────────────────────────────
      function tlInitEvents() {
        const canvas = document.getElementById('tlCanvas');
        const rulerCanvas = document.getElementById('tlRulerCanvas');

        // Ruler: click to seek, drag playhead
        rulerCanvas.addEventListener('mousedown', (e) => {
          const rect = rulerCanvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const px = tlTimeToX(playbackT);
          tlSeekTo(Math.max(0, tlXToTime(mx)));
          tlDrag = { type: 'playhead' };
        });
        rulerCanvas.addEventListener('mousemove', (e) => {
          if (!tlDrag || tlDrag.type !== 'playhead') return;
          const rect = rulerCanvas.getBoundingClientRect();
          tlSeekTo(Math.max(0, Math.min(totalDuration(), tlXToTime(e.clientX - rect.left))));
        });
        rulerCanvas.addEventListener('wheel', (e) => {
          e.preventDefault();
          const rect = rulerCanvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const tAtCursor = tlXToTime(mx);
          const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
          tlZoom   = Math.max(8, Math.min(600, tlZoom * factor));
          tlScroll = Math.max(0, tAtCursor * tlZoom - mx);
          document.getElementById('tlZoomLabel').textContent = (tlZoom / 80).toFixed(1) + '×';
        }, { passive: false });

        canvas.addEventListener('mousedown', (e) => {
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;

          // Track hit-test — any track can have keyframes selected/dragged
          const rows = tlGetRows();
          let ty = 0;
          for (const row of rows) {
            if (my >= ty && my < ty + row.h) {
              if (row.isSub && !row.isRealTrack) {
                // Virtual sub-rows (waveform previews): seek only
                tlSeekTo(Math.max(0, tlXToTime(mx)));
                tlDrag = { type: 'playhead' };
              } else {
                const cy = ty + row.h / 2;
                const kfs = row.keyframes || [];
                let hit = null;
                for (const kf of kfs) {
                  if (Math.abs(tlTimeToX(kf.time) - mx) < 8 && Math.abs(cy - my) < 10) { hit = kf; break; }
                }
                if (hit) {
                  tlSelectedKf = { trackId: row.id, kfId: hit.id };
                  tlDrag = { type: 'kf', trackId: row.id, kfId: hit.id, startX: mx, startT: hit.time };
                  tlSeekTo(hit.time);
                  if (row.id === 'camera') { selectedKfId = hit.id; renderKeyframeList(); }
                  updateEaseBar();
                } else {
                  tlSelectedKf = null;
                  updateEaseBar();
                  tlSeekTo(Math.max(0, tlXToTime(mx)));
                  tlDrag = { type: 'playhead' };
                }
              }
              break;
            }
            ty += row.h;
          }
        });

        canvas.addEventListener('mousemove', (e) => {
          if (!tlDrag) return;
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;

          if (tlDrag.type === 'playhead') {
            tlSeekTo(Math.max(0, Math.min(totalDuration(), tlXToTime(mx))));
          } else if (tlDrag.type === 'kf') {
            const track = tracks[tlDrag.trackId];
            const kf = track?.keyframes.find(k => k.id === tlDrag.kfId);
            if (kf) {
              kf.time = Math.max(0, parseFloat((tlDrag.startT + (mx - tlDrag.startX) / tlZoom).toFixed(2)));
              track.keyframes.sort((a, b) => a.time - b.time);
              playbackT = kf.time;
              playStartT = kf.time;
              updateProgressUI(kf.time);
              if (tlDrag.trackId === 'camera') renderKeyframeList();
            }
          } else if (tlDrag.type === 'pan') {
            tlScroll = Math.max(0, tlDrag.startScroll - (mx - tlDrag.startX));
          }
        });

        window.addEventListener('mouseup', () => { tlDrag = null; });

        canvas.addEventListener('wheel', (e) => {
          e.preventDefault();
          const rect = canvas.getBoundingClientRect();
          const mx   = e.clientX - rect.left;
          const tAtCursor = tlXToTime(mx);
          const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
          tlZoom   = Math.max(8, Math.min(600, tlZoom * factor));
          tlScroll = Math.max(0, tAtCursor * tlZoom - mx);
          document.getElementById('tlZoomLabel').textContent = (tlZoom / 80).toFixed(1) + '×';
        }, { passive: false });
      }

      function tlSeekTo(t) {
        playbackT  = t;
        playStartT = t;
        syncSceneModeToTime(t);
        const state = buildStateAtTime(t);
        setCameraState(state);
        updateProgressUI(t);
      }

      function tlFitView() {
        const dur = totalDuration();
        if (dur <= 0) return;
        const wrap = document.getElementById('tlCanvasWrap');
        const W = wrap ? wrap.clientWidth : 600;
        tlZoom   = Math.max(8, (W - 20) / dur);
        tlScroll = 0;
        document.getElementById('tlZoomLabel').textContent = (tlZoom / 80).toFixed(1) + '×';
      }

      function tlSetOpen(open) {
        tlOpen = open;
        document.getElementById('tlBody').style.display = open ? 'flex' : 'none';
        document.getElementById('tlToggleBtn').textContent = (open ? '▾' : '▸') + ' Timeline';
      }

      // Continuous redraw loop for smooth playhead
      function tlRenderLoop() {
        if (tlOpen) tlDraw();
        requestAnimationFrame(tlRenderLoop);
      }

      // ── Timeline resize handle ───────────────────────────────────────────────
      (() => {
        const handle = document.getElementById('tlResizeHandle');
        const footer = document.getElementById('tlFooter');
        let resizing = false, startY = 0, startH = 0;

        handle.addEventListener('mousedown', (e) => {
          resizing = true;
          startY = e.clientY;
          startH = footer.getBoundingClientRect().height;
          handle.classList.add('dragging');
          e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
          if (!resizing) return;
          const delta  = startY - e.clientY; // drag up = positive delta = taller
          const minH   = 33; // just the bar
          const maxH   = Math.round(window.innerHeight * 0.7);
          footer.style.height = Math.max(minH, Math.min(maxH, startH + delta)) + 'px';
        });

        window.addEventListener('mouseup', () => {
          if (!resizing) return;
          resizing = false;
          handle.classList.remove('dragging');
        });
      })();

      // ── Timeline button wiring ───────────────────────────────────────────────
      document.getElementById('tlToggleBtn').addEventListener('click', () => tlSetOpen(!tlOpen));
      document.getElementById('tlZoomIn').addEventListener('click', () => {
        tlZoom = Math.min(600, tlZoom * 1.4);
        document.getElementById('tlZoomLabel').textContent = (tlZoom / 80).toFixed(1) + '×';
      });
      document.getElementById('tlZoomOut').addEventListener('click', () => {
        tlZoom = Math.max(8, tlZoom / 1.4);
        document.getElementById('tlZoomLabel').textContent = (tlZoom / 80).toFixed(1) + '×';
      });
      document.getElementById('tlFitBtn').addEventListener('click', tlFitView);
      // Delete selected timeline keyframe with Delete or Backspace (when not editing an input)
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (tlSelectedKf) {
          deleteTrackKeyframe(tlSelectedKf.trackId, tlSelectedKf.kfId);
          e.preventDefault();
        }
      });

      // JKL transport shortcuts
      document.addEventListener('keydown', (e) => {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key === 'j' || e.key === 'J') {
          if (isPlaying && playbackDirection < 0) pausePlayback(); else startReverse();
          e.preventDefault();
        } else if (e.key === 'k' || e.key === 'K') {
          if (isPlaying) pausePlayback();
          e.preventDefault();
        } else if (e.key === 'l' || e.key === 'L') {
          if (isPlaying && playbackDirection > 0) pausePlayback(); else startPlayback();
          e.preventDefault();
        }
      });

      document.getElementById('tlSelectAll').addEventListener('click', () => {
        for (const row of tlGetRows()) if (!row.isSub || row.isRealTrack) selectedTrackIds.add(row.id);
        tlBuildLabels();
      });
      document.getElementById('tlSelectNone').addEventListener('click', () => {
        selectedTrackIds.clear();
        tlBuildLabels();
      });

      // ── Project Save / Load ──────────────────────────────────────────────────
      function promptFilename(defaultValue) {
        return new Promise((resolve) => {
          const overlay  = document.getElementById('modalOverlay');
          const input    = document.getElementById('modalInput');
          const confirm  = document.getElementById('modalConfirmBtn');
          const cancel   = document.getElementById('modalCancelBtn');

          input.value = defaultValue;
          overlay.classList.add('open');
          input.focus();
          input.select();

          function finish(value) {
            overlay.classList.remove('open');
            confirm.removeEventListener('click', onConfirm);
            cancel.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKey);
            resolve(value);
          }

          function onConfirm() { finish(input.value); }
          function onCancel()  { finish(null); }
          function onKey(e) {
            if (e.key === 'Enter')  { e.preventDefault(); finish(input.value); }
            if (e.key === 'Escape') { e.preventDefault(); finish(null); }
          }

          confirm.addEventListener('click', onConfirm);
          cancel.addEventListener('click', onCancel);
          input.addEventListener('keydown', onKey);
        });
      }

      function buildProjectJson() {
        return {
          version: 1,
          totalDuration: totalDuration(),
          playbackT,
          currentBasemap,
          basemapShowLabels,
          basemapMaxLevelOverride,
          bmAdjust: { ...bmAdjust },
          nightDarkness: nightDarknessEnabled,
          borders: {
            countryOpacity: parseInt(document.getElementById('countryBorderOpacity').value) / 100,
            stateOpacity:   parseInt(document.getElementById('stateBorderOpacity').value) / 100,
            countyOpacity:  parseInt(document.getElementById('countyBorderOpacity').value) / 100,
            countyFilter,
            borderColor,
            landOnly: bordersLandOnly,
          },
          defaults: {
            regionColor: defaultRegionColor,
            cityColor:   defaultCityColor,
            cityDotSize: defaultCityDotSize,
          },
          highlights: highlights.map(h => ({
            key: h.key, name: h.name, type: h.type, color: h.color,
            outlineOpacity: h.outlineOpacity, outlineWidth: h.outlineWidth,
            subregionOpacity: h.subregionOpacity, subregionWidth: h.subregionWidth,
            fillOpacity: h.fillOpacity, invert: h.invert,
            showLabel: h.showLabel, labelText: h.labelText, labelColor: h.labelColor,
            labelFontSize: h.labelFontSize, labelFontWeight: h.labelFontWeight,
            labelFontFamily: h.labelFontFamily, labelOffsetX: h.labelOffsetX,
            labelOffsetY: h.labelOffsetY, labelOpacity: h.labelOpacity,
          })),
          groups: regionGroups.map(g => ({
            id: g.id, name: g.name, color: g.color,
            fillOpacity: g.fillOpacity, invert: g.invert,
            members: g.members.map(m => ({ key: m.key, name: m.name })),
            _seqStart: g._seqStart, _seqInterval: g._seqInterval,
          })),
          cities: cityMarkers.map(c => ({
            id: c.id, name: c.name, country: c.country, lat: c.lat, lon: c.lon,
            color: c.color, dotSize: c.dotSize, showLabel: c.showLabel,
            labelColor: c.labelColor, fontSize: c.fontSize, fontWeight: c.fontWeight,
            fontStyle: c.fontStyle, fontFamily: c.fontFamily,
            offsetX: c.offsetX, offsetY: c.offsetY, outlineWidth: c.outlineWidth,
            showBackground: c.showBackground, backgroundColor: c.backgroundColor,
            backgroundOpacity: c.backgroundOpacity, bgPadX: c.bgPadX, bgPadY: c.bgPadY,
            dotOpacity: c.dotOpacity, labelOpacity: c.labelOpacity,
          })),
          routes: cityRouteGroups.map(g => ({
            id: g.id, name: g.name, color: g.color,
            lineStyle: g.lineStyle, lineShape: g.lineShape,
            routeStart: g.routeStart, routeEnd: g.routeEnd, width: g.width, visible: g.visible,
            cities: g.cities.map(c => ({ name: c.name, country: c.country, state: c.state, lat: c.lat, lon: c.lon })),
            showCityLabels: g.showCityLabels, labelColor: g.labelColor, labelFontSize: g.labelFontSize,
            labelFontWeight: g.labelFontWeight, labelFontStyle: g.labelFontStyle, labelFontFamily: g.labelFontFamily,
            labelOffsetX: g.labelOffsetX, labelOffsetY: g.labelOffsetY, labelOutlineWidth: g.labelOutlineWidth,
            labelOpacity: g.labelOpacity, labelShowBackground: g.labelShowBackground, labelBgColor: g.labelBgColor,
            labelBgOpacity: g.labelBgOpacity, labelBgPadX: g.labelBgPadX, labelBgPadY: g.labelBgPadY,
            showLabel: g.showLabel, glColor: g.glColor, glFontSize: g.glFontSize, glFontWeight: g.glFontWeight,
            glFontStyle: g.glFontStyle, glFontFamily: g.glFontFamily, glOffsetX: g.glOffsetX, glOffsetY: g.glOffsetY,
            glOutlineWidth: g.glOutlineWidth, glOpacity: g.glOpacity, glShowBackground: g.glShowBackground,
            glBgColor: g.glBgColor, glBgOpacity: g.glBgOpacity, glBgPadX: g.glBgPadX, glBgPadY: g.glBgPadY,
          })),
          nextRouteGroupId,
          tracks: Object.fromEntries(
            Object.entries(tracks).map(([id, t]) => [id, { keyframes: t.keyframes.map(k => ({ ...k })) }])
          ),
          nextKfId,
          nextGroupId,
          nextCityId,
          kmlOverlays: kmlOverlays.map(k => ({
            id: k.id, name: k.name, fileBase64: k.fileBase64, mimeType: k.mimeType, visible: k.visible,
            layerOpacities: k.layers.map(l => ({ name: l.name, opacity: l.opacity })),
          })),
          nextKmlId,
          imageOverlays: imageOverlays.map(o => ({
            id: o.id, name: o.name, url: o.url,
            west: o.west, south: o.south, east: o.east, north: o.north,
            opacity: o.opacity, visible: o.visible,
          })),
          nextImageOverlayId,
          selectedTrackIds: Array.from(selectedTrackIds),
          annotations: annotations.map(a => ({
            id:a.id, text:a.text, type:a.type, anchor:a.anchor,
            offsetX:a.offsetX, offsetY:a.offsetY, lat:a.lat, lon:a.lon,
            leaderLine:a.leaderLine, fontSize:a.fontSize, fontWeight:a.fontWeight,
            fontFamily:a.fontFamily, color:a.color, bgColor:a.bgColor,
            bgOpacity:a.bgOpacity, padding:a.padding, borderRadius:a.borderRadius,
            opacity:a.opacity,
            floatDir:a.floatDir, floatKm:a.floatKm, lineEnd:a.lineEnd, arrowDir:a.arrowDir,
            lineStyle:a.lineStyle, lineWidth:a.lineWidth, showDot:a.showDot, dotSize:a.dotSize,
          })),
          nextAnnotationId,
        };
      }

      async function saveProject() {
        const project = buildProjectJson();
        const defaultName = 'map-animator-project';
        const input = await promptFilename(defaultName);
        if (input === null) return; // cancelled
        const filename = (input.trim() || defaultName).replace(/\.json$/i, '') + '.json';

        const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        setStatus(`Project saved as "${filename}".`);
      }

      async function loadProject(project) {
        if (regionLookup.size === 0) {
          setStatus('Region data not yet loaded — please wait and try again.');
          return;
        }

        // 1. Clear existing entities and state
        [...highlights].forEach(h => removeHighlight(h.key));
        [...regionGroups].forEach(g => deleteGroup(g.id));
        cityMarkers.forEach(c => { if (c.entity) viewer.entities.remove(c.entity); });
        cityMarkers = [];
        nextCityId = 1;
        kmlOverlays.forEach(k => viewer.dataSources.remove(k.dataSource, true));
        kmlOverlays = [];
        nextKmlId = 1;
        annotations.forEach(a => {
          if (a.el) a.el.remove();
          if (a.entity) (Array.isArray(a.entity)?a.entity:[a.entity]).forEach(e=>viewer.entities.remove(e));
        });
        annotations = [];
        nextAnnotationId = 1;
        // Clear routes
        [...cityRouteGroups].forEach(g => deleteCityRouteGroup(g.id));
        nextRouteGroupId  = 1;
        nextRouteColorIdx = 0;
        // Clear all tracks and reset builtins
        Object.keys(tracks).forEach(id => { if (id !== 'camera' && id !== 'tod' && id !== 'borders') delete tracks[id]; });
        tracks['camera'].keyframes  = [];
        tracks['tod'].keyframes     = [];
        tracks['borders'].keyframes = [];
        selectedTrackIds = new Set(['camera']);

        // 2. Duration and playback position
        document.getElementById('totalDuration').value = project.totalDuration ?? 10;
        playbackT  = project.playbackT ?? 0;
        playStartT = playbackT;

        // 3. Basemap + adjustments (reuse applyLook logic)
        basemapShowLabels = project.basemapShowLabels ?? true;
        basemapMaxLevelOverride = project.basemapMaxLevelOverride ?? null;

        // Restore land-only border toggle; reload borders if value changed
        const savedLandOnly = project.borders?.landOnly ?? true;
        const needsBorderReload = savedLandOnly !== bordersLandOnly;
        bordersLandOnly = savedLandOnly;
        document.getElementById('bordersLandOnlyCheck').checked = bordersLandOnly;
        if (needsBorderReload) reloadBorders();

        const look = {
          basemap:    project.currentBasemap ?? 'eox-s2',
          brightness: project.bmAdjust?.brightness ?? 1.0,
          contrast:   project.bmAdjust?.contrast   ?? 1.0,
          saturation: project.bmAdjust?.saturation ?? 1.0,
          hue:        project.bmAdjust?.hue        ?? 0.0,
          gamma:      project.bmAdjust?.gamma      ?? 1.0,
          countryOpacity: project.borders?.countryOpacity ?? 0.7,
          stateOpacity:   project.borders?.stateOpacity   ?? 0.2,
          borderColor:    project.borders?.borderColor ?? '#ffffff',
          regionColor: project.defaults?.regionColor ?? '#ff9900',
          cityColor:   project.defaults?.cityColor   ?? '#ffffff',
          cityDotSize: project.defaults?.cityDotSize ?? 8,
        };
        await applyLook(look);

        // Night darkness
        setNightDarkness(project.nightDarkness ?? true);

        // 4. County border
        const countyPct = Math.round((project.borders?.countyOpacity ?? 0) * 100);
        document.getElementById('countyBorderOpacity').value = countyPct;
        document.getElementById('countyBorderOpacityVal').textContent = countyPct + '%';
        setCountyBorderOpacity(countyPct / 100);
        if (project.borders?.countyFilter) setCountyFilter(project.borders.countyFilter);

        // 5. Highlights
        for (const saved of (project.highlights ?? [])) {
          addHighlight(saved.name);
          const hl = highlights.find(h => h.key === saved.key);
          if (!hl) continue;
          hl.color           = saved.color ?? hl.color;
          hl.outlineOpacity  = saved.outlineOpacity ?? 1.0;
          hl.outlineWidth    = saved.outlineWidth ?? 2.0;
          hl.subregionOpacity = saved.subregionOpacity ?? 0.0;
          hl.subregionWidth  = saved.subregionWidth ?? 1.0;
          hl.fillOpacity     = saved.fillOpacity ?? 0;
          hl.invert          = saved.invert ?? false;
          hl.labelText       = saved.labelText ?? saved.name.split(' (')[0];
          hl.labelColor      = saved.labelColor ?? saved.color ?? hl.color;
          hl.labelFontSize   = saved.labelFontSize ?? 14;
          hl.labelFontWeight = saved.labelFontWeight ?? 'normal';
          hl.labelFontFamily = saved.labelFontFamily ?? 'Arial';
          hl.labelOffsetX    = saved.labelOffsetX ?? 0;
          hl.labelOffsetY    = saved.labelOffsetY ?? 0;
          hl.labelOpacity    = saved.labelOpacity ?? 1.0;
          if (tracks['hl_' + saved.key]) tracks['hl_' + saved.key].color = saved.color ?? hl.color;
          refreshOutlineEntities(hl);
          refreshSubregionEntities(hl);
          setFillOpacity(saved.key, hl.fillOpacity);
          if (saved.showLabel) setHighlightLabel(saved.key, true);
        }

        // 6. Groups
        for (const saved of (project.groups ?? [])) {
          nextGroupId = saved.id;
          createGroup(saved.name);
          const grp = regionGroups.find(g => g.id === saved.id);
          if (!grp) continue;
          grp.color         = saved.color ?? grp.color;
          grp.fillOpacity   = saved.fillOpacity ?? 0;
          grp.invert        = saved.invert ?? false;
          grp._seqStart     = saved._seqStart;
          grp._seqInterval  = saved._seqInterval;
          if (tracks['group_' + saved.id]) tracks['group_' + saved.id].color = grp.color;
          for (const m of (saved.members ?? [])) addMemberToGroup(saved.id, m.name);
          refreshGroupEntities(grp);
        }
        nextGroupId = project.nextGroupId ?? nextGroupId;

        // 7. Cities
        nextCityId = project.nextCityId ?? 1;
        for (const saved of (project.cities ?? [])) {
          const marker = {
            id: saved.id,
            name: saved.name, country: saved.country,
            lat: saved.lat, lon: saved.lon,
            color:             saved.color             ?? '#ffffff',
            dotSize:           saved.dotSize           ?? 8,
            showLabel:         saved.showLabel         ?? true,
            labelColor:        saved.labelColor        ?? saved.color ?? '#ffffff',
            fontSize:          saved.fontSize          ?? 13,
            fontWeight:        saved.fontWeight        ?? 'normal',
            fontStyle:         saved.fontStyle         ?? 'normal',
            fontFamily:        saved.fontFamily        ?? 'Arial',
            offsetX:           saved.offsetX           ?? 0,
            offsetY:           saved.offsetY           ?? 0,
            outlineWidth:      saved.outlineWidth      ?? 2,
            showBackground:    saved.showBackground    ?? false,
            backgroundColor:   saved.backgroundColor   ?? '#000000',
            backgroundOpacity: saved.backgroundOpacity ?? 0.5,
            bgPadX:            saved.bgPadX            ?? 5,
            bgPadY:            saved.bgPadY            ?? 3,
            dotOpacity:        saved.dotOpacity        ?? 1.0,
            labelOpacity:      saved.labelOpacity      ?? 1.0,
          };
          marker.entity = makeCityEntity(marker);
          tracks['city_' + marker.id] = {
            id: 'city_' + marker.id, label: marker.name, category: 'city',
            color: marker.color, h: 22, keyframes: [], collapsed: true,
          };
          selectedTrackIds.add('city_' + marker.id);
          cityMarkers.push(marker);
        }

        // 7b. KML overlays
        nextKmlId = project.nextKmlId ?? 1;
        for (const saved of (project.kmlOverlays ?? [])) {
          try {
            const bytes = atob(saved.fileBase64);
            const arr = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
            const blob = new Blob([arr], { type: saved.mimeType });
            const dataSource = await loadKmlFromBlob(blob);
            dataSource.show = saved.visible ?? true;
            viewer.dataSources.add(dataSource);
            const layers = extractKmlLayers(dataSource);
            layers.forEach(setupKmlLayerCallbacks);
            (saved.layerOpacities ?? []).forEach((lo, i) => {
              const layer = layers[i];
              if (layer && lo.opacity !== undefined && lo.opacity !== 1.0) applyKmlLayerOpacity(layer, lo.opacity);
            });
            kmlOverlays.push({ id: saved.id, name: saved.name, fileBase64: saved.fileBase64, mimeType: saved.mimeType, dataSource, visible: saved.visible ?? true, layers });
            tracks['kml_' + saved.id] = { id: 'kml_' + saved.id, label: saved.name, category: 'kml', color: '#ffaa00', h: 22, keyframes: [] };
          } catch (err) {
            console.error('[KML] Failed to restore:', saved.name, err);
            setStatus(`Warning: could not restore KML layer "${saved.name}"`);
          }
        }
        renderKmlList();

        // 7b2. Image overlays
        nextImageOverlayId = project.nextImageOverlayId ?? 1;
        for (const saved of (project.imageOverlays ?? [])) {
          try {
            addImageOverlay({
              url: saved.url, name: saved.name,
              west: saved.west, south: saved.south, east: saved.east, north: saved.north,
              opacity: saved.opacity ?? 1.0,
            });
            const o = imageOverlays[imageOverlays.length - 1];
            o.id = saved.id;
            nextImageOverlayId = Math.max(nextImageOverlayId, saved.id + 1);
            o.visible = saved.visible ?? true;
            o.layer.show = o.visible;
          } catch (err) {
            console.error('[ImageOverlay] Failed to restore:', saved.name, err);
          }
        }
        renderImageOverlayList();

        // 7c. Annotations
        nextAnnotationId = project.nextAnnotationId ?? 1;
        for (const saved of (project.annotations ?? [])) {
          createAnnotation({ ...saved, el: null, entity: null });
        }
        renderAnnotationList();

        // 7c2. Routes
        nextRouteGroupId = project.nextRouteGroupId ?? 1;
        for (const saved of (project.routes ?? [])) {
          nextRouteGroupId = saved.id;
          const g = createCityRouteGroup(saved.name, saved.cities ?? []);
          if (!g) continue;
          g.color       = saved.color       ?? g.color;
          g.lineStyle   = saved.lineStyle   ?? 'line';
          g.lineShape   = saved.lineShape   ?? 'straight';
          g.routeStart  = saved.routeStart  ?? 0;
          g.routeEnd    = saved.routeEnd    ?? 100;
          g.width       = saved.width       ?? 2;
          g.visible     = saved.visible     ?? true;
          g.showCityLabels        = saved.showCityLabels        ?? false;
          g.labelColor            = saved.labelColor            ?? null;
          g.labelFontSize         = saved.labelFontSize         ?? 14;
          g.labelFontWeight       = saved.labelFontWeight       ?? 'normal';
          g.labelFontStyle        = saved.labelFontStyle        ?? 'normal';
          g.labelFontFamily       = saved.labelFontFamily       ?? 'Arial';
          g.labelOffsetX          = saved.labelOffsetX          ?? 4;
          g.labelOffsetY          = saved.labelOffsetY          ?? 0;
          g.labelOutlineWidth     = saved.labelOutlineWidth     ?? 2;
          g.labelOpacity          = saved.labelOpacity          ?? 1.0;
          g.labelShowBackground   = saved.labelShowBackground   ?? false;
          g.labelBgColor          = saved.labelBgColor          ?? '#000000';
          g.labelBgOpacity        = saved.labelBgOpacity        ?? 0.5;
          g.labelBgPadX           = saved.labelBgPadX           ?? 5;
          g.labelBgPadY           = saved.labelBgPadY           ?? 3;
          g.showLabel             = saved.showLabel             ?? false;
          g.glColor               = saved.glColor               ?? null;
          g.glFontSize            = saved.glFontSize            ?? 28;
          g.glFontWeight          = saved.glFontWeight          ?? 'bold';
          g.glFontStyle           = saved.glFontStyle           ?? 'normal';
          g.glFontFamily          = saved.glFontFamily          ?? 'Arial';
          g.glOffsetX             = saved.glOffsetX             ?? 0;
          g.glOffsetY             = saved.glOffsetY             ?? 0;
          g.glOutlineWidth        = saved.glOutlineWidth        ?? 2;
          g.glOpacity             = saved.glOpacity             ?? 1.0;
          g.glShowBackground      = saved.glShowBackground      ?? false;
          g.glBgColor             = saved.glBgColor             ?? '#000000';
          g.glBgOpacity           = saved.glBgOpacity           ?? 0.5;
          g.glBgPadX              = saved.glBgPadX              ?? 5;
          g.glBgPadY              = saved.glBgPadY              ?? 3;
          if (tracks['route_' + g.id]) tracks['route_' + g.id].color = g.color;
          buildRouteEntities(g);
          buildRouteCityMarkers(g);
        }
        nextRouteGroupId = project.nextRouteGroupId ?? nextRouteGroupId;
        renderRouteGroupList();

        // 8. Restore track keyframes (overwrite after entities are rebuilt)
        for (const [id, saved] of Object.entries(project.tracks ?? {})) {
          if (tracks[id]) tracks[id].keyframes = saved.keyframes ?? [];
        }

        // 9. Restore counters and selection
        nextKfId         = project.nextKfId  ?? nextKfId;
        selectedTrackIds = new Set(project.selectedTrackIds ?? ['camera']);

        // 9b. Apply sequential appearance metadata (server-generated animated maps).
        // Runs after step 8 (so project.tracks keyframes win) and after nextKfId is set.
        for (const saved of (project.groups ?? [])) {
          if (!saved.sequentialAppearance) continue;
          const grp = regionGroups.find(g => g.id === saved.id);
          if (!grp) continue;
          const { startTime, interval } = saved.sequentialAppearance;
          grp.members.forEach((member, idx) => {
            const tid = `gmember_${grp.id}_${member.key}`;
            const track = tracks[tid];
            if (!track || track.keyframes.length > 0) return; // don't overwrite existing keyframes
            const appearTime = startTime + idx * interval;
            track.keyframes = [
              { id: nextKfId++, time: 0, opacity: 0 },
              { id: nextKfId++, time: appearTime, opacity: 1 },
            ];
          });
        }

        // 10. Re-render everything
        renderHighlightList();
        renderGroupList();
        renderCityList();
        renderKmlList();
        renderKeyframeList();
        tlBuildLabels();
        tlDraw();
        updateProgressUI(playbackT);
        applySceneState(buildStateAtTime(playbackT));

        // Fly camera to the t=0 keyframe position if camera keyframes exist.
        const camStart = interpolateTrack('camera', 0);
        if (camStart?.lon !== undefined) {
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(camStart.lon, camStart.lat, camStart.height),
            orientation: {
              heading: Cesium.Math.toRadians(camStart.heading),
              pitch:   Cesium.Math.toRadians(camStart.pitch),
              roll:    Cesium.Math.toRadians(camStart.roll),
            },
            duration: 2,
          });
        }

        setStatus('Project loaded.');
      }

      document.getElementById('saveProjectBtn').addEventListener('click', saveProject);
      document.getElementById('loadProjectBtn').addEventListener('click', () => {
        document.getElementById('loadProjectInput').click();
      });
      document.getElementById('resetProjectBtn').addEventListener('click', () => {
        if (!confirm('Reset to a blank map? All unsaved changes will be lost.')) return;
        loadProject({
          version: 1, totalDuration: 10, playbackT: 0,
          currentBasemap: 'eox-s2', basemapShowLabels: true, basemapMaxLevelOverride: null,
          bmAdjust: { brightness: 1, contrast: 1, hue: 0, saturation: 1, gamma: 1 },
          borders: { countryOpacity: 0.6, stateOpacity: 0, countyOpacity: 0, countyFilter: 'none', borderColor: '#ffffff', landOnly: true },
          defaults: { regionColor: '#ff9900', cityColor: '#ffffff', cityDotSize: 6 },
          highlights: [], groups: [], cities: [], routes: [],
          tracks: {
            camera:  { keyframes: [{ id: 1, time: 0, lat: 20, lon: 0, height: 15000000, heading: 0, pitch: -90, roll: 0, sceneMode: 'globe' }] },
            tod:     { keyframes: [] },
            borders: { keyframes: [] },
          },
          nextKfId: 2, nextGroupId: 1, nextCityId: 1, nextRouteGroupId: 1,
          kmlOverlays: [], nextKmlId: 1, imageOverlays: [], nextImageOverlayId: 1,
          annotations: [], nextAnnotationId: 1, selectedTrackIds: ['camera'],
        });
      });
      document.getElementById('loadProjectInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const project = JSON.parse(ev.target.result);
            loadProject(project);
          } catch (err) {
            setStatus('Failed to load project: invalid JSON.');
            console.error(err);
          }
        };
        reader.readAsText(file);
        // Reset so the same file can be re-loaded if needed
        e.target.value = '';
      });

      // ── Generate map ─────────────────────────────────────────────────────────
      const GENERATE_SUGGESTIONS = [
        // Geopolitical blocs
        "NATO member countries on a dark globe",
        "Countries of the European Union",
        "G7 nations highlighted",
        "G20 nations",
        "BRICS nations",
        "OPEC member countries",
        "Commonwealth realm nations",
        "ASEAN member nations",
        "Arab League member states",
        "Countries of the African Union",
        "Countries of the Shanghai Cooperation Organisation",
        "Countries that use the Euro",
        "Permanent members of the UN Security Council",
        "Countries with nuclear weapons",
        "Countries with no military",
        "Countries under UN sanctions",
        "Countries with monarchies",
        "Countries that have never been colonized",
        // Geography
        "Mediterranean Sea countries",
        "Countries bordering the Arctic Ocean",
        "Landlocked countries of the world",
        "Island nations of the Pacific Ocean",
        "Caribbean island nations",
        "Pacific Island nations",
        "Countries bordering the Sahara Desert",
        "Nations of the Amazon Basin",
        "Countries of the Nile River Basin",
        "Ring of Fire countries",
        "Countries sharing the Himalayan mountain range",
        "Nations bordering the South China Sea",
        "Countries of the Persian Gulf",
        "Baltic Sea nations",
        "Black Sea countries",
        "Countries with coastline on the Indian Ocean",
        // History & empires
        "The Silk Road trade route with city markers",
        "The Roman Empire at its peak",
        "The Mongol Empire at its greatest extent",
        "The Ottoman Empire at its height",
        "Alexander the Great's conquest route",
        "Viking exploration routes",
        "Countries colonized by Britain",
        "Marco Polo's journey to China",
        "Columbus's voyages to the Americas",
        "Ancient trade routes of the Mediterranean",
        "The route of the Lewis and Clark Expedition",
        "The Camino de Santiago pilgrimage route",
        "Cities along the historic Route 66",
        // Travel & routes
        "The route of the Trans-Siberian Railway",
        "Major cities along the Amazon River",
        "European capitals connected by a single route",
        "Major cities of Southeast Asia",
        "South American capitals",
        "A road trip along the US Pacific Coast Highway",
        "Safari destinations in East Africa",
        "A cruise route through the Mediterranean",
        "Cities of the ancient Spice Trade route",
        "Wine regions of France",
        // US geography
        "US states that border the Mississippi River",
        "US states bordering Mexico",
        "US states on the Pacific Coast",
        "States of the American South",
        "The original 13 colonies",
        "Great Lakes states",
        "New England states",
        "US states bordering Canada",
        "US states west of the Rocky Mountains",
        // Data & rankings
        "Most populated countries in the world",
        "Countries with the highest GDP per capita",
        "Countries in South America",
        "Most visited countries by tourists",
        "Countries with the highest CO2 emissions",
        "Nations with the most UNESCO World Heritage Sites",
        "Countries with space programs",
        "Fastest growing economies in Africa",
        "Countries with the most billionaires",
        "Countries with universal healthcare",
        // Religion & culture
        "Predominantly Muslim countries",
        "Countries where Buddhism is the main religion",
        "Catholic majority countries",
        "Countries with the most languages spoken",
        // Modern geopolitics
        "Countries with high-speed rail networks",
        "Busiest air travel hubs in the world",
        "Countries that drive on the left side of the road",
        "Countries with the fastest internet speeds",
        "Countries that have sent humans to space",
        // Oceans & infrastructure
        "Major container shipping ports on a global route",
        "Countries of the Congo Basin rainforest",
        "Driest countries in the world",
        "Countries with active volcanoes",
        "Nations of the Mekong River",
        "Countries of the Danube River",
        "Capitals of every country in Africa",
        "Countries with a coastline on the Mediterranean",
        "Countries that border Russia",
        "Countries that border China",
        "Countries that border India",
        "Every country in Central America",
        "Countries of the Balkans",
        "Former Soviet Union republics",
        "Countries of the Middle East",
      ];
      const generatePromptEl = document.getElementById('generatePrompt');
      const generateStatusEl = document.getElementById('generateStatus');
      generatePromptEl.value = GENERATE_SUGGESTIONS[Math.floor(Math.random() * GENERATE_SUGGESTIONS.length)];

      let generateAnimate = false;
      document.getElementById('generateAnimateToggle').addEventListener('click', () => {
        generateAnimate = !generateAnimate;
        const btn = document.getElementById('generateAnimateToggle');
        btn.style.background = generateAnimate ? '#4a9eff' : '#eee';
        btn.style.color = generateAnimate ? '#fff' : '#555';
        btn.style.borderColor = generateAnimate ? '#2a7ae8' : '#ccc';
      });

      document.getElementById('generateMapBtn').addEventListener('click', async () => {
        const prompt = generatePromptEl.value.trim();
        if (!prompt) return;
        generateStatusEl.textContent = generateAnimate ? 'Generating animation (may take ~15s)…' : 'Generating…';
        document.getElementById('generateMapBtn').disabled = true;
        document.getElementById('generateAnimateToggle').disabled = true;
        try {
          const res = await fetch('/api/generate-map', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, animate: generateAnimate }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Generation failed');
          await loadProject(data.project);
          generateStatusEl.textContent = generateAnimate ? 'Animated map generated!' : 'Map generated!';
          setTimeout(() => { generateStatusEl.textContent = ''; }, 3000);
        } catch (err) {
          generateStatusEl.textContent = err.message;
          console.error('[generate-map]', err);
        } finally {
          document.getElementById('generateMapBtn').disabled = false;
          document.getElementById('generateAnimateToggle').disabled = false;
        }
      });

      // ── Demo gallery ─────────────────────────────────────────────────────────

      async function loadDemoList() {
        const list = document.getElementById('demoList');
        try {
          const res = await fetch('/api/demos');
          const demos = await res.json();
          list.innerHTML = '';
          if (!demos.length) {
            list.innerHTML = '<div style="font-size:10px;color:#bbb;padding:2px 0;">No demos saved yet — generate a map and click + Save.</div>';
            return;
          }
          for (const demo of demos) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:3px;margin-bottom:2px;';

            const btn = document.createElement('button');
            btn.style.cssText = 'flex:1;text-align:left;font-size:11px;padding:3px 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            btn.textContent = demo.name;
            if (demo.description) btn.title = demo.description;
            btn.addEventListener('click', async () => {
              btn.disabled = true;
              btn.textContent = 'Loading…';
              try {
                const r = await fetch(`/api/demos/${encodeURIComponent(demo.id)}`);
                const data = await r.json();
                if (!r.ok) throw new Error(data.error || 'Failed');
                await loadProject(data.project);
              } catch (e) {
                setStatus('Demo load failed: ' + e.message);
              } finally {
                btn.disabled = false;
                btn.textContent = demo.name;
              }
            });

            const del = document.createElement('button');
            del.textContent = '×';
            del.title = 'Delete demo';
            del.style.cssText = 'width:auto;padding:1px 6px;font-size:12px;color:#999;background:none;border:1px solid #ddd;border-radius:3px;flex-shrink:0;';
            del.addEventListener('click', async () => {
              if (!confirm(`Delete demo "${demo.name}"?`)) return;
              await fetch(`/api/demos/${encodeURIComponent(demo.id)}`, { method: 'DELETE' });
              loadDemoList();
            });

            row.appendChild(btn);
            row.appendChild(del);
            list.appendChild(row);
          }
        } catch (e) {
          list.innerHTML = '<div style="font-size:10px;color:#bbb;">Could not load demos.</div>';
        }
      }

      document.getElementById('saveDemoBtn').addEventListener('click', async () => {
        const name = prompt('Demo name:');
        if (!name?.trim()) return;
        const description = prompt('Short description (optional):') || '';
        const projectJson = buildProjectJson();
        const btn = document.getElementById('saveDemoBtn');
        btn.disabled = true;
        try {
          const res = await fetch('/api/demos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim(), description, project: projectJson }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Save failed');
          loadDemoList();
          setStatus(`Demo "${name.trim()}" saved.`);
        } catch (e) {
          setStatus('Save demo failed: ' + e.message);
        } finally {
          btn.disabled = false;
        }
      });

      loadDemoList();

      // ── Boot ─────────────────────────────────────────────────────────────────
      initBuiltinTracks();
      renderLooksSelect();
      renderKeyframeList();
      updateProgressUI(0);
      initViewer();
      // Apply the currently-selected export resolution so the viewport is WYSIWYG from the start
      // Skip on mobile — let Cesium fill the screen at native resolution
      (() => {
        const isMob = navigator.maxTouchPoints > 1 || /iPhone|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 1366;
        if (isMob) return;
        const sel = document.getElementById("resolutionSelect");
        const [w, h] = sel.value.split("x").map(Number);
        setViewerResolution(w, h);
      })();
      setTimeOfDay(720);
      loadRegionData();
      tlBuildLabels();
      tlInitEvents();
      tlRenderLoop();

      // ── Mobile sidebar toggle ─────────────────────────────────────────────
      (() => {
        const toggleBtn = document.getElementById("mobileSidebarToggle");
        const overlay   = document.getElementById("mobileSidebarOverlay");
        const sidebar   = document.getElementById("sidebar");
        function openSidebar()  { sidebar.classList.add("mobile-open");    overlay.classList.add("mobile-open");    toggleBtn.textContent = "✕"; }
        function closeSidebar() { sidebar.classList.remove("mobile-open"); overlay.classList.remove("mobile-open"); toggleBtn.textContent = "☰"; }
        toggleBtn.addEventListener("click", () => sidebar.classList.contains("mobile-open") ? closeSidebar() : openSidebar());
        overlay.addEventListener("click", closeSidebar);
      })();

      // ── Story tab — annotation presets & add button ───────────────────────
      document.querySelectorAll('.ann-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const preset = ANN_PRESETS[btn.dataset.preset];
          if (preset) createAnnotation({ ...preset });
        });
      });
      document.getElementById('addAnnotationBtn').addEventListener('click', () => {
        const input = document.getElementById('annNameInput');
        const text  = input.value.trim() || 'Annotation';
        createAnnotation({ text });
        input.value = '';
      });
      document.getElementById('annNameInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('addAnnotationBtn').click();
      });
      renderAnnotationList();

      // ── Easing bar ───────────────────────────────────────────────────────
      function updateEaseBar() {
        const kfSel = tlSelectedKf;
        const show = !!kfSel;
        const ids = ['tlEaseSep','tlEaseLabel','tlEaseLin','tlEaseIn','tlEaseOut','tlEaseInOut'];
        ids.forEach(id => document.getElementById(id).style.display = show ? (id === 'tlEaseLabel' ? 'inline' : 'inline-block') : 'none');
        if (!show) return;
        const track = tracks[kfSel.trackId];
        const kf = track?.keyframes.find(k => k.id === kfSel.kfId);
        const cur = kf?.ease || 'linear';
        document.querySelectorAll('.tl-ease-btn').forEach(btn => {
          btn.classList.toggle('tl-transport-active', btn.dataset.ease === cur);
        });
      }

      document.querySelectorAll('.tl-ease-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!tlSelectedKf) return;
          const track = tracks[tlSelectedKf.trackId];
          const kf = track?.keyframes.find(k => k.id === tlSelectedKf.kfId);
          if (kf) { kf.ease = btn.dataset.ease; updateEaseBar(); }
        });
      });

      // ── Tab switching ─────────────────────────────────────────────────────
      (() => {
        const tabBtns  = document.querySelectorAll('.tab-btn');
        const tabPanels = document.querySelectorAll('.tab-panel');
        tabBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === target));
            tabPanels.forEach(p => p.classList.toggle('active', p.id === 'tab-' + target));
          });
        });
      })();

      // ── Collapsible sections ──────────────────────────────────────────────
      (() => {
        document.querySelectorAll('.section-title').forEach(title => {
          title.addEventListener('click', () => {
            title.closest('.section').classList.toggle('collapsed');
          });
        });
      })();
