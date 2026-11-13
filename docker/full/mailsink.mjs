// Stands in for Resend in docker-compose.full.yml so account recovery and two-step login work without an
// email provider: the app sends here (RESEND_API_URL) what it would send to Resend, and this prints each
// message, code included, to its log (`docker compose ... logs mailsink`). Nothing leaves the machine.
import http from 'node:http';

let sent = 0;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/emails') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const mail = JSON.parse(body);
        sent += 1;
        console.log(`--- email ${sent} to ${[].concat(mail.to).join(', ')}: ${mail.subject}\n${mail.text}\n`);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: String(sent) }));
      } catch {
        res.writeHead(400).end();
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
  res.writeHead(404).end();
});

server.listen(8025, '0.0.0.0');
