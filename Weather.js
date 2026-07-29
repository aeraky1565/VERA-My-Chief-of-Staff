// ============================================================
// VERA — Weather.js
// Morning email weather ticker — OpenWeatherMap + Open-Meteo
//
// Script Properties required:
//   WEATHER_API_KEY — free key from openweathermap.org
//
// Config tab required:
//   weather_location — city name (e.g. "Austin, TX")
//
// Data sources:
//   9am/6pm forecast + rain chance → OWM /data/2.5/forecast (free tier)
//   Air Quality Index              → OWM /data/2.5/air_pollution (free tier)
//   UV Index                       → Open-Meteo (no key required)
// ============================================================

// AQI scale — OWM air_pollution returns 1 (Good) … 5 (Very Poor)
var AQI_LABELS = ['', 'Good',    'Fair',    'Moderate', 'Poor',    'Very Poor'];
var AQI_COLORS = ['', '#43a047', '#8bc34a', '#f9a825',  '#e53935', '#7b1fa2'  ];

// ---- Helpers ------------------------------------------------

/**
 * Maps OpenWeatherMap weather[0].main string to an emoji.
 */
function weatherEmoji_(conditionMain) {
  var map = {
    'Clear':        '☀️',
    'Clouds':       '⛅',
    'Rain':         '🌧️',
    'Drizzle':      '🌦️',
    'Thunderstorm': '⛈️',
    'Snow':         '❄️',
    'Mist':         '🌫️',
    'Smoke':        '🌫️',
    'Haze':         '🌫️',
    'Dust':         '🌫️',
    'Fog':          '🌫️',
    'Sand':         '🌫️',
    'Ash':          '🌫️',
    'Squall':       '💨',
    'Tornado':      '🌪️',
  };
  return map[conditionMain] || '🌡️';
}

// ---- API calls ----------------------------------------------

/**
 * Converts a human-readable city name (any format) to lat/lon via OWM Geocoding API.
 * Returns { lat, lon } or null on any error.
 * Accepts formats like "Austin, TX", "Austin Texas", "Austin,US", "New York City", etc.
 */
function geocodeLocation_(location, apiKey) {
  // Normalize: remove spaces after commas ("Fairfax, VA" → "Fairfax,VA")
  var compact = location.replace(/,\s+/g, ',');

  // Build candidate queries to try in order:
  // 1. Normalized form (e.g. "Fairfax,VA")
  // 2. If it looks like "City,ST" (2-letter suffix, no country yet), also try "City,ST,US"
  var candidates = [compact];
  if (/^[^,]+,[A-Za-z]{2}$/.test(compact)) {
    candidates.push(compact + ',US');
  }

  for (var i = 0; i < candidates.length; i++) {
    var url = 'https://api.openweathermap.org/geo/1.0/direct?q=' +
              encodeURIComponent(candidates[i]) +
              '&limit=1&appid=' + encodeURIComponent(apiKey);
    var response = fetchWithHealth_('openweathermap', url);
    if (!response) continue;   // failure already recorded by the wrapper
    try {
      var results = JSON.parse(response.getContentText());
      if (results && results.length > 0) {
        return { lat: results[0].lat, lon: results[0].lon };
      }
    } catch (e) {
      Logger.log('geocodeLocation_ parse error for "' + candidates[i] + '": ' + e.message);
      recordApiHealth_('openweathermap', false, 'geocode parse error: ' + e.message, 200);
    }
  }

  Logger.log('Geocoding: no results for "' + location + '" (tried: ' + candidates.join(', ') + ')');
  recordApiHealth_('openweathermap', false, 'no geocoding results for "' + location + '"', 200);
  return null;
}

/**
 * Calls OWM /forecast with cnt=8 (next 24 h, 3-hour intervals).
 * Geocodes the city name first to get lat/lon (OWM recommends lat/lon over q= city name).
 * Returns parsed JSON or null.
 */
function fetchWeatherForecast_(location, apiKey) {
  var coords = geocodeLocation_(location, apiKey);
  if (!coords) return null;
  var url = 'https://api.openweathermap.org/data/2.5/forecast?' +
            'lat=' + coords.lat + '&lon=' + coords.lon +
            '&appid=' + encodeURIComponent(apiKey) +
            '&units=imperial&cnt=8';
  var response = fetchWithHealth_('openweathermap', url);
  if (!response) return null;
  try {
    return JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log('fetchWeatherForecast_ parse error: ' + e.message);
    recordApiHealth_('openweathermap', false, 'forecast parse error: ' + e.message, 200);
    return null;
  }
}

