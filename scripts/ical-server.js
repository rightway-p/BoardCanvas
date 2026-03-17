#!/usr/bin/env node

const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8787);

function toDateYYYYMMDD(value, fallback) {
  if (!value) return fallback;
  const m = String(value).match(/^\d{8}$/);
  return m ? m[0] : fallback;
}

function normalizeStatus(value) {
  const s = String(value || '').toLowerCase();
  if (s === 'reserved' || s === 'booked') return 'Reserved';
  if (s === 'closed' || s === 'blocked') return 'CLOSED - Not available';
  return 'CLOSED - Not available';
}

function foldLine(line, limit = 75) {
  if (line.length <= limit) return [line];
  const out = [];
  let index = 0;
  while (index < line.length) {
    const chunk = line.slice(index, index + limit);
    out.push(index === 0 ? chunk : ` ${chunk}`);
    index += limit;
  }
  return out;
}

function buildIcs({
  uid,
  dtStamp,
  dtStart,
  dtEnd,
  summary,
  description,
  prodId = '-//Custom iCal Demo//EN',
}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTAMP:${dtStamp}`,
    `DTSTART;VALUE=DATE:${dtStart}`,
    `DTEND;VALUE=DATE:${dtEnd}`,
    `UID:${uid}`,
    `SUMMARY:${summary}`,
    ...(description ? [`DESCRIPTION:${description}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const folded = lines.flatMap((line) => foldLine(line));
  return `${folded.join('\r\n')}\r\n`;
}

function nowStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function handler(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end([
      'Custom iCal demo server is running.',
      '',
      'Try:',
      `  http://localhost:${PORT}/calendar.ics`,
      `  http://localhost:${PORT}/calendar.ics?start=20260501&end=20260505&status=closed`,
      `  http://localhost:${PORT}/airbnb.ics?start=20260404&end=20260414`,
      '',
      'Accepted params: start=YYYYMMDD end=YYYYMMDD status=closed|reserved',
    ].join('\n'));
    return;
  }

  if (requestUrl.pathname !== '/calendar.ics' && requestUrl.pathname !== '/airbnb.ics') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const dtStart = toDateYYYYMMDD(requestUrl.searchParams.get('start'), '20260506');
  const dtEnd = toDateYYYYMMDD(requestUrl.searchParams.get('end'), '20260510');
  const fromAirbnbStyle = requestUrl.pathname === '/airbnb.ics';

  const summary = fromAirbnbStyle
    ? 'Reserved'
    : normalizeStatus(requestUrl.searchParams.get('status'));

  const uid = `${Date.now()}-${Math.random().toString(16).slice(2)}@custom-ical.local`;
  const dtStamp = nowStamp();

  const description = fromAirbnbStyle
    ? 'Reservation URL: https://example.com/reservation/ABC123\\nPhone Number (Last 4 Digits): 1234'
    : '';

  const prodId = fromAirbnbStyle
    ? '-//Custom Airbnb-like Feed//EN'
    : '-//Custom Booking-like Feed//EN';

  const ics = buildIcs({ uid, dtStamp, dtStart, dtEnd, summary, description, prodId });

  res.writeHead(200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(ics);
}

http.createServer(handler).listen(PORT, () => {
  console.log(`iCal demo server running on http://localhost:${PORT}`);
});
