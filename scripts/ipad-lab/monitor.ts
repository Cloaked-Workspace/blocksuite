import './style.css';
const params = new URLSearchParams(location.search);
async function refresh() {
  try {
    const response = await fetch(`/api/report?room=${encodeURIComponent(params.get('room') ?? 'ipad-baseline')}`, {
      headers: { 'x-lab-token': params.get('token') ?? '' }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const report = await response.json();
    const container = document.getElementById('clients')!;
    container.replaceChildren();
    if (!report.clients.length) container.textContent = 'Väntar på att en enhet öppnar testlänken.';
    for (const client of report.clients) {
      const section = document.createElement('section');
      const heading = document.createElement('h2');
      heading.textContent = client.summary.deviceName || client.client;
      const status = document.createElement('p');
      const age = Math.round((Date.now() - Date.parse(client.lastSeen)) / 1000);
      status.textContent = `Senast sedd för ${age} s sedan · ${client.summary.mode} · ${client.summary.syncStatus}`;
      const observations = document.createElement('pre');
      observations.textContent = JSON.stringify(client.events.filter((event: { kind: string }) => ['observation', 'error', 'sync-error'].includes(event.kind)).slice(-12), null, 2);
      const details = document.createElement('details');
      const title = document.createElement('summary');
      title.textContent = 'Enhet, penna, viewport och senaste händelser';
      const content = document.createElement('pre');
      content.textContent = JSON.stringify({ summary: client.summary, events: client.events.slice(-12) }, null, 2);
      details.append(title, content);
      section.append(heading, status, observations, details);
      container.append(section);
    }
    document.getElementById('status')!.textContent = `${report.clients.length} testsessioner · uppdaterad ${new Date().toLocaleTimeString('sv-SE')}`;
  } catch (error) { document.getElementById('status')!.textContent = `Ingen anslutning: ${error}`; }
  setTimeout(refresh, 2000);
}
void refresh();