/**
 * From a 3-hour forecast list, returns the entry whose local time hour
 * is closest to targetHour (0–23). Uses the city timezone offset from OWM.
 */
function findForecastSlot_(list, targetHour, tzOffsetSec) {
  var best     = null;
  var bestDiff = 999;
  list.forEach(function(entry) {
    var localTs   = entry.dt + tzOffsetSec;
    var localHour = Math.floor((localTs % 86400 + 86400) % 86400 / 3600);
    var diff = Math.abs(localHour - targetHour);
    if (diff < bestDiff) { bestDiff = diff; best = entry; }
  });
  return best;
}

/**
 * Calls OWM /air_pollution. Returns { index, label, color } or null.
 */
function fetchAQI_(lat, lon, apiKey) {
  var url = 'https://api.openweathermap.org/data/2.5/air_pollution?lat=' +
            lat + '&lon=' + lon + '&appid=' + encodeURIComponent(apiKey);
  var response = fetchWithHealth_('openweathermap-aqi', url);
  if (!response) return null;
  try {
    var data = JSON.parse(response.getContentText());
    var idx  = (data.list && data.list[0]) ? data.list[0].main.aqi : null;
    if (!idx) {
      recordApiHealth_('openweathermap-aqi', false, 'response contained no AQI index', 200);
      return null;
    }
    return { index: idx, label: AQI_LABELS[idx] || 'Unknown', color: AQI_COLORS[idx] || '#888888' };
  } catch (e) {
    Logger.log('fetchAQI_ error: ' + e.message);
    recordApiHealth_('openweathermap-aqi', false, 'AQI parse error: ' + e.message, 200);
    return null;
  }
}

/**
 * Calls Open-Meteo (no key needed) for the UV index at the current local hour.
 * Returns integer UV value or null.
 */
