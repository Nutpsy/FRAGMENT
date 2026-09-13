// Linked motion studies in the image archive; images and source links are separate targets.
function inlandProjectUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, 'https://fragment.invalid/');
    return ['https:', 'http:'].includes(url.protocol) ? value : '';
  } catch { return ''; }
}

function renderInlandProject(item, archive = false) {
  const href = inlandProjectUrl(item.href);
  const source = inlandProjectUrl(item.sourceUrl);
  return `
    <figure class="${archive ? 'archive-ie-item' : 'ie-item'} ie-project" data-id="${escapeHtml(item.id)}">
      <a class="ie-project-preview" href="${escapeHtml(href || '#')}" target="_blank" rel="noopener noreferrer" aria-label="打开${escapeHtml(item.alt || '作品')}动画">
        <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || '')}" loading="lazy">
      </a>
      <figcaption class="ie-project-credit">${escapeHtml(item.caption || '')}${source ? ` <a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">小红书原作 ↗</a>` : ''}</figcaption>
    </figure>`;
}
