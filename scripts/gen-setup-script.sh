#!/usr/bin/env bash
# Generate a one-time environment setup script that restores personal data/ and
# .context/ profile files into each cloud session.
#
# Usage: bash scripts/gen-setup-script.sh
#
# Copy the output and paste it into:
#   Claude Code > Settings > Environment > Setup Script
# That's a one-time action. Every future cloud session will auto-restore your files.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

emit_file() {
  local rel_path="$1"
  local full_path="$REPO_DIR/$rel_path"
  [[ -f "$full_path" ]] || return 0

  echo "cat > \"\$REPO_DIR/$rel_path\" << 'HEREDOC_EOF'"
  cat "$full_path"
  # Ensure heredoc delimiter is on its own line
  printf '\nHEREDOC_EOF\n\n'
}

echo "#!/usr/bin/env bash"
echo "# Job search profile — generated $(date +%Y-%m-%d)"
echo "# One-time paste into: Claude Code > Settings > Environment > Setup Script"
echo "set -euo pipefail"
echo ""
echo "REPO_DIR=\"/home/user/job-search-automation\""
echo ""
echo "mkdir -p \"\$REPO_DIR/data/experience\""
echo "mkdir -p \"\$REPO_DIR/.context/people\""
echo "mkdir -p \"\$REPO_DIR/.context/reference\""
echo "mkdir -p \"\$REPO_DIR/.context/goals\""
echo "mkdir -p \"\$REPO_DIR/.context/decisions\""
echo "mkdir -p \"\$REPO_DIR/.context/projects\""
echo ""

# Core data files
emit_file "data/context.md"
emit_file "data/resume.md"
emit_file "data/companies.js"
emit_file "data/career-detail.md"
emit_file "data/jobspy-config.json"

# Per-company experience files
if [[ -d "$REPO_DIR/data/experience" ]]; then
  for exp_file in "$REPO_DIR/data/experience/"*.md; do
    [[ -f "$exp_file" ]] || continue
    emit_file "data/experience/$(basename "$exp_file")"
  done
fi

# Context files
emit_file ".context/people/applicant.md"
emit_file ".context/people/voice.md"

echo "echo '[setup] Profile files restored from environment setup script'"
