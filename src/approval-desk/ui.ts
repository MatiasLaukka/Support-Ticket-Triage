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
      select,
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
      select,
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

      .queue-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin-top: 0.75rem;
      }

      .queue-filter {
        border: 1px solid var(--line);
        padding: 0.32rem 0.65rem;
      }

      .queue-filter.active {
        background: var(--accent);
        border-color: var(--accent);
        color: white;
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

      .ticket-button.state-active {
        border-color: #b8c7e6;
      }

      .ticket-button.state-pending {
        background: #fff9e8;
        border-color: #f4c542;
      }

      .ticket-button.state-approved {
        background: #ecfdf3;
        border-color: #23a06b;
      }

      .ticket-button.risk-security {
        background: #fff7f6;
        border-color: #f2a39b;
        box-shadow: inset 4px 0 0 var(--danger);
      }

      .ticket-button:hover,
      .ticket-button.active {
        background: var(--panel-soft);
        border-color: var(--accent);
      }

      .ticket-button.risk-security:hover,
      .ticket-button.risk-security.active {
        background: #fff0ee;
        border-color: var(--danger);
      }

      .ticket-id {
        color: var(--accent);
        display: block;
        font-weight: 800;
      }

      .ticket-subject-line {
        display: block;
        font-weight: 800;
        line-height: 1.18;
        margin-top: 0.18rem;
      }

      .ticket-meta-line {
        color: var(--muted);
        display: block;
        font-size: 0.86rem;
        line-height: 1.3;
        margin-top: 0.18rem;
      }

      .meta {
        color: var(--muted);
        font-size: 0.88rem;
      }

      .queue-badges,
      .setup-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin-top: 0.65rem;
      }

      .setup-grid {
        align-items: end;
      }

      .setup-grid label {
        flex: 1 1 180px;
      }

      .setup-grid button {
        flex: 1 1 180px;
      }

      .details-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .evidence-dashboard {
        margin-bottom: 1rem;
      }

      .evidence-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .evidence-lists {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 1rem;
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

      .card p {
        margin: 0.35rem 0 0;
      }

      .conversation-context details {
        margin-top: 0.55rem;
      }

      .conversation-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin: 0.65rem 0;
      }

      .conversation-controls button {
        padding: 0.45rem 0.65rem;
      }

      .reply-preview {
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.4;
      }

      .requester-card .requester-name {
        display: block;
        line-height: 1.35;
      }

      .requester-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-top: 0.55rem;
      }

      .requester-pill {
        background: var(--panel-soft);
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--muted);
        font-size: 0.82rem;
        font-weight: 700;
        padding: 0.22rem 0.5rem;
      }

      .hero-card {
        background: #f8fbff;
        border: 1px solid var(--line);
        border-radius: 16px;
        margin-bottom: 0.75rem;
        padding: 1rem;
      }

      .hero-card strong {
        display: block;
        margin-bottom: 0.35rem;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin-bottom: 0.75rem;
      }

      .chip {
        background: var(--panel-soft);
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--accent-dark);
        font-size: 0.85rem;
        font-weight: 700;
        padding: 0.28rem 0.55rem;
      }

      .classifier-card {
        background: #f8fbff;
      }

      .classifier-card .chips {
        margin-bottom: 0.35rem;
      }

      .classifier-summary {
        display: grid;
        gap: 0.45rem;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        margin-bottom: 0.65rem;
      }

      .classifier-signal-group {
        border-top: 1px solid var(--line);
        margin-top: 0.75rem;
        padding-top: 0.75rem;
      }

      .classifier-signal-group h4 {
        font-size: 0.92rem;
        margin: 0 0 0.45rem;
      }

      .classifier-signal-row {
        background: white;
        border: 1px solid var(--line);
        border-radius: 12px;
        display: grid;
        gap: 0.3rem;
        margin-top: 0.45rem;
        padding: 0.65rem;
      }

      .classifier-signal-row code {
        color: var(--muted);
        font-size: 0.8rem;
        white-space: pre-wrap;
        word-break: break-word;
      }

      details {
        border: 1px solid var(--line);
        border-radius: 14px;
        margin-top: 0.75rem;
        padding: 0.75rem;
      }

      summary {
        cursor: pointer;
        font-weight: 800;
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

      .safety-note {
        background: var(--danger-soft);
        border-color: #ffcdc7;
        margin: 0.45rem 0 0.75rem;
        padding: 0.55rem 0.7rem;
      }

      .safety-note summary {
        align-items: center;
        color: var(--danger);
        display: flex;
        gap: 0.55rem;
      }

      .safety-note p {
        color: var(--danger);
        font-size: 0.88rem;
        font-weight: 600;
        line-height: 1.4;
        margin: 0.55rem 0 0;
      }

      .safety-icon {
        align-items: center;
        background: var(--danger);
        border-radius: 999px;
        color: white;
        display: inline-flex;
        flex: 0 0 auto;
        font-size: 0.82rem;
        height: 1.55rem;
        justify-content: center;
        width: 1.55rem;
      }

      .fields {
        display: grid;
        gap: 0.75rem;
        margin: 0.8rem 0;
      }

      .approval-row {
        background: #fbfcff;
        border: 1px solid var(--line);
        border-radius: 14px;
        display: grid;
        gap: 0.55rem;
        grid-template-columns: minmax(130px, 0.8fr) minmax(160px, 1fr);
        padding: 0.8rem;
      }

      .approval-row .check {
        align-items: flex-start;
        font-weight: 800;
      }

      .approval-row small {
        color: var(--muted);
        display: block;
        font-weight: 500;
        margin-top: 0.2rem;
      }

      .field-control {
        align-items: stretch;
        background: #fbfcff;
        border: 1px solid var(--line);
        border-radius: 14px;
        display: grid;
        gap: 0.65rem;
        grid-template-columns: 1fr;
        padding: 0.8rem;
      }

      .field-heading {
        align-items: center;
        display: flex;
        gap: 0.65rem;
        justify-content: space-between;
      }

      .field-title-group {
        align-items: baseline;
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem 0.55rem;
      }

      .field-label {
        font-weight: 800;
      }

      .field-control .value-label {
        display: block;
        margin: 0;
      }

      .field-control .meta {
        align-self: center;
      }

      .field-approve-button {
        min-width: 5.5rem;
        width: auto;
      }

      .field-action-row {
        align-items: center;
        display: grid;
        gap: 0.65rem;
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .info-button {
        align-self: center;
        background: var(--danger);
        border-radius: 999px;
        color: white;
        height: 2rem;
        padding: 0;
        width: 2rem;
      }

      .stage-actions {
        justify-content: flex-end;
        margin: 0.3rem 0 0.95rem;
      }

      .classifier-reference {
        align-items: center;
        background: var(--panel-soft);
        border: 1px solid var(--line);
        border-radius: 12px;
        display: flex;
        gap: 0.65rem;
        justify-content: space-between;
        margin-top: 0.75rem;
        padding: 0.65rem 0.75rem;
      }

      .inline-review-button {
        padding: 0.45rem 0.7rem;
        white-space: nowrap;
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
        .layout,
        .evidence-grid,
        .evidence-lists {
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

      <section class="panel evidence-dashboard" aria-label="Automation Evidence">
        <div class="split">
          <div>
            <h2>Automation Evidence</h2>
            <p class="hint">Live guardrails, activity, and automation value from the local approval desk.</p>
          </div>
          <button id="refreshEvidence" type="button" class="secondary">Refresh evidence</button>
        </div>
        <div id="evidencePanel" class="evidence-grid">
          <p class="hint">Loading automation evidence...</p>
        </div>
        <div class="evidence-lists">
          <section class="card" aria-label="Guardrails Active">
            <h3>Guardrails Active</h3>
            <div id="guardrailsPanel">
              <p class="hint">Loading guardrails...</p>
            </div>
          </section>
          <section class="card" aria-label="Recent Activity">
            <h3>Recent Activity</h3>
            <div id="activityPanel">
              <p class="hint">Loading recent activity...</p>
            </div>
          </section>
        </div>
      </section>

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
          <div id="queueFilters" class="queue-filters" aria-label="Queue filters">
            <button type="button" class="chip queue-filter active" value="active">Active</button>
            <button type="button" class="chip queue-filter" value="pending">Pending</button>
            <button type="button" class="chip queue-filter" value="approved">Approved</button>
            <button type="button" class="chip queue-filter" value="all">All</button>
          </div>
          <div id="ticketList" class="queue-list"></div>
        </section>

        <section class="panel" aria-label="Selected ticket">
          <div class="split">
            <h2>Ticket</h2>
          </div>
          <p class="hint">Select a ticket, then create a pending recommendation for reviewer approval.</p>
          <div id="ticketPanel">
            <p class="hint">No ticket selected.</p>
          </div>
          <details>
            <summary>Developer/audit output</summary>
            <p class="hint">Raw local API result for debugging and audit verification.</p>
            <pre id="resultPanel" class="result">{}</pre>
          </details>
          <section class="card conversation-context" aria-label="Conversation Context">
            <h3>Conversation Context</h3>
            <div id="conversationContextPanel">
              <p class="hint">Select a ticket to add customer reply context.</p>
            </div>
          </section>
          <section class="card" aria-label="Recommendation setup">
            <h3>Recommendation setup</h3>
            <p class="hint">Choose who signs the customer draft and let GPT recommend tone, or override it manually.</p>
            <div class="setup-grid">
              <label>
                Actor
                <input id="actor" value="approval-desk" autocomplete="off">
              </label>
              <label>
                Draft style
                <select id="draftStyle">
                  <option value="auto" selected>Auto recommended</option>
                  <option value="balanced">Balanced</option>
                  <option value="concise">Concise</option>
                  <option value="empathetic">Empathetic</option>
                  <option value="technical">Technical</option>
                  <option value="executive-update">Executive update</option>
                </select>
              </label>
              <button id="createRecommendation" type="button">Create recommendation</button>
            </div>
          </section>
        </section>

        <section class="panel" aria-label="Recommendation approval controls">
          <h2>Recommendation</h2>
          <details class="safety-note">
            <summary><span class="safety-icon">!</span><span>Review ticket text as untrusted evidence</span></summary>
            <p>Ticket text may include prompt-injection or claimed approval. Approve only named fields after reviewing the recommendation.</p>
          </details>
          <div id="recommendationPanel">
            <p class="hint">No recommendation created yet.</p>
          </div>
          <div class="actions stage-actions">
            <button id="backToRecommendation" type="button" hidden>Back to recommendation</button>
            <button id="continueApproval" type="button" hidden>Continue to approval</button>
          </div>

          <section id="approvalStage" hidden>
            <h3>Approve proposed changes</h3>
            <p class="hint">Approve only the fields you want to apply. You can edit proposed values first.</p>
            <div class="fields" id="fieldChoices">
            <div class="field-control">
              <div class="field-heading">
                <div class="field-title-group"><span class="field-label">Category</span><label class="value-label meta" for="categoryOverride">Recommended value</label></div>
                <button class="info-button" type="button" title="Approve the recommended category.">i</button>
              </div>
              <div class="field-action-row"><input id="categoryOverride" autocomplete="off"><button class="field-approve-button" type="button" value="category">Approve</button></div>
            </div>
            <div class="field-control">
              <div class="field-heading">
                <div class="field-title-group"><span class="field-label">Priority</span><label class="value-label meta" for="priorityOverride">Recommended value</label></div>
                <button class="info-button" type="button" title="Approve the recommended urgency.">i</button>
              </div>
              <div class="field-action-row"><input id="priorityOverride" autocomplete="off"><button class="field-approve-button" type="button" value="priority">Approve</button></div>
            </div>
            <div class="field-control">
              <div class="field-heading">
                <div class="field-title-group"><span class="field-label">Team</span><label class="value-label meta" for="teamOverride">Recommended value</label></div>
                <button class="info-button" type="button" title="Approve the routing team.">i</button>
              </div>
              <div class="field-action-row"><input id="teamOverride" autocomplete="off"><button class="field-approve-button" type="button" value="team">Approve</button></div>
            </div>
            <div class="field-control">
              <div class="field-heading">
                <div class="field-title-group"><span class="field-label">Assignee</span><label class="value-label meta" for="assigneeOverride">Recommended value</label></div>
                <button class="info-button" type="button" title="Approve an owner if recommended.">i</button>
              </div>
              <div class="field-action-row"><input id="assigneeOverride" autocomplete="off"><button class="field-approve-button" type="button" value="assignee">Approve</button></div>
            </div>
            <div class="field-control">
              <div class="field-heading">
                <div class="field-title-group"><span class="field-label">Status</span><label class="value-label meta" for="statusOverride">Recommended value</label></div>
                <button class="info-button" type="button" title="Approve a status change if recommended.">i</button>
              </div>
              <div class="field-action-row"><input id="statusOverride" autocomplete="off"><button class="field-approve-button" type="button" value="status">Approve</button></div>
            </div>
            <div class="field-control">
              <div class="field-heading">
                <div class="field-title-group"><span class="field-label">Tags</span><label class="value-label meta" for="tagsOverride">Recommended value</label></div>
                <button class="info-button" type="button" title="Approve comma-separated ticket tags.">i</button>
              </div>
              <div class="field-action-row"><input id="tagsOverride" autocomplete="off"><button class="field-approve-button" type="button" value="tags">Approve</button></div>
            </div>
            <div class="field-control">
              <div class="field-heading">
                <div class="field-title-group"><span class="field-label">Customer response</span><span class="meta">Edit the full response below.</span></div>
                <button class="info-button" type="button" title="Approve edited customer-facing wording.">i</button>
              </div>
              <div class="field-action-row"><span class="meta">Review the draft text below before approving.</span><button class="field-approve-button" type="button" value="customerResponse">Approve</button></div>
            </div>
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
        </section>
      </main>
    </div>

    <script>
      const state = {
        tickets: [],
        selectedTicket: null,
        recommendation: null,
        stage: 'empty',
        queueFilter: 'active',
        approvedFields: [],
        customerRepliesByTicketId: {}
      };

      const els = {
        actor: document.getElementById('actor'),
        approvalStage: document.getElementById('approvalStage'),
        assigneeOverride: document.getElementById('assigneeOverride'),
        approveButton: document.getElementById('approveButton'),
        backToRecommendation: document.getElementById('backToRecommendation'),
        categoryOverride: document.getElementById('categoryOverride'),
        confirmApproval: document.getElementById('confirmApproval'),
        conversationContextPanel: document.getElementById('conversationContextPanel'),
        continueApproval: document.getElementById('continueApproval'),
        createRecommendation: document.getElementById('createRecommendation'),
        draftStyle: document.getElementById('draftStyle'),
        editedCustomerResponse: document.getElementById('editedCustomerResponse'),
        evidencePanel: document.getElementById('evidencePanel'),
        feedback: document.getElementById('feedback'),
        fieldChoices: document.getElementById('fieldChoices'),
        guardrailsPanel: document.getElementById('guardrailsPanel'),
        activityPanel: document.getElementById('activityPanel'),
        queueFilters: document.getElementById('queueFilters'),
        queueStatus: document.getElementById('queueStatus'),
        recommendationPanel: document.getElementById('recommendationPanel'),
        priorityOverride: document.getElementById('priorityOverride'),
        refreshEvidence: document.getElementById('refreshEvidence'),
        refreshQueue: document.getElementById('refreshQueue'),
        rejectButton: document.getElementById('rejectButton'),
        resultPanel: document.getElementById('resultPanel'),
        statusOverride: document.getElementById('statusOverride'),
        tagsOverride: document.getElementById('tagsOverride'),
        teamOverride: document.getElementById('teamOverride'),
        ticketList: document.getElementById('ticketList'),
        ticketPanel: document.getElementById('ticketPanel')
      };

      function selectedFields() {
        return state.approvedFields.slice();
      }

      function setResult(value) {
        els.resultPanel.textContent = JSON.stringify(value, null, 2);
      }

      function renderTicketList() {
        els.ticketList.innerHTML = '';
        if (state.tickets.length === 0) {
          els.queueStatus.textContent = 'Loaded 0 tickets.';
          els.ticketList.innerHTML = '<p class="hint">No tickets found.</p>';
          return;
        }
        const visibleTickets = filteredTickets();
        els.queueStatus.textContent = 'Showing ' + visibleTickets.length + ' of ' + state.tickets.length + ' tickets.';
        renderQueueFilters();
        if (visibleTickets.length === 0) {
          els.ticketList.innerHTML = '<p class="hint">No ' + escapeHtml(state.queueFilter) + ' tickets in this view.</p>';
          return;
        }
        for (const ticket of visibleTickets) {
          const button = document.createElement('button');
          button.type = 'button';
          const workflowState = ticketWorkflowState(ticket);
          button.className = 'ticket-button state-' + workflowState +
            (isSecurityTicket(ticket) ? ' risk-security' : '') +
            (state.selectedTicket?.id === ticket.id ? ' active' : '');
          button.innerHTML =
            '<span class="ticket-id">' + escapeHtml(ticket.id) + '</span>' +
            '<span class="ticket-subject-line">' + escapeHtml(ticket.subject) + '</span>' +
            '<span class="ticket-meta-line">' + escapeHtml(ticket.customer.name) + '</span>' +
            '<span class="ticket-meta-line">rev ' + escapeHtml(ticket.revision) + ' · ' + escapeHtml(workflowState) + '</span>' +
            renderQueueBadges(ticket);
          button.addEventListener('click', function () {
            void selectTicket(ticket.id);
          });
          els.ticketList.append(button);
        }
      }

      function filteredTickets() {
        if (state.queueFilter === 'all') {
          return state.tickets;
        }
        return state.tickets.filter(function (ticket) {
          return ticketWorkflowState(ticket) === state.queueFilter;
        });
      }

      function ticketWorkflowState(ticket) {
        return ticket.recommendationSummary?.workflowState ?? 'active';
      }

      function isSecurityTicket(ticket) {
        const summary = ticket.recommendationSummary ?? {};
        if (summary.securityRisk === 'possible' || summary.securityRisk === 'likely') {
          return true;
        }
        const searchable = [
          ticket.category,
          ticket.subject,
          ticket.description,
          ...(Array.isArray(ticket.tags) ? ticket.tags : [])
        ].filter(Boolean).join(' ').toLowerCase();
        return /security|secret|api key|credential|webhook signature|exposed|prompt-injection/.test(searchable);
      }

      function renderQueueFilters() {
        for (const button of els.queueFilters.querySelectorAll('.queue-filter')) {
          button.className = 'chip queue-filter' + (button.value === state.queueFilter ? ' active' : '');
        }
      }

      function setQueueFilter(value) {
        state.queueFilter = value;
        renderTicketList();
      }

      function renderTicket() {
        const ticket = state.selectedTicket;
        if (ticket === null) {
          els.ticketPanel.innerHTML = '<p class="hint">No ticket selected.</p>';
          els.createRecommendation.disabled = true;
          return;
        }
        els.createRecommendation.disabled = isApprovedWorkflow();
        els.ticketPanel.innerHTML =
          '<div class="chips">' +
            chip(ticket.id) +
            chip(ticket.priority ?? 'unset priority') +
            chip(ticket.status) +
            chip(ticket.team ?? 'unset team') +
          '</div>' +
          renderRequesterCard(ticket) +
          '<div class="hero-card description"><strong>Subject</strong>' + escapeHtml(ticket.subject) + '</div>' +
          '<div class="hero-card description"><strong>Description</strong>' + escapeHtml(ticket.description) + '</div>' +
          '<details><summary>Technical ticket details</summary>' +
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
          '</details>';
      }

      function currentCustomerReplies() {
        if (state.selectedTicket === null) {
          return [];
        }
        return state.customerRepliesByTicketId[state.selectedTicket.id] ?? [];
      }

      function renderConversationContext() {
        if (state.selectedTicket === null) {
          els.conversationContextPanel.innerHTML = '<p class="hint">Select a ticket to add customer reply context.</p>';
          return;
        }
        const replies = currentCustomerReplies();
        const latest = replies[replies.length - 1];
        const summary = replies.length === 0
          ? 'No customer replies added.'
          : replies.length + ' ' + (replies.length === 1 ? 'reply' : 'replies') + ' attached. Latest: ' + previewText(latest.body);
        els.conversationContextPanel.innerHTML =
          '<p class="hint">' + escapeHtml(summary) + '</p>' +
          '<details><summary>Add or review synthetic replies</summary>' +
            '<p class="hint">These buttons add customer-message context only. The backend still infers lifecycle state from the text.</p>' +
            '<div class="conversation-controls">' +
              scenarioButton('vague-reply', 'Add vague reply') +
              scenarioButton('partial-evidence', 'Add partial evidence') +
              scenarioButton('complete-evidence', 'Add complete evidence') +
              scenarioButton('known-cause-evidence', 'Add known-cause evidence') +
              scenarioButton('platform-fix-context', 'Add platform-fix context') +
              scenarioButton('resolved-confirmation', 'Add resolved confirmation') +
              scenarioButton('clear-replies', 'Clear replies') +
            '</div>' +
            renderConversationReplies(replies) +
          '</details>';
      }

      function scenarioButton(value, label) {
        return '<button type="button" class="secondary conversation-scenario" value="' + escapeHtml(value) + '">' + escapeHtml(label) + '</button>';
      }

      function renderConversationReplies(replies) {
        if (replies.length === 0) {
          return '<p class="reply-preview">No synthetic replies are attached to this ticket.</p>';
        }
        return replies.map(function (reply) {
          return '<div class="card description"><strong>' + escapeHtml(reply.id) + '</strong>' + escapeHtml(reply.body) + '</div>';
        }).join('');
      }

      function previewText(value) {
        return value.length > 110 ? value.slice(0, 107) + '...' : value;
      }

      function renderQueueBadges(ticket) {
        const summary = ticket.recommendationSummary ?? {};
        const badges = [
          summary.priority ?? ticket.priority,
          summary.slaRisk === 'likely' || ticket.sla?.breached ? 'SLA risk' : null,
          summary.outageRisk === 'likely' ? 'Outage risk' : null,
          summary.securityRisk === 'possible' || summary.securityRisk === 'likely' ? 'Security risk' : null
        ].filter(Boolean);
        if (badges.length === 0) {
          return '';
        }
        return '<span class="queue-badges">' + badges.map(chip).join('') + '</span>';
      }

      function renderRequesterCard(ticket) {
        const requester = ticket.requester;
        if (requester === undefined || requester === null) {
          return card('Requester', 'Unknown requester');
        }
        return '<div class="card requester-card">' +
          '<strong>Requester</strong>' +
          '<span class="requester-name">' + escapeHtml(requester.name + ' · ' + requester.role) + '</span>' +
          '<span class="requester-meta">' +
            '<span class="requester-pill">' + escapeHtml(requester.department) + '</span>' +
            '<span class="requester-pill">' + escapeHtml(requester.technicalLevel) + '</span>' +
          '</span>' +
        '</div>';
      }

      function renderRecommendation(preserveApprovalInputs) {
        const recommendation = state.recommendation;
        if (recommendation === null) {
          els.recommendationPanel.innerHTML = '<p class="hint">No recommendation created yet.</p>';
          state.stage = 'empty';
          els.editedCustomerResponse.value = '';
          clearApprovalInputs();
          renderRecommendationStageControls();
          updateControls();
          return;
        }
        if (isApprovedWorkflow()) {
          els.recommendationPanel.innerHTML =
            '<div class="hero-card description"><strong>Approved Draft Customer Response</strong>' + escapeHtml(recommendation.draftCustomerResponse) + '</div>' +
            '<p class="hint">This recommendation is approved. Cancel approval before creating a replacement recommendation.</p>' +
            '<details><summary>All proposed ticket values</summary>' +
              '<div class="details-grid">' +
              card('Category', recommendation.category) +
              card('Priority', recommendation.priority) +
              card('Team', recommendation.team) +
              card('Assignee', recommendation.assignee === undefined ? 'unchanged' : String(recommendation.assignee)) +
              card('Status', recommendation.ticketStatus ?? 'unchanged') +
              card('Tags', Array.isArray(recommendation.tags) ? recommendation.tags.join(', ') : 'unchanged') +
              '</div>' +
            '</details>';
        } else if (state.stage === 'approval') {
          els.recommendationPanel.innerHTML =
            '<div class="hero-card"><strong>Approval mode</strong>' +
              '<p class="hint">Recommendation details are tucked away while you apply fields. Go back if you need to review the full draft, evidence, or GPT assist notes.</p>' +
              '<div class="chips">' +
                chip('Category: ' + recommendation.category) +
                chip('Priority: ' + recommendation.priority) +
                chip('Team: ' + recommendation.team) +
                chip('Status: ' + (recommendation.ticketStatus ?? 'unchanged')) +
              '</div>' +
              renderClassifierEvidenceReference(recommendation) +
            '</div>';
        } else {
          els.recommendationPanel.innerHTML =
            '<div class="hero-card"><strong>Recommended Triage</strong>' +
              '<div class="chips">' +
                chip('Category: ' + recommendation.category) +
                chip('Priority: ' + recommendation.priority) +
                chip('Team: ' + recommendation.team) +
                chip('Risk: ' + (recommendation.escalationRequired ? 'escalation' : 'none')) +
              '</div>' +
            '</div>' +
            renderClassifierEvidenceCard(recommendation) +
            renderLifecycleSummaryCard(recommendation) +
            '<div class="hero-card description"><strong>Draft Customer Response</strong>' + escapeHtml(recommendation.draftCustomerResponse) + '</div>' +
            '<p class="hint">Continue to approval when the draft looks ready.</p>' +
            '<details><summary>Why this draft is safe</summary>' +
              '<div class="chips">' +
                chip('Source: ' + (recommendation.draftCustomerResponseSource ?? 'legacy')) +
                chip('Style: ' + (recommendation.draftCustomerResponseStyle ?? 'balanced')) +
                chip('Checks: ' + formatDraftCheckSummary(recommendation.draftCustomerResponseChecks)) +
                chip('Human approval: pending') +
              '</div>' +
              '<p>' + escapeHtml(formatDraftSafetyNarrative(recommendation)) + '</p>' +
              '<p class="meta"><strong>Retrieved context</strong> ' + escapeHtml(formatList(recommendation.knowledgeArticleIds)) + '</p>' +
              '<p class="meta"><strong>Human approval</strong> Reviewer must approve or edit before use.</p>' +
            '</details>' +
            renderGptAssistCard(recommendation.gptAssist) +
            '<details><summary>Evidence and internal details</summary>' +
              '<div class="details-grid">' +
                card('Recommendation ID', recommendation.id) +
                card('Source revision', String(recommendation.sourceRevision)) +
                card('Confidence', String(recommendation.confidence)) +
                card('knowledgeArticleIds', formatList(recommendation.knowledgeArticleIds)) +
                card('Outage risk', recommendation.outageRisk) +
                card('Security risk', recommendation.securityRisk) +
                card('SLA risk', recommendation.slaRisk) +
                card('Support state', recommendation.supportState ?? 'not assessed') +
                card('Known cause', recommendation.knownCause ?? 'none') +
                card('Escalation required', recommendation.escalationRequired ? 'yes' : 'no') +
                card('Escalation reasons', formatList(recommendation.escalationReasons)) +
                card('Missing information', formatList(recommendation.missingInformation)) +
                card('Missing evidence', formatEvidenceLabels(recommendation.missingEvidence)) +
                card('Provided evidence', formatEvidenceLabels(recommendation.providedEvidence)) +
              '</div>' +
              '<div class="card description"><strong>Rationale</strong>' + escapeHtml(recommendation.rationale) + '</div>' +
              '<div class="card description"><strong>Duplicate candidates</strong>' + escapeHtml(formatDuplicateCandidates(recommendation.duplicateCandidates)) + '</div>' +
              '<div class="card description"><strong>Next action</strong>' + escapeHtml(recommendation.recommendedNextAction) + '</div>' +
              '<div class="card description"><strong>Draft validation checks</strong>' + escapeHtml(formatDraftChecks(recommendation.draftCustomerResponseChecks)) + '</div>' +
            '</details>' +
            '<details><summary>All proposed ticket values</summary>' +
              '<div class="details-grid">' +
              card('Category', recommendation.category) +
              card('Priority', recommendation.priority) +
              card('Team', recommendation.team) +
              card('Assignee', recommendation.assignee === undefined ? 'unchanged' : String(recommendation.assignee)) +
              card('Status', recommendation.ticketStatus ?? 'unchanged') +
              card('Tags', Array.isArray(recommendation.tags) ? recommendation.tags.join(', ') : 'unchanged') +
              '</div>' +
            '</details>';
        }
        if (!preserveApprovalInputs) {
          els.editedCustomerResponse.value = recommendation.draftCustomerResponse;
          populateApprovalInputs(recommendation);
        }
        renderRecommendationStageControls();
        updateControls();
      }

      function renderRecommendationStageControls() {
        const hasRecommendation = state.recommendation !== null;
        els.continueApproval.textContent = isApprovedWorkflow() ? 'Cancel approval' : 'Continue to approval';
        els.continueApproval.hidden = !(hasRecommendation && (state.stage === 'draft' || isApprovedWorkflow()));
        els.backToRecommendation.hidden = !(hasRecommendation && state.stage === 'approval');
        els.approvalStage.hidden = !(hasRecommendation && state.stage === 'approval');
      }

      function updateControls() {
        const hasRecommendation = state.recommendation !== null;
        const approvedWorkflow = isApprovedWorkflow();
        const actorPresent = els.actor.value.trim().length > 0;
        const fields = selectedFields();
        const hasFields = fields.length > 0;
        const confirmed = els.confirmApproval.checked;
        const customerResponseReady =
          !fields.includes('customerResponse') ||
          els.editedCustomerResponse.value.trim().length > 0;
        const feedbackPresent = els.feedback.value.trim().length > 0;

        els.approveButton.disabled = !(hasRecommendation && !approvedWorkflow && actorPresent && confirmed && hasFields && customerResponseReady);
        els.rejectButton.disabled = !(hasRecommendation && !approvedWorkflow && actorPresent && feedbackPresent);
      }

      async function loadQueue() {
        els.queueStatus.textContent = 'Loading queue...';
        const data = await requestJson('/api/tickets?limit=50');
        state.tickets = data.items ?? [];
        renderTicketList();
        setResult(data);
      }

      async function loadMetrics(actionResult) {
        const metrics = await requestJson('/api/metrics');
        setResult(actionResult === undefined ? metrics : { action: actionResult, metrics });
      }

      async function loadEvidence(writeErrorToResult) {
        const report = await requestJson('/api/evidence', undefined, { writeErrorToResult });
        renderEvidence(report);
      }

      async function refreshEvidenceBestEffort() {
        try {
          await loadEvidence(false);
        } catch (error) {
          renderEvidenceError(error);
        }
      }

      function renderEvidence(report) {
        const summary = report.summary ?? {};
        els.evidencePanel.innerHTML =
          card('Open tickets', formatEvidenceValue(summary.openTickets)) +
          card('Pending recommendations', formatEvidenceValue(summary.pendingRecommendations)) +
          card('Approved recommendations', formatEvidenceValue(summary.approvedRecommendations)) +
          card('Rejected recommendations', formatEvidenceValue(summary.rejectedRecommendations)) +
          card('Estimated minutes saved', formatEvidenceValue(summary.estimatedMinutesSaved)) +
          card('Audit events', formatEvidenceValue(summary.auditEvents)) +
          card('Safety blocks', formatEvidenceValue(summary.safetyBlocks)) +
          card('Active guardrails', formatEvidenceValue(summary.activeGuardrails));

        renderGuardrails(report.guardrails);
        renderActivity(report.recentActivity);
      }

      function renderEvidenceError(error) {
        const message = error instanceof Error ? error.message : 'Evidence refresh failed.';
        els.evidencePanel.innerHTML = '<p class="warning">Automation evidence could not be refreshed: ' + escapeHtml(message) + '</p>';
      }

      function renderGuardrails(guardrails) {
        if (!Array.isArray(guardrails) || guardrails.length === 0) {
          els.guardrailsPanel.innerHTML = '<p class="hint">No active guardrail evidence yet.</p>';
          return;
        }

        els.guardrailsPanel.innerHTML = guardrails
          .map(function (guardrail) {
            return '<div class="card description">' +
              '<strong>' + escapeHtml(guardrail.label ?? guardrail.id ?? 'Guardrail') + '</strong>' +
              '<span class="meta">' + escapeHtml(guardrail.id ?? 'unknown') + ' · ' + escapeHtml(guardrail.status ?? 'unknown') + '</span>' +
              '<p>' + escapeHtml(guardrail.evidence ?? 'No evidence recorded.') + '</p>' +
            '</div>';
          })
          .join('');
      }

      function renderActivity(activity) {
        if (!Array.isArray(activity) || activity.length === 0) {
          els.activityPanel.innerHTML = '<p class="hint">No recent automation activity yet.</p>';
          return;
        }

        els.activityPanel.innerHTML = activity
          .map(function (event) {
            const details = [
              event.ticketId === undefined ? null : 'ticket ' + event.ticketId,
              event.recommendationId === undefined ? null : 'recommendation ' + event.recommendationId
            ].filter(Boolean).join(' · ');
            return '<div class="card description">' +
              '<strong>' + escapeHtml(event.action ?? 'activity') + '</strong>' +
              '<span class="meta">' + escapeHtml(event.timestamp ?? 'unknown time') + ' · ' + escapeHtml(event.result ?? 'unknown result') + '</span>' +
              '<p>' + escapeHtml(details || 'No ticket or recommendation reference.') + '</p>' +
            '</div>';
          })
          .join('');
      }

      async function selectTicket(id) {
        const data = await requestJson('/api/tickets/' + encodeURIComponent(id));
        state.selectedTicket = data.recommendationSummary === undefined
          ? data.ticket
          : { ...data.ticket, recommendationSummary: data.recommendationSummary };
        state.recommendation = data.latestRecommendation ?? null;
        state.stage = state.recommendation === null
          ? 'empty'
          : isApprovedWorkflow()
            ? 'approved'
            : 'draft';
        renderTicketList();
        renderTicket();
        renderConversationContext();
        renderRecommendation();
        setResult(data);
      }

      async function createRecommendation() {
        if (state.selectedTicket === null) {
          return;
        }
        if (isApprovedWorkflow()) {
          setResult({ error: 'Cancel approval before creating a new recommendation for this ticket.' });
          return;
        }
        if (state.recommendation?.resolution === 'pending') {
          const confirmed = confirm('This ticket already has a pending recommendation. Create a new one and mark the old one superseded?');
          if (!confirmed) {
            return;
          }
          await rejectCurrentRecommendation('Superseded by a new recommendation from the Approval Desk.');
          state.recommendation = null;
          state.stage = 'empty';
        }
        els.recommendationPanel.innerHTML = '<div class="hero-card"><strong>Generating GPT draft and assist...</strong><p class="hint">Creating a guarded recommendation from local ticket facts and retrieved knowledge.</p></div>';
        els.createRecommendation.disabled = true;
        try {
          const data = await requestJson('/api/tickets/' + encodeURIComponent(state.selectedTicket.id) + '/recommendations', {
            method: 'POST',
            body: JSON.stringify({
              actor: els.actor.value.trim() || 'approval-desk',
              responseStyle: els.draftStyle.value,
              customerReplies: currentCustomerReplies()
            })
          });
          state.recommendation = data.recommendation;
          state.stage = 'draft';
          markSelectedTicketWorkflow(data.recommendation, 'pending');
          renderRecommendation();
          setResult(data);
          await refreshEvidenceBestEffort();
        } finally {
          els.createRecommendation.disabled = false;
        }
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
        const fieldOverrides = collectFieldOverrides(approvedFields);
        if (Object.keys(fieldOverrides).length > 0) {
          body.fieldOverrides = fieldOverrides;
        }
        const approvedRecommendation = state.recommendation;
        const data = await requestJson('/api/recommendations/' + encodeURIComponent(state.recommendation.id) + '/approve', {
          method: 'POST',
          body: JSON.stringify(body)
        });
        state.recommendation = { ...approvedRecommendation, resolution: 'approved' };
        state.stage = 'approved';
        state.selectedTicket = withRecommendationSummary(data.ticket, state.recommendation, 'approved');
        replaceTicket(state.selectedTicket);
        resetApprovalControls();
        renderTicket();
        renderTicketList();
        renderRecommendation();
        await loadMetrics(data);
        await refreshEvidenceBestEffort();
      }

      async function rejectRecommendation() {
        if (state.recommendation === null || state.selectedTicket === null) {
          return;
        }
        const data = await rejectCurrentRecommendation(els.feedback.value.trim());
        markSelectedTicketActive();
        resetRecommendationState();
        renderTicket();
        renderTicketList();
        renderRecommendation();
        await loadMetrics(data);
        await refreshEvidenceBestEffort();
      }

      async function rejectCurrentRecommendation(feedback) {
        if (state.recommendation === null || state.selectedTicket === null) {
          throw new Error('No recommendation selected.');
        }
        return requestJson('/api/recommendations/' + encodeURIComponent(state.recommendation.id) + '/reject', {
          method: 'POST',
          body: JSON.stringify({
            ticketId: state.selectedTicket.id,
            actor: els.actor.value.trim(),
            feedback
          })
        });
      }

      async function cancelApprovedRecommendation() {
        if (state.recommendation === null || state.selectedTicket === null) {
          return;
        }
        const data = await requestJson('/api/recommendations/' + encodeURIComponent(state.recommendation.id) + '/cancel-approval', {
          method: 'POST',
          body: JSON.stringify({
            ticketId: state.selectedTicket.id,
            actor: els.actor.value.trim() || 'approval-desk',
            reason: 'Approval canceled from the Approval Desk before creating a replacement recommendation.'
          })
        });
        markSelectedTicketActive();
        state.recommendation = null;
        state.stage = 'empty';
        resetApprovalControls();
        renderTicket();
        renderTicketList();
        renderRecommendation();
        await loadMetrics(data);
        await refreshEvidenceBestEffort();
      }

      function resetRecommendationState() {
        state.recommendation = null;
        state.stage = 'empty';
        resetApprovalControls();
      }

      function resetApprovalControls() {
        state.approvedFields = [];
        els.confirmApproval.checked = false;
        els.feedback.value = '';
        clearApprovalInputs();
        renderFieldApprovalButtons();
      }

      function populateApprovalInputs(recommendation) {
        els.categoryOverride.value = recommendation.category;
        els.priorityOverride.value = recommendation.priority;
        els.teamOverride.value = recommendation.team;
        els.assigneeOverride.value = recommendation.assignee === undefined ? '' : String(recommendation.assignee ?? '');
        els.statusOverride.value = recommendation.ticketStatus ?? '';
        els.tagsOverride.value = Array.isArray(recommendation.tags) ? recommendation.tags.join(', ') : '';
        renderFieldApprovalButtons();
      }

      function clearApprovalInputs() {
        els.categoryOverride.value = '';
        els.priorityOverride.value = '';
        els.teamOverride.value = '';
        els.assigneeOverride.value = '';
        els.statusOverride.value = '';
        els.tagsOverride.value = '';
      }

      function collectFieldOverrides(approvedFields) {
        const overrides = {};
        if (approvedFields.includes('category') && els.categoryOverride.value.trim() !== state.recommendation.category) {
          overrides.category = els.categoryOverride.value.trim();
        }
        if (approvedFields.includes('priority') && els.priorityOverride.value.trim() !== state.recommendation.priority) {
          overrides.priority = els.priorityOverride.value.trim();
        }
        if (approvedFields.includes('team') && els.teamOverride.value.trim() !== state.recommendation.team) {
          overrides.team = els.teamOverride.value.trim();
        }
        if (approvedFields.includes('assignee')) {
          const assignee = els.assigneeOverride.value.trim();
          const proposed = state.recommendation.assignee === undefined ? '' : String(state.recommendation.assignee ?? '');
          if (assignee !== proposed) {
            overrides.assignee = assignee.length === 0 ? null : assignee;
          }
        }
        if (approvedFields.includes('status') && els.statusOverride.value.trim() !== (state.recommendation.ticketStatus ?? '')) {
          overrides.status = els.statusOverride.value.trim();
        }
        if (approvedFields.includes('tags')) {
          const tags = els.tagsOverride.value
            .split(',')
            .map(function (tag) { return tag.trim(); })
            .filter(Boolean);
          const proposedTags = Array.isArray(state.recommendation.tags) ? state.recommendation.tags : [];
          if (tags.join('\\n') !== proposedTags.join('\\n')) {
            overrides.tags = tags;
          }
        }
        return overrides;
      }

      function toggleFieldApproval(field) {
        state.approvedFields = state.approvedFields.includes(field)
          ? state.approvedFields.filter(function (approvedField) { return approvedField !== field; })
          : state.approvedFields.concat(field);
        renderFieldApprovalButtons();
        updateControls();
      }

      function renderFieldApprovalButtons() {
        for (const button of els.fieldChoices.querySelectorAll('.field-approve-button')) {
          const approved = state.approvedFields.includes(button.value);
          button.textContent = approved ? 'Cancel' : 'Approve';
          button.className = 'field-approve-button' + (approved ? ' danger' : '');
        }
      }

      function markSelectedTicketWorkflow(recommendation, workflowState) {
        if (state.selectedTicket === null) {
          return;
        }
        state.selectedTicket = withRecommendationSummary(state.selectedTicket, recommendation, workflowState);
        replaceTicket(state.selectedTicket);
        renderTicket();
        renderTicketList();
      }

      function markSelectedTicketActive() {
        if (state.selectedTicket === null) {
          return;
        }
        const ticket = { ...state.selectedTicket };
        delete ticket.recommendationSummary;
        state.selectedTicket = ticket;
        replaceTicket(ticket);
      }

      function isApprovedWorkflow() {
        return state.stage === 'approved' ||
          state.recommendation?.resolution === 'approved' ||
          state.selectedTicket?.recommendationSummary?.workflowState === 'approved';
      }

      function withRecommendationSummary(ticket, recommendation, workflowState) {
        return {
          ...ticket,
          recommendationSummary: {
            workflowState,
            recommendationId: recommendation.id,
            category: recommendation.category,
            priority: recommendation.priority,
            team: recommendation.team,
            outageRisk: recommendation.outageRisk,
            securityRisk: recommendation.securityRisk,
            slaRisk: recommendation.slaRisk,
            escalationRequired: recommendation.escalationRequired
          }
        };
      }

      function replaceTicket(ticket) {
        state.tickets = state.tickets.map(function (item) {
          return item.id === ticket.id ? ticket : item;
        });
      }

      async function requestJson(path, init, options) {
        const response = await fetch(path, {
          headers: { 'content-type': 'application/json' },
          ...init
        });
        const data = await response.json();
        if (!response.ok) {
          if (options?.writeErrorToResult !== false) {
            setResult(data);
          }
          throw new Error(data.error?.message ?? 'Request failed.');
        }
        return data;
      }

      function card(label, value) {
        return '<div class="card"><strong>' + escapeHtml(label) + '</strong>' + escapeHtml(value) + '</div>';
      }

      function chip(value) {
        return '<span class="chip">' + escapeHtml(value) + '</span>';
      }

      function renderClassifierEvidenceCard(recommendation) {
        const signals = Array.isArray(recommendation.classificationSignals)
          ? recommendation.classificationSignals
          : [];
        const summary =
          '<div class="classifier-summary" aria-label="Category: ' + escapeHtml(recommendation.category) + '; Priority: ' + escapeHtml(recommendation.priority) + '; Team: ' + escapeHtml(recommendation.team) + '; Confidence: ' + escapeHtml(String(recommendation.confidence)) + '">' +
            card('Category', recommendation.category) +
            card('Priority', recommendation.priority) +
            card('Team', recommendation.team) +
            card('Confidence', String(recommendation.confidence)) +
          '</div>';
        if (signals.length === 0) {
          return '<div class="hero-card classifier-card"><strong>Classifier evidence</strong>' +
            summary +
            '<p class="hint">No classifier signal snapshot stored for this recommendation.</p>' +
          '</div>';
        }
        const topChips = classifierTopChipLabels(signals)
          .map(chip)
          .join('');
        return '<div class="hero-card classifier-card"><strong>Classifier evidence</strong>' +
          summary +
          '<div class="chips">' + topChips + '</div>' +
          '<details><summary>Why this classification?</summary>' +
            renderClassifierSignalRows(signals) +
          '</details>' +
        '</div>';
      }

      function renderLifecycleSummaryCard(recommendation) {
        const provided = Array.isArray(recommendation.providedEvidence) ? recommendation.providedEvidence : [];
        const missing = Array.isArray(recommendation.missingEvidence) ? recommendation.missingEvidence : [];
        return '<div class="hero-card lifecycle-summary"><strong>Lifecycle summary</strong>' +
          '<div class="chips">' +
            chip('State: ' + (recommendation.supportState ?? 'not assessed')) +
            chip('Known cause: ' + (recommendation.knownCause ?? 'none')) +
            chip('Provided evidence: ' + provided.length) +
            chip('Missing evidence: ' + missing.length) +
          '</div>' +
          '<p class="hint">' + escapeHtml(recommendation.recommendedNextAction ?? 'Review the recommendation before approval.') + '</p>' +
          '<details><summary>Lifecycle evidence</summary>' +
            '<p class="meta"><strong>Provided</strong> ' + escapeHtml(formatEvidenceLabels(provided)) + '</p>' +
            '<p class="meta"><strong>Missing</strong> ' + escapeHtml(formatEvidenceLabels(missing)) + '</p>' +
          '</details>' +
        '</div>';
      }

      function classifierTopChipLabels(signals) {
        const labels = new Set();
        return signals
          .slice()
          .sort(function (left, right) {
            return classifierSignalRank(right) - classifierSignalRank(left);
          })
          .map(function (signal) {
            return classifierSignalLabel(signal);
          })
          .filter(function (label) {
            if (labels.has(label)) {
              return false;
            }
            labels.add(label);
            return true;
          })
          .slice(0, 3);
      }

      function renderClassifierEvidenceReference(recommendation) {
        const count = classificationSignalCount(recommendation);
        if (count === 0) {
          return '<div class="classifier-reference">' +
            '<span>' + escapeHtml('No classifier signal snapshot stored for this recommendation.') + '</span>' +
            '<button type="button" class="inline-review-button" data-action="review-classifier-evidence">Review</button>' +
          '</div>';
        }
        const label = count === 1
          ? 'Classification evidence available - 1 signal'
          : 'Classification evidence available - ' + count + ' signals';
        return '<div class="classifier-reference">' +
          '<span>' + escapeHtml(label) + '</span>' +
          '<button type="button" class="inline-review-button" data-action="review-classifier-evidence">Review</button>' +
        '</div>';
      }

      function classificationSignalCount(recommendation) {
        return Array.isArray(recommendation.classificationSignals)
          ? recommendation.classificationSignals.length
          : 0;
      }

      function renderClassifierSignalRows(signals) {
        const groups = [
          ['Customer text', signals.filter(function (signal) { return classifierSignalGroup(signal) === 'Customer text'; })],
          ['Submitted metadata', signals.filter(function (signal) { return classifierSignalGroup(signal) === 'Submitted metadata'; })],
          ['Safety rules', signals.filter(function (signal) { return classifierSignalGroup(signal) === 'Safety rules'; })],
          ['Known cause', signals.filter(function (signal) { return classifierSignalGroup(signal) === 'Known cause'; })],
          ['Other supporting rules', signals.filter(function (signal) { return classifierSignalGroup(signal) === 'Other supporting rules'; })]
        ];
        return groups
          .filter(function (entry) { return entry[1].length > 0; })
          .map(function (entry) {
            return '<section class="classifier-signal-group"><h4>' + escapeHtml(entry[0]) + '</h4>' +
              entry[1].map(renderClassifierSignalRow).join('') +
            '</section>';
          })
          .join('');
      }

      function renderClassifierSignalRow(signal) {
        return '<div class="classifier-signal-row">' +
          '<strong>' + escapeHtml(classifierSignalLabel(signal)) + ' · weight ' + escapeHtml(formatSignalWeight(signal.weight)) + '</strong>' +
          '<span>' + escapeHtml(signal.reason ?? 'No reason recorded.') + '</span>' +
          '<code>' + escapeHtml((signal.ruleId ?? 'unknown-rule') + ' -> ' + (signal.target ?? 'unknown-target')) + '</code>' +
        '</div>';
      }

      function classifierSignalGroup(signal) {
        const target = String(signal.target ?? '');
        const ruleId = String(signal.ruleId ?? '');
        if (target.startsWith('metadata:') || ruleId.startsWith('metadata-')) {
          return 'Submitted metadata';
        }
        if (target.startsWith('risk:') || target.startsWith('escalation:') || ruleId.startsWith('risk-') || ruleId.startsWith('escalation-')) {
          return 'Safety rules';
        }
        if (target.startsWith('knownCause:') || ruleId.startsWith('known-cause-')) {
          return 'Known cause';
        }
        if (target.startsWith('category:') || target.startsWith('team:') || target.startsWith('priority:')) {
          return 'Customer text';
        }
        return 'Other supporting rules';
      }

      function classifierSignalLabel(signal) {
        const target = String(signal.target ?? '');
        if (target.startsWith('risk:') || target.startsWith('escalation:')) {
          return 'Safety signal';
        }
        if (target.startsWith('knownCause:')) {
          return 'Known cause';
        }
        if (target.startsWith('disagreement:')) {
          return 'Metadata disagreement';
        }
        if (target.startsWith('metadata:')) {
          return 'Submitted metadata';
        }
        if (target.startsWith('category:')) {
          return 'Category reason';
        }
        if (target.startsWith('priority:')) {
          return 'Priority reason';
        }
        if (target.startsWith('team:')) {
          return 'Team reason';
        }
        if (target.startsWith('knowledge:')) {
          return 'Knowledge context';
        }
        return 'Supporting signal';
      }

      function classifierSignalRank(signal) {
        const target = String(signal.target ?? '');
        const base = Number(signal.weight ?? 0);
        if (target.startsWith('risk:') || target.startsWith('escalation:')) {
          return base + 10;
        }
        if (target.startsWith('knownCause:')) {
          return base + 8;
        }
        if (target.startsWith('category:') || target.startsWith('team:') || target.startsWith('priority:')) {
          return base + 5;
        }
        if (target.startsWith('disagreement:')) {
          return base + 4;
        }
        if (target.startsWith('metadata:')) {
          return base - 2;
        }
        return base;
      }

      function formatSignalWeight(value) {
        return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '0.00';
      }

      function formatList(values) {
        return Array.isArray(values) && values.length > 0 ? values.join(', ') : 'none';
      }

      function formatEvidenceValue(value) {
        return value === undefined || value === null ? 'unknown' : String(value);
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

      function formatDraftCheckSummary(checks) {
        if (!Array.isArray(checks) || checks.length === 0) {
          return 'none';
        }
        const warnings = checks.filter(function (check) { return check.status === 'warn'; }).length;
        return warnings === 0 ? checks.length + ' passed' : checks.length + ' checked, ' + warnings + ' warning(s)';
      }

      function formatDraftSafetyNarrative(recommendation) {
        const checks = recommendation.draftCustomerResponseChecks;
        const warnings = Array.isArray(checks)
          ? checks.filter(function (check) { return check.status === 'warn'; }).length
          : 0;
        if (recommendation.draftCustomerResponseSource === 'openai' && warnings === 0) {
          return 'GPT draft passed validator checks before reviewer approval.';
        }
        if (recommendation.draftCustomerResponseSource === 'fallback') {
          return 'Local fallback was used because the AI draft provider failed or validator checks warned.';
        }
        if (recommendation.draftCustomerResponseSource === 'deterministic') {
          return 'Deterministic local draft was generated without an external model call.';
        }
        return 'Draft is held for reviewer approval before any ticket update.';
      }

      function renderGptAssistCard(assist) {
        if (assist === undefined || assist === null) {
          return '';
        }
        return '<details class="description"><summary>GPT Assist</summary>' +
          '<div class="chips">' +
             chip('Source: ' + (assist.source ?? 'unknown')) +
             chip('Recommended: ' + (assist.recommendedTone ?? assist.tone ?? 'balanced')) +
             chip('Selected: ' + (assist.selectedTone ?? assist.tone ?? 'balanced')) +
             chip('Audience: ' + (assist.audience ?? 'merchant-admin')) +
             chip('Checks: ' + formatDraftCheckSummary(assist.checks)) +
          '</div>' +
          '<p class="meta"><strong>Tone reason</strong> ' + escapeHtml(assist.toneReason ?? 'Recommended from requester and ticket context.') + '</p>' +
          '<p class="meta"><strong>Likely missing info</strong> ' + escapeHtml(formatAssistList(assist.missingInfoSuggestions)) + '</p>' +
          '<p class="meta"><strong>Investigation steps</strong> ' + escapeHtml(formatAssistList(assist.investigationSteps)) + '</p>' +
          '<p class="meta">Advisory only. The customer response still requires reviewer approval.</p>' +
        '</details>';
      }

      function formatAssistList(values) {
        return Array.isArray(values) && values.length > 0 ? values.join(' | ') : 'none';
      }

      function formatEvidenceLabels(values) {
        return Array.isArray(values) && values.length > 0
          ? values.map(function (value) { return value.label ?? value.id; }).join(', ')
          : 'none';
      }

      function formatDraftChecks(checks) {
        if (!Array.isArray(checks) || checks.length === 0) {
          return 'none';
        }
        return checks
          .map(function (check) {
            return '[' + check.status + '] ' + check.label + ': ' + check.message;
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

      function appendConversationScenario(value) {
        if (state.selectedTicket === null) {
          return;
        }
        if (value === 'clear-replies') {
          state.customerRepliesByTicketId[state.selectedTicket.id] = [];
          renderConversationContext();
          return;
        }
        const body = conversationScenarioBody(value);
        const replies = currentCustomerReplies();
        state.customerRepliesByTicketId[state.selectedTicket.id] = replies.concat({
          id: 'demo-reply-' + String(replies.length + 1),
          createdAt: new Date(Date.UTC(2026, 5, 10, 9, replies.length * 7)).toISOString(),
          body
        });
        renderConversationContext();
      }

      function conversationScenarioBody(value) {
        if (value === 'partial-evidence') {
          return 'The endpoint URL is https://hooks.example.test/webhooks/orders and the delivery ID is deliv_7788.';
        }
        if (value === 'complete-evidence') {
          return 'Endpoint URL is https://hooks.example.test/webhooks/orders. Delivery ID is deliv_7788. Raw body handling has not changed since yesterday.';
        }
        if (value === 'known-cause-evidence') {
          return 'We rotated the signing secret yesterday. Endpoint URL is https://hooks.example.test/webhooks/orders, delivery ID is deliv_7788, and raw body handling has not changed.';
        }
        if (value === 'platform-fix-context') {
          return 'This is affecting all EU stores and recent Checkout Started events are delayed even though the API accepted them.';
        }
        if (value === 'resolved-confirmation') {
          return 'This works now. The issue is resolved on our end.';
        }
        return 'It is still happening, but I am not sure where to find the technical details.';
      }

      els.actor.addEventListener('input', updateControls);
      els.backToRecommendation.addEventListener('click', function () {
        if (state.recommendation !== null) {
          state.stage = 'draft';
          renderRecommendation(true);
        }
      });
      els.confirmApproval.addEventListener('change', updateControls);
      els.continueApproval.addEventListener('click', function () {
        if (state.recommendation !== null) {
          if (isApprovedWorkflow()) {
            void cancelApprovedRecommendation().catch(function (error) { setResult({ error: error.message }); });
          } else {
            state.stage = 'approval';
            renderRecommendation(true);
          }
        }
      });
      els.recommendationPanel.addEventListener('click', function (event) {
        if (event.target?.dataset?.action === 'review-classifier-evidence' && state.recommendation !== null) {
          state.stage = 'draft';
          renderRecommendation(true);
        }
      });
      els.conversationContextPanel.addEventListener('click', function (event) {
        if (event.target?.className?.includes('conversation-scenario')) {
          appendConversationScenario(event.target.value);
        }
      });
      els.editedCustomerResponse.addEventListener('input', updateControls);
      els.feedback.addEventListener('input', updateControls);
      for (const button of els.fieldChoices.querySelectorAll('.field-approve-button')) {
        button.addEventListener('click', function () {
          toggleFieldApproval(button.value);
        });
      }
      for (const button of els.queueFilters.querySelectorAll('.queue-filter')) {
        button.addEventListener('click', function () {
          setQueueFilter(button.value);
        });
      }
      els.refreshQueue.addEventListener('click', function () {
        void loadQueue()
          .then(refreshEvidenceBestEffort)
          .catch(function (error) { setResult({ error: error.message }); });
      });
      els.refreshEvidence.addEventListener('click', function () {
        void loadEvidence().catch(function (error) { setResult({ error: error.message }); });
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

      void Promise.all([
        loadQueue().then(loadMetrics),
        refreshEvidenceBestEffort()
      ])
        .catch(function (error) { setResult({ error: error.message }); });
      renderTicket();
      renderConversationContext();
      renderFieldApprovalButtons();
      updateControls();
    </script>
  </body>
</html>
`;
