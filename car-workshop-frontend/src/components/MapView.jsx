import { useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useTranslation } from 'react-i18next';
import { Map as MapIcon, HalfMoon, SunLight, PlanetSat, Expand, Collapse, NavArrowDown } from 'iconoir-react';
import { MARKER_ICONS } from './LocationPicker';
import 'leaflet/dist/leaflet.css';
import './MapStyles.css';

/* ── Tile providers ──────────────────────────────────────────── */
const TILES = {
  street:    { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',       label: 'Street',    Icon: MapIcon },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', label: 'Satellite', Icon: PlanetSat },
  dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', label: 'Dark',  Icon: HalfMoon },
  light:     { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', label: 'Light', Icon: SunLight },
};

/* ── Auto-fit bounds to markers ──────────────────────────────── */
function FitBounds({ markers, polygons }) {
  const map = useMap();
  useEffect(() => {
    const points = [];
    markers?.forEach(m => { if (m.lat && m.lng) points.push([m.lat, m.lng]); });
    polygons?.forEach(p => { p.coords?.forEach(c => points.push(c)); });
    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds.pad(0.15), { maxZoom: 15, duration: 0.8 });
    }
  }, [markers, polygons, map]);
  return null;
}

/* ── Fly-to a specific marker ────────────────────────────────── */
function FlyToMarker({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target?.lat && target?.lng) {
      map.flyTo([parseFloat(target.lat), parseFloat(target.lng)], 16, { duration: 0.8 });
    }
  }, [target, map]);
  return null;
}

/* ── Expose map methods via ref ──────────────────────────────── */
function MapController({ mapRef }) {
  const map = useMap();
  useImperativeHandle(mapRef, () => ({
    flyTo: (lat, lng, zoom = 16) => map.flyTo([lat, lng], zoom, { duration: 0.8 }),
    fitBounds: () => {
      const bounds = map.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));
    },
    getMap: () => map,
  }), [map]);
  return null;
}

