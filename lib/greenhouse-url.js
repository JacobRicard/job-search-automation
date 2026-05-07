'use strict';

function defaultSlugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseGreenhouseUrl(url, fallbackCompany, { slugify = defaultSlugify } = {}) {
  if (!url) return null;
  const str = String(url);

  const standard = str.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (standard) return { boardToken: standard[1], jobId: standard[2] };

  const ghJid = str.match(/[?&]gh_jid=(\d+)/i);
  if (ghJid) {
    const boardToken = slugify(fallbackCompany);
    if (!boardToken) return null;
    return { boardToken, jobId: ghJid[1] };
  }

  return null;
}

module.exports = { parseGreenhouseUrl, defaultSlugify };