function fetchUVIndex_(lat, lon) {
  var url = 'https://api.open-meteo.com/v1/forecast' +
            '?latitude=' + lat + '&longitude=' + lon +
            '&hourly=uv_index&forecast_days=1&timezone=auto';
  var response = fetchWithHealth_('open-meteo', url);
  if (!response) return null;
  try {
    var data = JSON.parse(response.getContentText());
    if (!data.hourly || !data.hourly.uv_index) {
      recordApiHealth_('open-meteo', false, 'response contained no uv_index series', 200);
      return null;
    }
    var hour = parseInt(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'), 10);
    return Math.round(data.hourly.uv_index[hour] || 0);
  } catch (e) {
    Logger.log('fetchUVIndex_ error: ' + e.message);
    recordApiHealth_('open-meteo', false, 'UV parse error: ' + e.message, 200);
    return null;
  }
}

// ---- HTML builder -------------------------------------------

/**
 * Assembles the ticker <tr> row from forecast data.
 * Returns '' if no meaningful data is available.
 */
function buildTickerHtml_(slot9am, slot6pm, rainPct, aqi, uvi) {
  var sep     = '<span style="color:rgba(201,168,76,0.6);margin:0 10px;">|</span>';
  var muted   = '#8a8a8a';   // Issue #138: a dash in grey reads as "no data", not as a value
  var parts   = [];

  if (slot9am) {
    var e9 = weatherEmoji_(slot9am.weather[0].main);
    var t9 = Math.round(slot9am.main.temp);
    parts.push(e9 + '&nbsp;<strong style="color:#ffffff;">9AM</strong>&nbsp;' + t9 + '&deg;F');
  }
  if (slot6pm) {
    var e6 = weatherEmoji_(slot6pm.weather[0].main);
    var t6 = Math.round(slot6pm.main.temp);
    parts.push(e6 + '&nbsp;<strong style="color:#ffffff;">6PM</strong>&nbsp;' + t6 + '&deg;F');
  }

  // Issue #138: rainPct is null when no forecast slot was available. Previously
  // this defaulted to 0 and rendered "Rain 0%" — a fabricated value presented
  // as fact. Show an explicit dash instead.
  if (rainPct === null || rainPct === undefined) {
    parts.push('🌧️&nbsp;Rain&nbsp;<strong style="color:' + muted + ';">&mdash;</strong>');
  } else {
    parts.push('🌧️&nbsp;Rain&nbsp;<strong style="color:#ffffff;">' + rainPct + '%</strong>');
  }

  if (aqi) {
    parts.push('🌿&nbsp;AQI&nbsp;<strong style="color:' + aqi.color + ';">' + aqi.label + '</strong>');
  } else {
    parts.push('🌿&nbsp;AQI&nbsp;<strong style="color:' + muted + ';">&mdash;</strong>');
  }

  if (uvi !== null && uvi !== undefined) {
    var uvColor = uvi <= 2 ? '#43a047' : uvi <= 5 ? '#f9a825' : uvi <= 7 ? '#e53935' : '#7b1fa2';
    parts.push('☀️&nbsp;UV&nbsp;<strong style="color:' + uvColor + ';">' + uvi + '</strong>');
  } else {
    parts.push('☀️&nbsp;UV&nbsp;<strong style="color:' + muted + ';">&mdash;</strong>');
  }

  if (parts.length === 0) return '';

  return (
    '<tr>' +
    '<td style="background:#0d1b3e;padding:10px 24px;border-top:1px solid rgba(201,168,76,0.25);">' +
    '<p style="margin:0;text-align:center;font-size:13px;color:#cccccc;letter-spacing:0.3px;">' +
    parts.join(sep) +
    '</p>' +
    '</td>' +
    '</tr>'
  );
}

/**
 * Issue #138: replaces the silent empty string when weather cannot be fetched.
 * The ticker vanishing entirely was indistinguishable from "weather not
 * configured" — this says plainly that the data is missing and why.
 */
function buildWeatherUnavailableHtml_(reason) {
  return (
    '<tr>' +
    '<td style="background:#0d1b3e;padding:10px 24px;border-top:1px solid rgba(201,168,76,0.25);">' +
    '<p style="margin:0;text-align:center;font-size:13px;color:#8a8a8a;letter-spacing:0.3px;">' +
    '⚠️&nbsp;Weather <strong style="color:#e8b44a;">not live</strong>' +
    (reason ? '&nbsp;&mdash;&nbsp;' + reason : '') +
    '</p>' +
    '</td>' +
    '</tr>'
  );
}

// ---- Main entry point ----------------------------------------

/**
 * Builds and returns the weather ticker <tr> HTML string.
 * Returns '' (empty string) if not configured or if any error occurs,
 * so the morning email always sends even without weather data.
 */
function getWeatherTicker_() {
  try {
    var cfg      = getConfigValues();
    var location = (cfg['weather_location'] || '').trim();
    var apiKey   = PropertiesService.getScriptProperties().getProperty('WEATHER_API_KEY');

    // Genuinely not configured — stay silent. This is the one case where an
    // empty ticker is correct, because there is nothing the user expects to see.
    if (!location || !apiKey) return '';

    var forecast = fetchWeatherForecast_(location, apiKey);
    if (!forecast) {
      // Issue #138: configured but failing. Say so instead of vanishing.
      var health = getApiHealth_('openweathermap');
      return buildWeatherUnavailableHtml_(
        health.lastError ? health.lastError.substring(0, 80) : 'forecast fetch failed'
      );
    }

    var lat      = forecast.city.coord.lat;
    var lon      = forecast.city.coord.lon;
    var tzOffset = forecast.city.timezone;  // seconds from UTC

    var slot9am = findForecastSlot_(forecast.list, 9,  tzOffset);
    var slot6pm = findForecastSlot_(forecast.list, 18, tzOffset);

    // null (not 0) when there is no slot to read a probability from — buildTickerHtml_
    // renders that as a dash rather than inventing "Rain 0%".
    var rainPct = (slot9am && slot9am.pop !== undefined && slot9am.pop !== null)
      ? Math.round(slot9am.pop * 100)
      : null;

    var aqi = fetchAQI_(lat, lon, apiKey);
    var uvi = fetchUVIndex_(lat, lon);

    return buildTickerHtml_(slot9am, slot6pm, rainPct, aqi, uvi);
  } catch (e) {
    Logger.log('getWeatherTicker_ error: ' + e.message);
    recordApiHealth_('openweathermap', false, 'ticker build error: ' + e.message, 0);
    return buildWeatherUnavailableHtml_('weather lookup errored');
  }
}

// ---- Debug helper -------------------------------------------

function testWeather() {
  var ticker = getWeatherTicker_();
  if (!ticker) {
    Logger.log('testWeather: no ticker returned — check weather_location Config row and WEATHER_API_KEY Script Property.');
  } else {
    Logger.log('testWeather: ticker HTML length = ' + ticker.length + ' chars.');
    Logger.log(ticker);
  }
}
