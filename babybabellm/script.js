// Global variables
let map;
let markers = [];
let labelMarkers = [];
let showLabels = true;

// Cache of colors assigned per language family for stable coloring
let familyColorMap = {};

// Base palette used cyclically for new families
const familyPalette = [
    '#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c',
    '#c0392b', '#8e44ad', '#16a085', '#d35400', '#27ae60', '#2980b9'
];

// Color mapping for different marker colors
const colorMap = {
    'red': '#e74c3c',
    'blue': '#3498db',
    'green': '#2ecc71',
    'purple': '#9b59b6',
    'orange': '#f39c12',
    'teal': '#1abc9c',
    'darkred': '#c0392b',
    'brown': '#8b4513',
    'pink': '#e91e63',
    'cyan': '#00bcd4'
};

// Initialize map when page loads
document.addEventListener('DOMContentLoaded', function() {
    initializeMap();
    loadMapData();
});

// Initialize the Leaflet map
function initializeMap() {
    // Create map centered on the world
    map = L.map('map').setView([20, 0], 2);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
    }).addTo(map);

    // Set map bounds to prevent excessive panning
    const southWest = L.latLng(-90, -180);
    const northEast = L.latLng(90, 180);
    const bounds = L.latLngBounds(southWest, northEast);
    map.setMaxBounds(bounds);
    map.on('drag', function() {
        map.panInsideBounds(bounds, { animate: false });
    });

    // Add label toggle control
    removeStaleLabelControls();
    addLabelToggleControl();
}

// Add a simple control to toggle labels on/off
function addLabelToggleControl() {
    const LabelControl = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function () {
            const container = L.DomUtil.create('div');
            container.style.cursor = 'pointer';
            container.style.userSelect = 'none';
            container.style.background = 'transparent';
            container.style.border = 'none';
            container.style.borderRadius = '0';
            container.style.padding = '0';
            container.style.boxShadow = 'none';
            container.style.fontSize = '12px';
            container.style.color = '#333';
            container.innerHTML = `
                <label style="display:flex; align-items:center; gap:6px; margin:0; background:none;">
                    show labels
                    <input id="label-toggle" type="checkbox" ${showLabels ? 'checked' : ''}>
                </label>
            `;
            // Prevent map drag when interacting with control
            L.DomEvent.disableClickPropagation(container);
            setTimeout(() => {
                const checkbox = container.querySelector('#label-toggle');
                if (checkbox) {
                    checkbox.addEventListener('change', (e) => {
                        showLabels = e.target.checked;
                        // Apply visibility
                        labelMarkers.forEach(m => {
                            try { map.removeLayer(m); } catch (e) {}
                            if (showLabels) m.addTo(map);
                        });
                    });
                }
            }, 0);
            return container;
        }
    });
    map.addControl(new LabelControl());
}

// Remove any old large legend-style label controls if present (from previous versions)
function removeStaleLabelControls() {
    try {
        const stale = document.querySelectorAll('.legend-control');
        stale.forEach(el => el.parentNode && el.parentNode.removeChild(el));
    } catch (e) {}
}
// Load and parse CSV data
async function loadMapData() {
    try {
        // Load the consolidated map data CSV from data directory
        const response = await fetch('data/metadata_merged.csv');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const csvText = await response.text();
        const data = parseCSV(csvText);
        createMarkers(data);
    } catch (error) {
        console.error('Error loading map data:', error);
        
        // If CORS error, provide helpful message and fallback data
        if (error.message.includes('CORS') || error.name === 'TypeError') {
            showCORSError();
        } else {
            showError('Failed to load map data: ' + error.message);
        }
        
        // Load fallback data
        loadFallbackData();
    }
}

// Parse CSV text into array of objects (handles quotes, commas, CRLF)
function parseCSV(text) {
    // Normalize line endings
    const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows = [];
    let currentRow = [];
    let currentValue = '';
    let inQuotes = false;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        const next = input[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                // Escaped quote inside quoted value
                currentValue += '"';
                i++; // Skip the next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentValue);
            currentValue = '';
        } else if (char === '\n' && !inQuotes) {
            currentRow.push(currentValue);
            rows.push(currentRow);
            currentRow = [];
            currentValue = '';
        } else {
            currentValue += char;
        }
    }

    // Push last value/row if any
    if (currentValue !== '' || currentRow.length > 0) {
        currentRow.push(currentValue);
        rows.push(currentRow);
    }

    if (rows.length === 0) return [];

    // Normalize headers to lowercase and trimmed
    const rawHeaders = rows[0];
    const headers = rawHeaders.map(h => (h || '').trim().toLowerCase());

    const data = [];
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.length === 0) continue;
        const obj = {};
        for (let c = 0; c < headers.length; c++) {
            const key = headers[c];
            if (!key) continue;
            const value = row[c] !== undefined ? row[c].trim() : '';
            obj[key] = value;
        }
        data.push(obj);
    }
    return data;
}

