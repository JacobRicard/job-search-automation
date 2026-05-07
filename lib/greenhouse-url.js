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

function parseGreenhouseJob(job, options = {}) {
  if (!job) return null;
  const fromUrl = parseGreenhouseUrl(job.url, job.company, options);
  if (fromUrl) return fromUrl;

  const idStr = String(job.id || '');
  if (idStr.startsWith('greenhouse-')) {
    const slugify = options.slugify || defaultSlugify;
    const boardToken = slugify(job.company);
    if (!boardToken) return null;
    return { boardToken, jobId: idStr.replace('greenhouse-', '') };
  }

  return null;
}

module.exports = { parseGreenhouseUrl, parseGreenhouseJob, defaultSlugify };
