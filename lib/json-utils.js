'use strict';

function parseGeminiJson(text) {
  const trimmed = String(text || '').trim();
  const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (_) {}
    }
    const resumeMatch = cleaned.match(/"resume_markdown"\s*:\s*"([\s\S]*?)"\s*,\s*"summary"\s*:/);
    if (resumeMatch) {
      const summaryMatch = cleaned.match(/"summary"\s*:\s*"([^"]*)"/);
      const keywordsMatch = cleaned.match(/"keywords"\s*:\s*\[([\s\S]*?)\]/);
      const keywords = keywordsMatch
        ? keywordsMatch[1].split(',').map((value) => value.trim().replace(/^"|"$/g, '')).filter(Boolean)
        : [];
      return {
        resume_markdown: resumeMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
        summary: summaryMatch ? summaryMatch[1] : 'Generated tailored resume.',
        keywords,
      };
    }
    const markdownStart = cleaned.indexOf('# ');
    if (markdownStart >= 0) {
      const tail = cleaned.slice(markdownStart);
      const nextJsonField = tail.search(/"\s*,\s*"(summary|keywords)"\s*:/);
      const resumeMarkdown = (nextJsonField >= 0 ? tail.slice(0, nextJsonField) : tail)
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/"\s*[,}]*\s*$/g, '')
        .trim();
      const summaryMatch = cleaned.match(/"summary"\s*:\s*"([^"]*)"/);
      return {
        resume_markdown: resumeMarkdown,
        summary: summaryMatch ? summaryMatch[1] : 'Generated tailored resume.',
        keywords: [],
      };
    }
    if (cleaned.startsWith('# ')) {
      return {
        resume_markdown: cleaned,
        summary: 'Generated tailored resume.',
        keywords: [],
      };
    }
    throw error;
  }
}

module.exports = { parseGeminiJson };