// Create markers from data
function createMarkers(data) {
    // Helper to get the first available value among multiple keys
    const getFirst = (obj, keys) => {
        for (const k of keys) {
            if (k in obj && obj[k] !== '' && obj[k] !== undefined && obj[k] !== null) {
                return obj[k];
            }
        }
        return undefined;
    };

    // Validate hex color
    const isHexColor = (str) => typeof str === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(str.trim());

    // Convert HSL to HEX
    const hslToHex = (h, s, l) => {
        const s1 = s / 100;
        const l1 = l / 100;
        const c = (1 - Math.abs(2 * l1 - 1)) * s1;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l1 - c / 2;
        let r = 0, g = 0, b = 0;
        if (0 <= h && h < 60) { r = c; g = x; b = 0; }
        else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
        else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
        else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
        else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
        else { r = c; g = 0; b = x; }
        const toHex = (v) => {
            const n = Math.round((v + m) * 255);
            return n.toString(16).padStart(2, '0');
        };
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    };

    // Deterministic hash from string to HEX color
    const hashStringToColor = (str) => {
        let hash = 0;
        const input = String(str || '');
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) - hash) + input.charCodeAt(i);
            hash |= 0;
        }
        const hue = Math.abs(hash) % 360;
        return hslToHex(hue, 65, 45);
    };

    // Build external link if CSV does not provide one
    const buildLanguageLink = (name, iso) => {
        const display = name || iso || '';
        if (!display) return '';
        const query = encodeURIComponent(`${display} language`);
        return `https://en.wikipedia.org/w/index.php?search=${query}`;
    };

    // Clear any existing markers
    if (markers.length > 0) {
        markers.forEach(m => {
            try { map.removeLayer(m); } catch (e) {}
        });
        markers = [];
    }
    if (labelMarkers.length > 0) {
        labelMarkers.forEach(m => {
            try { map.removeLayer(m); } catch (e) {}
        });
        labelMarkers = [];
    }

    data.forEach(point => {
        // Keys are normalized to lowercase by parseCSV
        const latStr = getFirst(point, ['latitude', 'lat', 'wals_latitude']);
        const lngStr = getFirst(point, ['longitude', 'lon', 'lng', 'wals_longitude']);

        const lat = latStr !== undefined ? parseFloat(latStr) : NaN;
        const lng = lngStr !== undefined ? parseFloat(lngStr) : NaN;

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            const sizeStr = getFirst(point, ['size', 'marker_size']);
            const parsedSize = parseInt(sizeStr, 10);
            const size = Number.isFinite(parsedSize) ? parsedSize : 12;

            // Choose color by language family first
            const family = getFirst(point, ['family', 'language_family', 'family_name']);
            let color = '#3498db';
            if (family) {
                const key = String(family).trim().toLowerCase();
                if (!familyColorMap[key]) {
                    const idx = Object.keys(familyColorMap).length;
                    familyColorMap[key] = familyPalette[idx % familyPalette.length] || hashStringToColor(key);
                }
                color = familyColorMap[key];
            } else {
                const rawColor = getFirst(point, ['color', 'family_color']);
                if (isHexColor(rawColor)) {
                    color = rawColor.trim();
                } else if (rawColor && colorMap[String(rawColor).toLowerCase()]) {
                    color = colorMap[String(rawColor).toLowerCase()];
                }
            }

            // Create custom marker icon
            const markerIcon = createCustomIcon(color, size);

            // Create marker
            const marker = L.marker([lat, lng], { icon: markerIcon })
                .addTo(map);

            // Add text label near the marker (reduced gap and vertically centered)
            const markerIconSize = Array.isArray(markerIcon && markerIcon.options && markerIcon.options.iconSize)
                ? markerIcon.options.iconSize[0]
                : 24; // fallback width if unavailable
            const labelWidth = 120; // visual box width (CSS controls inner span)
            const labelHeight = 20; // approximate visual height
            const gapPx = 2; // tightened horizontal gap between point and label
            const anchorX = -((markerIconSize / 2) + gapPx);
            const anchorY = Math.round(labelHeight / 2);

            const textLabel = L.divIcon({
                className: 'language-label',
                html: `<span class="label-text">${getFirst(point, ['language', 'name', 'iso-639-3', 'iso_code']) || ''}</span>`,
                iconSize: [labelWidth, labelHeight],
                iconAnchor: [anchorX, anchorY]
            });

            const labelMarker = L.marker([lat, lng], { icon: textLabel });
            if (showLabels) {
                labelMarker.addTo(map);
            }

            // Prepare and bind popup
            const name = getFirst(point, ['name', 'language']) || '';
            const iso = getFirst(point, ['iso_code', 'iso-639-3']) || '';
            const tier = getFirst(point, ['tier']) || '';
            const datasetIso = iso ? String(iso).trim().toLowerCase() : '';
            const link = datasetIso ? `https://huggingface.co/datasets/BabyLM-community/babylm-${datasetIso}` : '';

            // Minimal additional fields requested
            const totalTokens = getFirst(point, ['total']) || '';
            const devPlausTokens = getFirst(point, ['developmentally plausible']) || '';

            const popupHtml = `
                <div class=\"map-legend\"> 
                    <h4 style=\"margin:0 0 6px 0; font-size:14px; color:#2c3e50;\">${name || iso}</h4>
                    <div style=\"font-size:12px; color:#34495e; margin-bottom:6px;\"> 
                        ${iso ? `ISO: <strong>${iso}</strong><br/>` : ''}
                        ${family ? `Family: <strong>${family}</strong><br/>` : ''}
                        ${tier ? `Tier: <strong>${tier}</strong><br/>` : ''}
                        ${totalTokens ? `Total words: <strong>${totalTokens}</strong><br/>` : ''}
                        ${devPlausTokens ? `Dev. plausible words: <strong>${devPlausTokens}</strong>` : ''}
                    </div>
                    ${link ? `<a href=\"${link}\" target=\"_blank\" style=\"font-size:12px; color:#667eea; text-decoration:none;\">Dataset ↗</a>` : ''}
                </div>
            `;
            marker.bindPopup(popupHtml, { closeButton: true, autoPan: true });

            markers.push(marker);
            markers.push(labelMarker);
            labelMarkers.push(labelMarker);
        }
    });

    // Fit map to show all markers
    if (markers.length > 0) {
        const group = new L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
}

// Create custom marker icon
function createCustomIcon(color, size) {
    const iconSize = Math.max(20, Math.min(40, size + 5)); // Scale size appropriately
    
    return L.divIcon({
        className: 'custom-marker',
        html: `
            <div style="
                background-color: ${color};
                width: ${iconSize}px;
                height: ${iconSize}px;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: ${Math.max(8, iconSize/3)}px;
                cursor: pointer;
                transition: transform 0.2s ease;
            ">●</div>
        `,
        iconSize: [iconSize, iconSize],
        iconAnchor: [iconSize/2, iconSize/2],
        popupAnchor: [0, -iconSize/2]
    });
}



// Show CORS error message with instructions
function showCORSError() {
    const mapContainer = document.getElementById('map');
    mapContainer.innerHTML = `
        <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: #e74c3c;
            font-size: 1rem;
            text-align: center;
            padding: 2rem;
        ">
            <div>
                <i class="error-icon">🌐</i>
                <h3 style="color: #e74c3c; margin-bottom: 1rem;">CORS Error</h3>
                <p style="margin-bottom: 1rem;">Due to browser security restrictions, the CSV file cannot be loaded directly.</p>
                <p style="margin-bottom: 1rem;"><strong>Solution:</strong></p>
                <p style="margin-bottom: 0.5rem;">1. Run a local server: <code>python3 -m http.server 8000</code></p>
                <p style="margin-bottom: 1rem;">2. Then visit: <code>http://localhost:8000</code></p>
                <p style="margin-bottom: 1rem; font-size: 0.9rem; color: #666;">Loading sample data...</p>
            </div>
        </div>
    `;
    
    // Auto-hide the error message after showing fallback data
    setTimeout(() => {
        const mapContainer = document.getElementById('map');
        mapContainer.innerHTML = '';
        map = L.map('map').setView([20, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18,
        }).addTo(map);
    }, 3000);
}

// Show general error message
function showError(message) {
    const mapContainer = document.getElementById('map');
    mapContainer.innerHTML = `
        <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: #e74c3c;
            font-size: 1.1rem;
            text-align: center;
            padding: 2rem;
        ">
            <div>
                <i class="error-icon">⚠️</i>
                <p>${message}</p>
                <button onclick="location.reload()" style="
                    background: #3498db;
                    color: white;
                    border: none;
                    padding: 0.5rem 1rem;
                    border-radius: 4px;
                    cursor: pointer;
                    margin-top: 1rem;
                ">Retry</button>
            </div>
        </div>
    `;
}// Load fallback data when CSV can't be loaded
function loadFallbackData() {
    // Sample fallback data embedded in JavaScript
    const fallbackData = [
        {
            name: 'Beijing University',
            description: 'Leading research in Mandarin language acquisition',
            latitude: '39.9987',
            longitude: '116.3162',
            color: 'red',
            size: '15',
            link: 'https://example.com/beijing',
            popup_page: 'beijing.html'
        },
        {
            name: 'MIT Boston',
            description: 'Advanced computational linguistics research',
            latitude: '42.3601',
            longitude: '-71.0942',
            color: 'blue',
            size: '20',
            link: 'https://example.com/mit',
            popup_page: 'mit.html'
        },
        {
            name: 'Stanford University',
            description: 'Silicon Valley language technology hub',
            latitude: '37.4419',
            longitude: '-122.1430',
            color: 'darkred',
            size: '22',
            link: 'https://example.com/stanford',
            popup_page: 'stanford.html'
        }
    ];
    
    setTimeout(() => {
        createMarkers(fallbackData);
    }, 3000);
}



// Add hover effects to markers
document.addEventListener('DOMContentLoaded', function() {
    // Add CSS for hover effects
    const style = document.createElement('style');
    style.textContent = `
        .custom-marker:hover div {
            transform: scale(1.1) !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
        }
        
        .custom-marker div {
            transition: all 0.2s ease !important;
        }
        

    `;
    document.head.appendChild(style);
}); 

