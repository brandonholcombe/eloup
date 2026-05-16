#!/bin/bash
# PreToolUse hook: blocks source file edits when active tasks lack review reports.
# Enforces "review before implementation" — the review must exist BEFORE code changes.
# Enforces "independent review" — an agent cannot review its own work.
#
# Logic:
#   1. Only gates production files (src/, k8s/, scripts/, config/)
#   2. If no active tasks exist, allow freely (ad-hoc work)
#   3. If active tasks exist, each must have a review report referencing it
#   4. If any active task is unreviewed, deny the edit
#   5. If the task Author matches the review Reviewer, deny (self-review)
#
# Task documents must contain:    ## Author: <agent-name>
# Review reports must contain:    ## Reviewer: <agent-name>
# The Author and Reviewer must be different for the review to count.
#
# Review reports must reference the task filename (e.g., "my-task.md")
# somewhere in their body to count as a review for that task.
#
# Directory conventions (override via env vars):
#   REVIEW_GATE_TASKS_DIR   — active task documents (default: Agents/TODO/Active)
#   REVIEW_GATE_REVIEWS_DIR — review reports       (default: Agents/Review-reports)

set -uo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# No file path — allow (shouldn't happen for Edit/Write)
[ -z "$FILE_PATH" ] && exit 0

# Only gate production files — allow everything else
case "$FILE_PATH" in
    */src/*|*/k8s/*|*/scripts/*|*/config/*|*/eloup-web/*) ;;
    *) exit 0 ;;
esac

PROJ="${CLAUDE_PROJECT_DIR:-$(echo "$INPUT" | jq -r '.cwd')}"
ACTIVE_DIR="${REVIEW_GATE_TASKS_DIR:-$PROJ/Agents/TODO/Active}"
REVIEW_DIR="${REVIEW_GATE_REVIEWS_DIR:-$PROJ/Agents/Review-reports}"

# No active task directory — allow
[ ! -d "$ACTIVE_DIR" ] && exit 0

# Collect non-complete active tasks that lack a valid independent review
unreviewed=()
self_reviewed=()
shopt -s nullglob
for task in "$ACTIVE_DIR"/*.md; do
    # Skip completed tasks
    grep -qiE '^## Status:.*[Cc]omplete' "$task" 2>/dev/null && continue

    task_name=$(basename "$task")

    # Extract task author (case-insensitive match, trim whitespace)
    task_author=$(grep -iE '^## Author:' "$task" 2>/dev/null | head -1 | sed 's/^## [Aa]uthor:[[:space:]]*//' | xargs)

    # Check if any review report references this task filename
    if [ -d "$REVIEW_DIR" ]; then
        found=false
        for review in "$REVIEW_DIR"/*.md; do
            if grep -q "$task_name" "$review" 2>/dev/null; then
                # Found a review — now check for self-review
                reviewer=$(grep -iE '^## Reviewer:' "$review" 2>/dev/null | head -1 | sed 's/^## [Rr]eviewer:[[:space:]]*//' | xargs)

                # If both fields are present and match, this is a self-review — doesn't count
                if [ -n "$task_author" ] && [ -n "$reviewer" ] && [ "$task_author" = "$reviewer" ]; then
                    continue
                fi

                # If reviewer field is missing, reject — reviewer must identify themselves
                if [ -z "$reviewer" ]; then
                    continue
                fi

                found=true
                break
            fi
        done
        if $found; then
            continue
        fi

        # Check if a self-review was the only match
        for review in "$REVIEW_DIR"/*.md; do
            if grep -q "$task_name" "$review" 2>/dev/null; then
                reviewer=$(grep -iE '^## Reviewer:' "$review" 2>/dev/null | head -1 | sed 's/^## [Rr]eviewer:[[:space:]]*//' | xargs)
                if [ -n "$task_author" ] && [ -n "$reviewer" ] && [ "$task_author" = "$reviewer" ]; then
                    self_reviewed+=("$task_name")
                    break
                fi
            fi
        done
    fi

    # Only add to unreviewed if not already in self_reviewed
    is_self=false
    for sr in "${self_reviewed[@]+"${self_reviewed[@]}"}"; do
        [ "$sr" = "$task_name" ] && is_self=true && break
    done
    $is_self || unreviewed+=("$task_name")
done
shopt -u nullglob

# Block self-reviews first (more specific error)
if [ ${#self_reviewed[@]} -gt 0 ]; then
    tasks=$(printf '%s, ' "${self_reviewed[@]}")
    tasks=${tasks%, }

    jq -n --arg reason "REVIEW GATE: Self-review detected for: ${tasks}. An agent cannot review its own work. A DIFFERENT agent must write the review report in Agents/Review-reports/." \
    '{
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: $reason
        }
    }'
    exit 0
fi

# All tasks reviewed (or no active tasks) — allow
[ ${#unreviewed[@]} -eq 0 ] && exit 0

# Block: unreviewed active tasks exist
tasks=$(printf '%s, ' "${unreviewed[@]}")
tasks=${tasks%, }

jq -n --arg reason "REVIEW GATE: Active task(s) without review reports: ${tasks}. Write a technical review in Agents/Review-reports/ (with ## Reviewer: <your-name>, referencing the task filename) BEFORE editing source files. Note: the reviewer must be a different agent than the task author." \
'{
    hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
    }
}'
exit 0
