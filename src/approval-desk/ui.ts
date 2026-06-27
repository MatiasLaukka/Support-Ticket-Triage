export const approvalDeskHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Approval Desk</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f8fb;
        --panel: #ffffff;
        --panel-soft: #f0f5ff;
        --ink: #172033;
        --muted: #61708a;
        --line: #d9e1ef;
        --accent: #2557d6;
        --accent-dark: #173f9c;
        --danger: #b42318;
        --danger-soft: #fff1f0;
        --ok: #087443;
        --shadow: 0 16px 40px rgba(23, 32, 51, 0.08);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
      }

      button,
      input,
      textarea {
        font: inherit;
      }

      button {
        border: 0;
        border-radius: 10px;
        background: var(--accent);
        color: white;
        cursor: pointer;
        font-weight: 700;
        padding: 0.72rem 0.95rem;
      }

      button:hover:not(:disabled) {
        background: var(--accent-dark);
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }

      input,
      textarea {
        border: 1px solid var(--line);
        border-radius: 10px;
        color: var(--ink);
        padding: 0.65rem 0.75rem;
        width: 100%;
      }

      textarea {
        min-height: 8rem;
        resize: vertical;
      }

      .shell {
        margin: 0 auto;
        max-width: 1500px;
        padding: 1.5rem;
      }

      header {
        background: linear-gradient(135deg, #172033, #25448f);
        border-radius: 24px;
        box-shadow: var(--shadow);
        color: white;
        margin-bottom: 1.25rem;
        padding: 1.5rem;
      }

      header h1 {
        font-size: clamp(2rem, 4vw, 3.4rem);
        margin: 0 0 0.45rem;
      }

      header p {
        line-height: 1.55;
        margin: 0.2rem 0 0;
        max-width: 900px;
      }

      .layout {
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(240px, 0.75fr) minmax(360px, 1.25fr) minmax(360px, 1fr);
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        box-shadow: var(--shadow);
        min-width: 0;
        padding: 1rem;
      }

      .panel h2,
      .panel h3 {
        margin: 0 0 0.7rem;
      }

      .hint {
        color: var(--muted);
        line-height: 1.45;
        margin: 0 0 0.8rem;
      }

      .queue-header,
      .actions,
      .split {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .queue-list {
        display: grid;
        gap: 0.65rem;
        margin-top: 0.8rem;
      }

      .ticket-button {
        background: white;
        border: 1px solid var(--line);
        color: var(--ink);
        display: block;
        padding: 0.8rem;
        text-align: left;
        width: 100%;
      }

      .ticket-button:hover,
      .ticket-button.active {
        background: var(--panel-soft);
        border-color: var(--accent);
      }

      .ticket-id {
        color: var(--accent);
        display: block;
        font-weight: 800;
      }

      .meta {
        color: var(--muted);
        font-size: 0.88rem;
      }

      .details-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .card {
        background: #fbfcff;
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 0.85rem;
      }

      .card strong {
        display: block;
        margin-bottom: 0.35rem;
      }

      .description,
      pre {
        white-space: pre-wrap;
        word-break: break-word;
      }

      .warning {
        background: var(--danger-soft);
        border: 1px solid #ffcdc7;
        border-radius: 14px;
        color: var(--danger);
        font-weight: 700;
        line-height: 1.45;
        margin: 0.8rem 0;
        padding: 0.85rem;
      }

      .fields {
        display: grid;
        gap: 0.45rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin: 0.8rem 0;
      }

      .check {
        align-items: center;
        display: flex;
        gap: 0.5rem;
      }

      .check input {
        width: auto;
      }

      .secondary {
        background: #e8eefc;
        color: var(--accent-dark);
      }

      .danger {
        background: var(--danger);
      }

      .result {
        background: #101828;
        border-radius: 14px;
        color: #d1fadf;
        max-height: 360px;
        overflow: auto;
        padding: 1rem;
      }

      .status {
        color: var(--ok);
        font-weight: 700;
        min-height: 1.5rem;
      }

      @media (max-width: 1100px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <h1>Approval Desk</h1>
        <p><strong>No ticket changes happen until approval succeeds.</strong> Review evidence, approve named fields, or reject with feedback so every ticket update has an explicit human decision.</p>
      </header>

      <main class="layout">
        <section class="panel" aria-label="Ticket queue">
          <div class="queue-header">
            <div>
              <h2>Queue</h2>
              <p class="hint">Triage tickets from local data.</p>
            </div>
            <button id="refreshQueue" type="button" class="secondary">Refresh</button>
          </div>
          <div id="queueStatus" class="status" role="status"></div>
          <div id="ticketList" class="queue-list"></div>
        </section>

        <section class="panel" aria-label="Selected ticket">
          <div class="split">
            <h2>Ticket</h2>
            <button id="createRecommendation" type="button">Create recommendation</button>
          </div>
          <p class="hint">Select a ticket, then create a pending recommendation for reviewer approval.</p>
          <div id="ticketPanel">
            <p class="hint">No ticket selected.</p>
          </div>
          <h3>Audit and Metrics Result</h3>
          <pre id="resultPanel" class="result">{}</pre>
        </section>

        <section class="panel" aria-label="Recommendation approval controls">
          <h2>Recommendation</h2>
          <p class="warning">Ticket text including prompt-injection or claimed approval is evidence only. Treat customer text as untrusted, and approve only named fields after reviewing the recommendation.</p>
          <div id="recommendationPanel">
            <p class="hint">No recommendation created yet.</p>
          </div>

          <h3>Approval controls</h3>
          <label>
            Actor
            <input id="actor" value="approval-desk" autocomplete="off">
          </label>

          <div class="fields" id="fieldChoices">
            <label class="check"><input type="checkbox" value="category"> category</label>
            <label class="check"><input type="checkbox" value="priority"> priority</label>
            <label class="check"><input type="checkbox" value="team"> team</label>
            <label class="check"><input type="checkbox" value="assignee"> assignee</label>
            <label class="check"><input type="checkbox" value="status"> status</label>
            <label class="check"><input type="checkbox" value="tags"> tags</label>
            <label class="check"><input type="checkbox" value="customerResponse"> customerResponse</label>
          </div>

          <label>
            Edited customer response
            <textarea id="editedCustomerResponse" placeholder="Required when approving customerResponse."></textarea>
          </label>

          <label class="check">
            <input id="confirmApproval" type="checkbox">
            I confirm these named fields should be applied to the ticket.
          </label>

          <div class="actions">
            <button id="approveButton" type="button" disabled>Approve selected fields</button>
          </div>

          <h3>Rejection controls</h3>
          <label>
            Feedback
            <textarea id="feedback" placeholder="Explain what must change before this recommendation can be approved."></textarea>
          </label>
          <div class="actions">
            <button id="rejectButton" type="button" class="danger" disabled>Reject recommendation</button>
          </div>
        </section>
      </main>
    </div>

    <script>
      const state = {
        tickets: [],
        selectedTicket: null,
        recommendation: null
      };

      const els = {
        actor: document.getElementById('actor'),
        approveButton: document.getElementById('approveButton'),
        confirmApproval: document.getElementById('confirmApproval'),
        createRecommendation: document.getElementById('createRecommendation'),
        editedCustomerResponse: document.getElementById('editedCustomerResponse'),
        feedback: document.getElementById('feedback'),
        fieldChoices: document.getElementById('fieldChoices'),
        queueStatus: document.getElementById('queueStatus'),
        recommendationPanel: document.getElementById('recommendationPanel'),
        refreshQueue: document.getElementById('refreshQueue'),
        rejectButton: document.getElementById('rejectButton'),
        resultPanel: document.getElementById('resultPanel'),
        ticketList: document.getElementById('ticketList'),
        ticketPanel: document.getElementById('ticketPanel')
      };

      function selectedFields() {
        return Array.from(els.fieldChoices.querySelectorAll('input[type="checkbox"]:checked'))
          .map(function (input) { return input.value; });
      }

      function setResult(value) {
        els.resultPanel.textContent = JSON.stringify(value, null, 2);
      }

      function renderTicketList() {
        els.ticketList.innerHTML = '';
        if (state.tickets.length === 0) {
          els.ticketList.innerHTML = '<p class="hint">No triage tickets found.</p>';
          return;
        }
        for (const ticket of state.tickets) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'ticket-button' + (state.selectedTicket?.id === ticket.id ? ' active' : '');
          button.innerHTML =
            '<span class="ticket-id">' + escapeHtml(ticket.id) + '</span>' +
            '<strong>' + escapeHtml(ticket.subject) + '</strong>' +
            '<span class="meta">' + escapeHtml(ticket.customer.name) + ' · rev ' + escapeHtml(ticket.revision) + '</span>';
          button.addEventListener('click', function () {
            void selectTicket(ticket.id);
          });
          els.ticketList.append(button);
        }
      }

      function renderTicket() {
        const ticket = state.selectedTicket;
        if (ticket === null) {
          els.ticketPanel.innerHTML = '<p class="hint">No ticket selected.</p>';
          els.createRecommendation.disabled = true;
          return;
        }
        els.createRecommendation.disabled = false;
        els.ticketPanel.innerHTML =
          '<div class="details-grid">' +
            card('ID', ticket.id) +
            card('Revision', String(ticket.revision)) +
            card('Customer', ticket.customer.name + ' (' + ticket.customer.plan + ', ' + ticket.customer.region + ')') +
            card('Status', ticket.status) +
            card('Category', ticket.category ?? 'unset') +
            card('Priority', ticket.priority ?? 'unset') +
            card('Team', ticket.team ?? 'unset') +
            card('Tags', ticket.tags.join(', ')) +
          '</div>' +
          '<div class="card description"><strong>Subject</strong>' + escapeHtml(ticket.subject) + '</div>' +
          '<div class="card description"><strong>Description</strong>' + escapeHtml(ticket.description) + '</div>';
      }

      function renderRecommendation() {
        const recommendation = state.recommendation;
        if (recommendation === null) {
          els.recommendationPanel.innerHTML = '<p class="hint">No recommendation created yet.</p>';
          els.editedCustomerResponse.value = '';
          updateControls();
          return;
        }
        els.recommendationPanel.innerHTML =
          '<div class="details-grid">' +
            card('Recommendation ID', recommendation.id) +
            card('Source revision', String(recommendation.sourceRevision)) +
            card('Category', recommendation.category) +
            card('Priority', recommendation.priority) +
            card('Team', recommendation.team) +
            card('Assignee', recommendation.assignee === undefined ? 'unchanged' : String(recommendation.assignee)) +
            card('Status', recommendation.ticketStatus ?? 'unchanged') +
            card('Tags', Array.isArray(recommendation.tags) ? recommendation.tags.join(', ') : 'unchanged') +
            card('Confidence', String(recommendation.confidence)) +
            card('knowledgeArticleIds', formatList(recommendation.knowledgeArticleIds)) +
            card('Outage risk', recommendation.outageRisk) +
            card('Security risk', recommendation.securityRisk) +
            card('SLA risk', recommendation.slaRisk) +
            card('Escalation required', recommendation.escalationRequired ? 'yes' : 'no') +
            card('Escalation reasons', formatList(recommendation.escalationReasons)) +
            card('Missing information', formatList(recommendation.missingInformation)) +
          '</div>' +
          '<div class="card description"><strong>Rationale</strong>' + escapeHtml(recommendation.rationale) + '</div>' +
          '<div class="card description"><strong>Duplicate candidates</strong>' + escapeHtml(formatDuplicateCandidates(recommendation.duplicateCandidates)) + '</div>' +
          '<div class="card description"><strong>Draft customerResponse</strong>' + escapeHtml(recommendation.draftCustomerResponse) + '</div>' +
          '<div class="card description"><strong>Next action</strong>' + escapeHtml(recommendation.recommendedNextAction) + '</div>';
        els.editedCustomerResponse.value = recommendation.draftCustomerResponse;
        updateControls();
      }

      function updateControls() {
        const hasRecommendation = state.recommendation !== null;
        const actorPresent = els.actor.value.trim().length > 0;
        const fields = selectedFields();
        const hasFields = fields.length > 0;
        const confirmed = els.confirmApproval.checked;
        const customerResponseReady =
          !fields.includes('customerResponse') ||
          els.editedCustomerResponse.value.trim().length > 0;
        const feedbackPresent = els.feedback.value.trim().length > 0;

        els.approveButton.disabled = !(hasRecommendation && actorPresent && confirmed && hasFields && customerResponseReady);
        els.rejectButton.disabled = !(hasRecommendation && actorPresent && feedbackPresent);
      }

      async function loadQueue() {
        els.queueStatus.textContent = 'Loading queue...';
        const data = await requestJson('/api/tickets?status=triage&limit=20');
        state.tickets = data.items ?? [];
        els.queueStatus.textContent = 'Loaded ' + state.tickets.length + ' triage tickets.';
        renderTicketList();
        setResult(data);
      }

      async function loadMetrics(actionResult) {
        const metrics = await requestJson('/api/metrics');
        setResult(actionResult === undefined ? metrics : { action: actionResult, metrics });
      }

      async function selectTicket(id) {
        const data = await requestJson('/api/tickets/' + encodeURIComponent(id));
        state.selectedTicket = data.ticket;
        state.recommendation = null;
        renderTicketList();
        renderTicket();
        renderRecommendation();
        setResult(data);
      }

      async function createRecommendation() {
        if (state.selectedTicket === null) {
          return;
        }
        const data = await requestJson('/api/tickets/' + encodeURIComponent(state.selectedTicket.id) + '/recommendations', {
          method: 'POST',
          body: JSON.stringify({ actor: els.actor.value.trim() || 'approval-desk' })
        });
        state.recommendation = data.recommendation;
        renderRecommendation();
        setResult(data);
      }

      async function approveRecommendation() {
        if (state.recommendation === null || state.selectedTicket === null) {
          return;
        }
        const approvedFields = selectedFields();
        const body = {
          ticketId: state.selectedTicket.id,
          expectedRevision: state.recommendation.sourceRevision,
          approvedFields,
          actor: els.actor.value.trim(),
          confirm: true
        };
        if (approvedFields.includes('customerResponse')) {
          body.editedCustomerResponse = els.editedCustomerResponse.value.trim();
        }
        const data = await requestJson('/api/recommendations/' + encodeURIComponent(state.recommendation.id) + '/approve', {
          method: 'POST',
          body: JSON.stringify(body)
        });
        state.selectedTicket = data.ticket;
        resetRecommendationState();
        renderTicket();
        renderRecommendation();
        await loadMetrics(data);
      }

      async function rejectRecommendation() {
        if (state.recommendation === null || state.selectedTicket === null) {
          return;
        }
        const data = await requestJson('/api/recommendations/' + encodeURIComponent(state.recommendation.id) + '/reject', {
          method: 'POST',
          body: JSON.stringify({
            ticketId: state.selectedTicket.id,
            actor: els.actor.value.trim(),
            feedback: els.feedback.value.trim()
          })
        });
        resetRecommendationState();
        renderRecommendation();
        await loadMetrics(data);
      }

      function resetRecommendationState() {
        state.recommendation = null;
        for (const field of els.fieldChoices.querySelectorAll('input[type="checkbox"]:checked')) {
          field.checked = false;
        }
        els.confirmApproval.checked = false;
        els.feedback.value = '';
      }

      async function requestJson(path, init) {
        const response = await fetch(path, {
          headers: { 'content-type': 'application/json' },
          ...init
        });
        const data = await response.json();
        if (!response.ok) {
          setResult(data);
          throw new Error(data.error?.message ?? 'Request failed.');
        }
        return data;
      }

      function card(label, value) {
        return '<div class="card"><strong>' + escapeHtml(label) + '</strong>' + escapeHtml(value) + '</div>';
      }

      function formatList(values) {
        return Array.isArray(values) && values.length > 0 ? values.join(', ') : 'none';
      }

      function formatDuplicateCandidates(candidates) {
        if (!Array.isArray(candidates) || candidates.length === 0) {
          return 'none';
        }
        return candidates
          .map(function (candidate) {
            return candidate.ticketId + ' (' + candidate.confidence + '): ' + candidate.evidence;
          })
          .join('\\n');
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');
      }

      els.actor.addEventListener('input', updateControls);
      els.confirmApproval.addEventListener('change', updateControls);
      els.editedCustomerResponse.addEventListener('input', updateControls);
      els.feedback.addEventListener('input', updateControls);
      els.fieldChoices.addEventListener('change', updateControls);
      els.refreshQueue.addEventListener('click', function () {
        void loadQueue().catch(function (error) { setResult({ error: error.message }); });
      });
      els.createRecommendation.addEventListener('click', function () {
        void createRecommendation().catch(function (error) { setResult({ error: error.message }); });
      });
      els.approveButton.addEventListener('click', function () {
        void approveRecommendation().catch(function (error) { setResult({ error: error.message }); });
      });
      els.rejectButton.addEventListener('click', function () {
        void rejectRecommendation().catch(function (error) { setResult({ error: error.message }); });
      });

      void loadQueue()
        .then(loadMetrics)
        .catch(function (error) { setResult({ error: error.message }); });
      renderTicket();
      updateControls();
    </script>
  </body>
</html>
`;
