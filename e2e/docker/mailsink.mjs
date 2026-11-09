// A stand-in for Resend in the end-to-end stack. The app sends here (RESEND_API_URL) exactly what it
// would send to Resend; specs read the messages back to type the codes they carry. Nothing leaves the
// machine, and the messages live only in this process.
import http from 'node:http';

const messages = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://mailsink');
  if (req.method === 'POST' && url.pathname === '/emails') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const mail = JSON.parse(body);
        messages.push({ to: mail.to, subject: mail.subject, text: mail.text, at: Date.now() });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: String(messages.length) }));
      } catch {
        res.writeHead(400).end();
      }
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/emails') {
    const to = url.searchParams.get('to');
    const found = to ? messages.filter((m) => Array.isArray(m.to) && m.to.includes(to)) : messages;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(found));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/healthz') { res.writeHead(200).end('ok'); return; }
  res.writeHead(404).end();
});

server.listen(8025, '0.0.0.0');