/* ── Invalidate map size on fullscreen toggle ────────────────── */
function InvalidateOnResize({ trigger }) {
  const map = useMap();
  useEffect(() => {
    // Small delay to let CSS transition finish
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [trigger, map]);
  return null;
}

/* ══════════════════════════════════════════════════════════════
   MapView — Enhanced map with tile switching, fullscreen,
             marker interactions, and floating controls
   Props:
     markers       — [{ lat, lng, type, label, popup, id }]
     polygons      — [{ coords: [[lat,lng],...], color, label }]
     polylines     — [{ positions: [[lat,lng],...], color, weight, dashArray, popup }]
     center        — [lat, lng] (default UAE)
     zoom          — initial zoom (default 10)
     height        — CSS height (default 400)
     onMarkerClick — callback(marker)
     flyTarget     — { lat, lng } to fly to
     mapRef        — ref to expose flyTo/fitBounds
     showControls  — show tile switcher + fullscreen (default true)
     stats         — { unassigned, active, mechanics } for overlay
   Legend words are the workshop's (mapView.*): the courier legend said
   "Pickup" and "Mechanics" for the customer's location and the technicians.
   ══════════════════════════════════════════════════════════════ */
const MapView = forwardRef(function MapView({
  markers = [], polygons = [], polylines = [],
  center = [25.2048, 55.2708], zoom = 10,
  height = 400, onMarkerClick, flyTarget,
  showControls = true, stats,
}, ref) {
  const { t } = useTranslation();
  const [tile, setTile] = useState('street');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLegend, setShowLegend] = useState(true);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(f => !f);
  }, []);

  // Escape key to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e) => { if (e.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFullscreen]);

  const containerStyle = isFullscreen ? {
    position: 'fixed', inset: 0, zIndex: 9999, height: '100vh',
    borderRadius: 0, background: '#000',
  } : { height };

  return (
    <div className={`mapview-container ${isFullscreen ? 'mapview-fullscreen' : ''}`} style={containerStyle}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%', borderRadius: isFullscreen ? 0 : 14, zIndex: 1 }}
        scrollWheelZoom={true}
        attributionControl={false}
      >
        <TileLayer
          key={tile}
          url={TILES[tile].url}
          attribution='&copy; OpenStreetMap'
          maxZoom={19}
        />
        <FitBounds markers={markers} polygons={polygons} />
        {flyTarget && <FlyToMarker target={flyTarget} />}
        {ref && <MapController mapRef={ref} />}
        <InvalidateOnResize trigger={isFullscreen} />

        {/* Route polylines */}
        {polylines.map((pl, i) => (
          pl.positions?.length > 1 && (
            <Polyline
              key={`pl-${i}`}
              positions={pl.positions}
              pathOptions={{
                color: pl.color || '#6366f1',
                weight: pl.weight || 4,
                opacity: pl.opacity || 0.75,
                dashArray: pl.dashArray || null,
              }}
            >
              {pl.popup && (
                <Popup>
                  <div className="map-popup">{pl.popup}</div>
                </Popup>
              )}
            </Polyline>
          )
        ))}

        {/* Polygon overlays */}
        {polygons.map((poly, i) => (
          poly.coords?.length > 2 && (
            <Polygon
              key={`poly-${i}`}
              positions={poly.coords}
              pathOptions={{
                color: poly.color || '#3b82f6',
                fillColor: poly.color || '#3b82f6',
                fillOpacity: 0.15,
                weight: 2.5,
                dashArray: poly.dashed ? '6 4' : null,
              }}
            >
              {poly.label && (
                <Popup>
                  <div className="map-popup"><strong>{poly.label}</strong></div>
                </Popup>
              )}
            </Polygon>
          )
        ))}

        {/* Markers */}
        {markers.map((m, i) => {
          if (!m.lat || !m.lng) return null;
          const icon = MARKER_ICONS[m.type] || MARKER_ICONS.delivery;
          return (
            <Marker
              key={m.id || `m-${i}`}
              position={[parseFloat(m.lat), parseFloat(m.lng)]}
              icon={icon}
              eventHandlers={{
                click: () => onMarkerClick?.(m),
              }}
            >
              {m.popup && (
                <Popup>
                  <div className="map-popup">
                    {/* A string popup is rendered as text. It used to go through
                        dangerouslySetInnerHTML, so any stored script in a
                        customer or mechanic name executed in the admin's
                        session. Callers that need markup pass a React element,
                        which is the branch below. */}
                    {typeof m.popup === 'string' ? <span>{m.popup}</span> : m.popup}
                  </div>
                </Popup>
              )}
            </Marker>
          );
        })}

        {/* Empty state overlay */}
        {markers.length === 0 && polygons.length === 0 && (
          <div className="mapview-empty-overlay">
            <span>{t('mapView.empty', 'No locations to display')}</span>
          </div>
        )}
      </MapContainer>

      {/* ── Floating Controls ── */}
      {showControls && (
        <>
          {/* Tile Switcher — top right */}
          <div className="mapview-tile-switcher">
            {Object.entries(TILES).map(([key, layer]) => (
              <button
                key={key}
                className={`mapview-tile-btn ${tile === key ? 'active' : ''}`}
                onClick={() => setTile(key)}
                title={layer.label}
              >
                <span className="mapview-tile-icon"><layer.Icon width={14} height={14} /></span>
                <span className="mapview-tile-label">{layer.label}</span>
              </button>
            ))}
          </div>

          {/* Fullscreen Toggle — below zoom controls, top left */}
          <button className="mapview-fullscreen-btn" onClick={toggleFullscreen} title={isFullscreen ? t('mapView.exit_fullscreen', 'Exit full screen') : t('mapView.fullscreen', 'Full screen')}>
            {isFullscreen ? <Collapse width={16} height={16} /> : <Expand width={16} height={16} />}
          </button>

          {/* Marker Stats Overlay — bottom left */}
          {stats && (
            <div className="mapview-stats-overlay">
              {stats.unassigned != null && (
                <div className="mapview-stat">
                  <span className="mapview-stat-dot" style={{ background: '#f59e0b' }} />
                  <span className="mapview-stat-val">{stats.unassigned}</span>
                  <span className="mapview-stat-label">{t('mapView.unassigned', 'Unassigned')}</span>
                </div>
              )}
              {stats.active != null && (
                <div className="mapview-stat">
                  <span className="mapview-stat-dot" style={{ background: '#3b82f6' }} />
                  <span className="mapview-stat-val">{stats.active}</span>
                  <span className="mapview-stat-label">{t('mapView.active', 'Active')}</span>
                </div>
              )}
              {stats.mechanics != null && (
                <div className="mapview-stat">
                  <span className="mapview-stat-dot" style={{ background: '#22c55e' }} />
                  <span className="mapview-stat-val">{stats.mechanics}</span>
                  <span className="mapview-stat-label">{t('mapView.technicians', 'Technicians')}</span>
                </div>
              )}
            </div>
          )}

          {/* Floating Legend — bottom right, above footer */}
          <div className={`mapview-legend ${showLegend ? '' : 'collapsed'}`}>
            <button className="mapview-legend-toggle" onClick={() => setShowLegend(l => !l)}>
              <NavArrowDown width={12} height={12} style={{ transform: showLegend ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', marginRight: 4 }} />
              {t('mapView.legend', 'Legend')}
            </button>
            {showLegend && (
              <div className="mapview-legend-items">
                <div className="mapview-legend-item">
                  <span className="mapview-legend-dot" style={{ background: '#ef4444' }} /> {t('mapView.unassigned', 'Unassigned')}
                </div>
                <div className="mapview-legend-item">
                  <span className="mapview-legend-dot" style={{ background: '#7c3aed' }} /> {t('mapView.in_work', 'In work')}
                </div>
                <div className="mapview-legend-item">
                  <span className="mapview-legend-dot" style={{ background: '#1e40af' }} /> {t('mapView.customer_location', 'Customer location')}
                </div>
                <div className="mapview-legend-item">
                  <span className="mapview-legend-dot" style={{ background: '#16a34a' }} /> {t('mapView.technicians', 'Technicians')}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});

export default MapView;
