function escapeHTML(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function buildProofChecklistItem(hasProof, { label = 'Workout screenshot' } = {}) {
  if (hasProof) return { label, done: true };
  return { label, done: false };
}

export function buildHrChecklistItem(label, value, { max = 999, min = 1 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return { label, done: false };
  if (num > max) return { label: `${label} (3 digits max)`, done: false };
  if (num < min) return { label, done: false };
  return { label, done: true };
}

export function buildNumericChecklistItem(label, value) {
  const num = Number(value);
  return { label, done: Number.isFinite(num) && num > 0 };
}

export function renderCompletionHints(root, items, options = {}) {
  if (!root) return;
  const list = Array.isArray(items) ? items : [];
  const pending = list.filter((item) => !item.done);
  if (!pending.length) {
    root.hidden = true;
    root.innerHTML = '';
    return;
  }
  const title = options.title || 'Still needed to save';
  root.hidden = false;
  root.innerHTML = `
    <div class="completion-hints-title">${escapeHTML(title)}</div>
    <ul class="completion-hints-list">
      ${list.map((item) => `
        <li class="completion-hints-item ${item.done ? 'is-done' : 'is-pending'}">
          <span class="completion-hints-mark" aria-hidden="true">${item.done ? '✓' : '○'}</span>
          <span>${escapeHTML(item.label)}</span>
        </li>
      `).join('')}
    </ul>
  `;
}

export function applyCompletionActionState(button, items, options = {}) {
  if (!button) return false;
  const pending = (items || []).filter((item) => !item.done);
  button.disabled = pending.length > 0;
  if (options.hintsRoot) renderCompletionHints(options.hintsRoot, items, options);
  if (options.hintsId) {
    if (pending.length) button.setAttribute('aria-describedby', options.hintsId);
    else button.removeAttribute('aria-describedby');
  }
  return pending.length === 0;
}
