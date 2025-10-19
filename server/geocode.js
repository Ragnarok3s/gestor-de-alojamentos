const https = require('https');

async function geocodeAddress(query) {
  const search = typeof query === 'string' ? query.trim() : '';
  if (!search) return null;

  const headers = {
    'User-Agent': 'gestor-de-alojamentos/1.0 (+https://example.com)'
  };

  function requestJson(url) {
    return new Promise(resolve => {
      const req = https.request(url, { headers }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            console.warn('Geocoding parse failed:', err.message);
            resolve(null);
          }
        });
      });
      req.on('error', err => {
        console.warn('Geocoding request failed:', err.message);
        resolve(null);
      });
      req.setTimeout(4000, () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });
  }

  async function tryPhoton() {
    try {
      const photonUrl = new URL('https://photon.komoot.io/api/');
      photonUrl.searchParams.set('q', search);
      photonUrl.searchParams.set('limit', '1');
      photonUrl.searchParams.set('lang', 'pt');
      const payload = await requestJson(photonUrl);
      if (payload && Array.isArray(payload.features) && payload.features.length) {
        const feature = payload.features[0];
        const geometry = feature && feature.geometry;
        if (geometry && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
          const [lon, lat] = geometry.coordinates;
          const latitude = Number.isFinite(lat) ? lat : null;
          const longitude = Number.isFinite(lon) ? lon : null;
          if (latitude != null || longitude != null) {
            return { latitude, longitude };
          }
        }
      }
    } catch (err) {
      console.warn('Photon geocoding failed:', err.message);
    }
    return null;
  }

  async function tryNominatim() {
    try {
      const nominatimUrl = new URL('https://nominatim.openstreetmap.org/search');
      nominatimUrl.searchParams.set('format', 'jsonv2');
      nominatimUrl.searchParams.set('limit', '1');
      nominatimUrl.searchParams.set('countrycodes', 'pt');
      nominatimUrl.searchParams.set('addressdetails', '0');
      nominatimUrl.searchParams.set('q', search);
      const payload = await requestJson(nominatimUrl);
      if (Array.isArray(payload) && payload.length) {
        const match = payload[0];
        const lat = match && match.lat != null ? Number.parseFloat(match.lat) : NaN;
        const lon = match && match.lon != null ? Number.parseFloat(match.lon) : NaN;
        const latitude = Number.isFinite(lat) ? lat : null;
        const longitude = Number.isFinite(lon) ? lon : null;
        if (latitude != null || longitude != null) {
          return { latitude, longitude };
        }
      }
    } catch (err) {
      console.warn('Nominatim geocoding failed:', err.message);
    }
    return null;
  }

  const primary = await tryPhoton();
  if (primary) return primary;
  return await tryNominatim();
}

module.exports = { geocodeAddress };
